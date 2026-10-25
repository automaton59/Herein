import type { Audience, ExperienceItem, MemoryItem, MemoryStore } from '../data/memoryStore';
import type { MemorySection, RecallBrief, RecallResult } from './types';

const DEFAULT_BUDGET = 1100;

const SECTION_BUDGETS: Array<{ id: string; title: string; budget: number }> = [
  { id: 'user_profile', title: '用户资料', budget: 120 },
  { id: 'relationship', title: '关系', budget: 120 },
  { id: 'current_state', title: '当前状态', budget: 220 },
  { id: 'preferences', title: '偏好与边界', budget: 130 },
  { id: 'shared', title: '共同经历', budget: 180 },
  { id: 'open_loops', title: '未完事项', budget: 90 },
  { id: 'narrative', title: '最近总结', budget: 240 },
];

function estimateTokens(text: string) {
  return Math.ceil(text.length / 2);
}

function recencyScore(updatedAt: string, now: string) {
  const updated = Date.parse(updatedAt);
  const current = Date.parse(now);

  if (!Number.isFinite(updated) || !Number.isFinite(current)) {
    return 0.5;
  }

  const days = Math.max(0, (current - updated) / 86_400_000);
  return Math.exp(-days / 45);
}

function memoryLine(memory: MemoryItem) {
  const valid = memory.kind === 'state' && memory.validFrom
    ? `（${memory.validFrom.slice(0, 10)} 起）`
    : '';
  return `${memory.content}${valid}`;
}

function experienceLine(experience: ExperienceItem) {
  const reaction = experience.reaction || experience.summary;
  return `${experience.title}：${reaction}`;
}

function sectionFor(memory: MemoryItem) {
  if (memory.kind === 'trait' && memory.subject === 'user') {
    return 'user_profile';
  }

  if (memory.kind === 'state' && memory.subject === 'user') {
    return 'current_state';
  }

  if ((memory.kind === 'preference' || memory.kind === 'boundary') && memory.subject === 'user') {
    return 'preferences';
  }

  if (memory.subject === 'relationship') {
    return memory.kind === 'event' ? 'shared' : 'relationship';
  }

  if (memory.subject === 'self' && memory.kind === 'event') {
    return 'shared';
  }

  if (memory.kind === 'commitment') {
    return 'open_loops';
  }

  return 'current_state';
}

function emptySections(): MemorySection[] {
  return SECTION_BUDGETS.map(section => ({
    id: section.id,
    title: section.title,
    items: [],
    itemIds: [],
    budget: section.budget,
    used: 0,
  }));
}

