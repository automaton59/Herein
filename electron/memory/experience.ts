import type { createPhase2Repositories } from '../data/repositories';
import type { MemoryStore } from '../data/memoryStore';
import { chatCompletion, type LlmConfig } from '../core/llm';
import {
  EXPERIENCE_SYSTEM_PROMPT,
  buildExperiencePrompt,
} from './prompts';
import { loadPrivatePrompt, renderPrivatePrompt } from '../prompts/localPrompt';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export type ExperienceRunResult =
  | { status: 'updated'; created: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseExperiences(raw: string): Array<Record<string, unknown>> | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;

  try {
    const parsed = JSON.parse(withoutFence) as unknown;

    if (!isRecord(parsed) || !Array.isArray(parsed.experiences)) {
      return null;
    }

    return parsed.experiences.filter(isRecord);
  } catch {
    return null;
  }
}

export async function extractExperiences(input: {
  repos: Repositories;
  store: MemoryStore;
  characterId: string;
  llmConfig: LlmConfig;
  fetchImpl?: typeof fetch;
  limit?: number;
}): Promise<ExperienceRunResult> {
  const observations = input.repos.observations
    .listRecent({ limit: 60 })
    .filter(observation => observation.platform === 'bilibili'
      || observation.platform === 'netease'
      || observation.platform === 'local')
    .filter(observation => (observation.content ?? '').trim().length > 0);

  if (observations.length === 0) {
    return { status: 'skipped', reason: 'no observations' };
  }

  const used = new Set(
    input.store.experiences
      .listRecent({ characterId: input.characterId, limit: 200 })
      .flatMap(experience => experience.sourceObservationIds),
  );
  const fresh = observations
    .filter(observation => !used.has(observation.id))
    .slice(0, input.limit ?? 8);

  if (fresh.length === 0) {
    return { status: 'skipped', reason: 'no new observations' };
  }

  const observationText = fresh.map(observation => {
    return `[${observation.id}] ${observation.platform}/${observation.kind}: ${observation.content ?? ''}`;
  }).join('\n');

  const privateTemplate = await loadPrivatePrompt('experience');
  const experiencePrompt = privateTemplate
    ? renderPrivatePrompt(privateTemplate, {
      character_name: input.repos.characters.get(input.characterId)?.name ?? '角色',
      content: observationText,
      context: '',
    })
    : buildExperiencePrompt(observationText);

  try {
    const completion = await chatCompletion(
      input.llmConfig,
      [
        { role: 'system', content: EXPERIENCE_SYSTEM_PROMPT },
        { role: 'user', content: experiencePrompt },
      ],
      {
        temperature: 0.4,
        maxTokens: 700,
        fetchImpl: input.fetchImpl,
      },
    );
    const parsed = parseExperiences(completion.content);

    if (!parsed) {
      return { status: 'failed', error: 'experience output was not valid JSON' };
    }

    const allowed = new Set(fresh.map(observation => observation.id));
    let created = 0;

    input.store.transaction(() => {
      for (const raw of parsed.slice(0, 3)) {
        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
        const reaction = typeof raw.reaction === 'string' ? raw.reaction.trim() : '';
        const sourceIds = Array.isArray(raw.sourceObservationIds)
          ? raw.sourceObservationIds.filter((id): id is string => typeof id === 'string' && allowed.has(id))
          : [];

        if (!title || !summary || !reaction || sourceIds.length === 0) {
          continue;
        }

        const experience = input.store.experiences.create({
          characterId: input.characterId,
          kind: typeof raw.kind === 'string' ? raw.kind : 'watched_video',
          sourceObservationIds: sourceIds,
          title,
          summary,
          reaction,
          importance: typeof raw.importance === 'number'
            ? Math.min(10, Math.max(1, Math.round(raw.importance)))
            : 5,
          happenedAt: fresh.find(observation => observation.id === sourceIds[0])?.occurredAt
            ?? new Date().toISOString(),
          audience: 'private',
          provenance: 'agent',
        });

        input.store.events.append({
          characterId: input.characterId,
          timelineId: null,
          itemId: null,
          runId: null,
          type: 'experienced',
          actor: 'agent',
          subject: 'self',
          payload: { experienceId: experience.id, sourceObservationIds: sourceIds },
        });
        created += 1;
      }
    });

    return { status: 'updated', created };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
