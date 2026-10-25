import { createHash } from 'node:crypto';
import type { createPhase2Repositories } from '../data/repositories';
import type { MemoryStore } from '../data/memoryStore';
import {
  chatCompletion,
  loadLlmConfig,
  type LlmConfig,
} from '../core/llm';
import { buildMemoryDigest } from './digest';
import { commitMemoryUpdate } from './commit';
import { MEMORY_OPS_SYSTEM_PROMPT, buildMemoryOpsPrompt } from './prompts';
import { parseMemoryOutput, reconcileMemoryOutput } from './reconcile';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export type MemoryRunResult =
  | { status: 'updated'; applied: number; narrativeId: string | null; itemIds: string[] }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export interface MemoryRunnerOptions {
  repos: Repositories;
  store: MemoryStore;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  fetchImpl?: typeof fetch;
  enabled?: boolean;
  triggerMessageCount?: number;
  policyVersion?: string;
  packVersion?: string;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

function runKey(input: {
  characterId: string;
  timelineId: string;
  summarized: number;
  total: number;
  policyVersion: string;
}) {
  return createHash('sha256')
    .update([
      input.characterId,
      input.timelineId,
      String(input.summarized),
      String(input.total),
      input.policyVersion,
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
}

export class MemoryRunner {
  private readonly inFlight = new Set<string>();
  private readonly pending = new Set<Promise<MemoryRunResult>>();
  private closed = false;

  constructor(private readonly options: MemoryRunnerOptions) {}

  async run(input: { characterId: string; timelineId: string }): Promise<MemoryRunResult> {
    if (this.closed) {
      return { status: 'skipped', reason: 'memory runner is closed' };
    }

    if (this.options.enabled === false) {
      return { status: 'skipped', reason: 'memory runner is disabled' };
    }

    if (this.inFlight.has(input.timelineId)) {
      return { status: 'skipped', reason: 'memory update already running' };
    }

    this.inFlight.add(input.timelineId);
    const promise = this.execute(input);
    this.pending.add(promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(input.timelineId);
      this.pending.delete(promise);
    }
  }

  async close() {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
  }

  private async resolveConfig(): Promise<LlmConfig | null> {
    if (this.options.llmConfig) {
      return this.options.llmConfig;
    }

    try {
      return await loadLlmConfig(this.options.llmConfigPath);
    } catch {
      return null;
    }
  }

  private async execute(input: { characterId: string; timelineId: string }): Promise<MemoryRunResult> {
    const { repo, store } = { repo: this.options.repos, store: this.options.store };
    const trigger = this.options.triggerMessageCount ?? 20;
    const narrative = store.narratives.latest(input.timelineId);
    const total = repo.messages.countByTimeline(input.timelineId);
    const summarized = narrative?.messageCount ?? 0;
    const needed = Math.max(0, total - summarized);

    if (needed < trigger) {
      return { status: 'skipped', reason: `only ${needed} new messages, need ${trigger}` };
    }

    const fresh = repo.messages.listRecent(input.timelineId, Math.min(needed, 120));

    if (fresh.length < trigger) {
      return { status: 'skipped', reason: `only ${fresh.length} new messages, need ${trigger}` };
    }

    const config = await this.resolveConfig();

    if (!config) {
      return { status: 'skipped', reason: 'LLM is not configured' };
    }

    const policyVersion = this.options.policyVersion ?? 'm1';
    const packVersion = this.options.packVersion ?? null;
    const key = runKey({
      characterId: input.characterId,
      timelineId: input.timelineId,
      summarized,
      total,
      policyVersion,
    });
    const previous = store.runs.getByKey(key);

    if (previous && previous.status === 'updated') {
      return { status: 'skipped', reason: 'already processed' };
    }

    const runId = store.runs.start({
      timelineId: input.timelineId,
      characterId: input.characterId,
      runKey: key,
      inputMessageIds: fresh.map(message => message.id),
      policyVersion,
      packVersion,
      watermarkStart: summarized,
      watermarkEnd: total,
    });
    const startedAt = Date.now();

    try {
      const digest = buildMemoryDigest({
        repos: repo,
        store,
        characterId: input.characterId,
        timelineId: input.timelineId,
        messages: fresh.map(message => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
        })),
      });
      const completion = await chatCompletion(
        config,
        [
          { role: 'system', content: MEMORY_OPS_SYSTEM_PROMPT },
          { role: 'user', content: buildMemoryOpsPrompt(digest) },
        ],
        {
          temperature: 0,
          maxTokens: 1600,
          fetchImpl: this.options.fetchImpl,
        },
      );
      const parsed = parseMemoryOutput(completion.content);

      if (!parsed) {
        store.runs.finish(runId, {
          status: 'failed',
          error: 'memory output was not valid JSON',
          rawOutput: completion.content.slice(0, 4000),
          model: completion.model,
          promptTokens: completion.usage?.promptTokens ?? null,
          completionTokens: completion.usage?.completionTokens ?? null,
          durationMs: Date.now() - startedAt,
        });
        this.options.logger?.warn?.('memory output was not valid JSON');
        return { status: 'failed', error: 'memory output was not valid JSON' };
      }

      const known = store.items.listActive({
        characterId: input.characterId,
        subjects: ['user', 'self', 'relationship', 'world'],
        limit: 80,
      });
      const messageRoles = new Map(fresh.map(message => [message.id, message.role] as const));
      const reconciled = reconcileMemoryOutput(parsed, {
        characterId: input.characterId,
        timelineId: input.timelineId,
        knownItems: known,
        messageRoles,
        now: new Date().toISOString(),
      });
      const committed = commitMemoryUpdate({
        store,
        repos: repo,
        characterId: input.characterId,
        timelineId: input.timelineId,
        runId,
        accepted: reconciled.accepted,
        narrative: reconciled.narrative,
        watermarkMessageId: fresh[fresh.length - 1]?.id ?? null,
        messageCount: total,
        sourceMessageIds: fresh.map(message => message.id),
      });

      store.runs.finish(runId, {
        status: 'updated',
        rawOutput: completion.content.slice(0, 4000),
        model: completion.model,
        promptTokens: completion.usage?.promptTokens ?? null,
        completionTokens: completion.usage?.completionTokens ?? null,
        proposals: Array.isArray(parsed.ops) ? parsed.ops.length : 0,
        applied: committed.applied,
        rejected: reconciled.rejected,
        durationMs: Date.now() - startedAt,
      });

      this.options.logger?.info?.('memory update completed', {
        characterId: input.characterId,
        timelineId: input.timelineId,
        applied: committed.applied,
        rejected: reconciled.rejected.length,
      });

      return {
        status: 'updated',
        applied: committed.applied,
        narrativeId: committed.narrativeId,
        itemIds: committed.itemIds,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.runs.finish(runId, {
        status: 'failed',
        error: message,
        durationMs: Date.now() - startedAt,
      });
      this.options.logger?.warn?.('memory update failed', error);
      return { status: 'failed', error: message };
    }
  }
}