export function recallMemory(input: {
  store: MemoryStore;
  brief: RecallBrief;
}): RecallResult {
  const startedAt = Date.now();
  const { store, brief } = input;
  const now = brief.now ?? new Date().toISOString();
  const audience: Audience = brief.audience ?? 'private';
  const budget = brief.budget ?? DEFAULT_BUDGET;
  const narrative = brief.timelineId ? store.narratives.latest(brief.timelineId) : null;
  const includeNarrative = audience === 'private';
  const items = store.items.listActive({
    characterId: brief.characterId,
    audience,
    now,
    limit: 300,
  });
  const situation = brief.situation?.trim() ?? '';
  const relevant = new Map<string, number>();

  if (situation) {
    for (const item of store.items.search(situation, {
      characterId: brief.characterId,
      audience,
      limit: 40,
    })) {
      relevant.set(item.id, 1);
    }
  }

  const scored = items.map(item => {
    const relevance = relevant.get(item.id) ?? 0;
    const score = (
      0.35 * relevance
      + 0.25 * (item.importance / 10)
      + 0.20 * recencyScore(item.updatedAt, now)
      + 0.10 * (item.confidence ?? 0.6)
      + 0.10 * (item.pinned ? 1 : 0)
    );

    return { item, score };
  }).sort((left, right) => {
    if (left.item.pinned !== right.item.pinned) {
      return left.item.pinned ? -1 : 1;
    }

    return right.score - left.score || left.item.id.localeCompare(right.item.id);
  });

  const recentExperiences = store.experiences.listRecent({ characterId: brief.characterId, limit: 8 });
  const matchedExperiences = audience === 'private' && situation
    ? store.experiences.search(situation, { characterId: brief.characterId, limit: 8 })
    : [];
  const experienceById = new Map<string, ExperienceItem>();

  for (const experience of [...matchedExperiences, ...recentExperiences]) {
    if (audience === 'private') {
      experienceById.set(experience.id, experience);
    }
  }

  const experiences = [...experienceById.values()].slice(0, 10);
  const sections = emptySections();
  const byId = new Map(sections.map(section => [section.id, section]));
  const omitted: Array<{ id: string; reason: string }> = [];
  const scores: Record<string, number> = {};
  const itemIds: string[] = [];

  for (const { item, score } of scored) {
    scores[item.id] = Number(score.toFixed(4));
    const sectionId = sectionFor(item);
    const section = byId.get(sectionId);
    const line = memoryLine(item);
    const cost = estimateTokens(line);

    if (!section) {
      omitted.push({ id: item.id, reason: 'no section' });
      continue;
    }

    if (item.pinned || section.used + cost <= section.budget) {
      section.items.push(line);
      section.itemIds.push(item.id);
      section.used += cost;
      itemIds.push(item.id);
    } else {
      omitted.push({ id: item.id, reason: 'budget' });
    }
  }

  const shared = byId.get('shared');

  if (shared) {
    for (const experience of experiences) {
      const line = experienceLine(experience);
      const cost = estimateTokens(line);

      if (shared.used + cost <= shared.budget) {
        shared.items.push(line);
        shared.used += cost;
      } else {
        omitted.push({ id: experience.id, reason: 'budget' });
      }
    }
  }

  const openLoops = byId.get('open_loops');

  if (includeNarrative && openLoops && narrative?.openLoops.length) {
    for (const loop of narrative.openLoops) {
      const cost = estimateTokens(loop);

      if (openLoops.used + cost <= openLoops.budget) {
        openLoops.items.push(loop);
        openLoops.used += cost;
      }
    }
  }

  const narrativeSection = byId.get('narrative');

  if (includeNarrative && narrativeSection && narrative?.content) {
    const cost = estimateTokens(narrative.content);

    if (cost <= narrativeSection.budget) {
      narrativeSection.items.push(narrative.content);
      narrativeSection.used += cost;
    } else {
      const clipped = narrative.content.slice(0, narrativeSection.budget * 2);
      narrativeSection.items.push(`${clipped}…`);
      narrativeSection.used = narrativeSection.budget;
    }
  }

  let totalUsed = sections.reduce((sum, section) => sum + section.used, 0);

  if (totalUsed > budget) {
    for (const section of [...sections].reverse()) {
      while (totalUsed > budget && section.items.length > 1) {
        const removed = section.items.pop();
        section.itemIds.pop();

        if (removed) {
          totalUsed -= estimateTokens(removed);
          section.used -= estimateTokens(removed);
        }
      }
    }
  }

  const text = sections
    .filter(section => section.items.length > 0)
    .map(section => `【${section.title}】\n${section.items.map(item => `- ${item}`).join('\n')}`)
    .join('\n\n');

  const latencyMs = Date.now() - startedAt;

  store.recallLogs.append({
    characterId: brief.characterId,
    timelineId: brief.timelineId,
    messageId: brief.messageId ?? null,
    purpose: brief.purpose ?? 'chat',
    audience,
    budget,
    itemIds,
    omitted,
    scores,
    packVersion: brief.packVersion ?? null,
    policyVersion: brief.policyVersion ?? null,
    latencyMs,
  });

  return {
    text,
    sections,
    itemIds,
    scores,
    omitted,
    latencyMs,
    narrative: narrative?.content ?? null,
  };
}
