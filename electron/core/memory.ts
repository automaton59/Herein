import { randomUUID } from 'node:crypto';
import type {
  MemoryRecord,
  MessageRecord,
  SummaryRecord,
  createPhase2Repositories,
} from '../data/repositories';
import {
  chatCompletion,
  loadLlmConfig,
  type LlmConfig,
} from './llm';
import {
  MEMORY_SYSTEM_PROMPT,
  MEMORY_UPDATE_TASK_PROMPT,
} from './memoryPrompts';

type Repositories = ReturnType<typeof createPhase2Repositories>;

const MEMORY_KINDS = ['state', 'event', 'preference', 'relationship', 'profile'] as const;
const MEMORY_SCOPES = ['global', 'character', 'timeline'] as const;

type MemoryKind = typeof MEMORY_KINDS[number];
type MemoryScope = typeof MEMORY_SCOPES[number];

export interface CoreMemoryRunnerOptions {
  repos: Repositories;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  fetchImpl?: typeof fetch;
  enabled?: boolean;
  triggerMessageCount?: number;
  logger?: {
    warn: (message: string, detail?: unknown) => void;
    info?: (message: string, detail?: unknown) => void;
  };
}

export interface CoreMemoryRunInput {
  characterId: string;
  timelineId: string;
}

export type CoreMemoryRunResult =
  | { status: 'updated'; summaryId: string; memoryCount: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

interface ParsedMemoryOutput {
  summary: string;
  memories: MemoryRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && (MEMORY_SCOPES as readonly string[]).includes(value);
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function buildPrompt(previousSummary: string | null | undefined, messages: MessageRecord[]) {
  const transcript = messages
    .map(message => `[${message.id}] ${message.role}: ${message.content.slice(0, 4000)}`)
    .join('\n');

  return [
    MEMORY_UPDATE_TASK_PROMPT,
    previousSummary ? `Previous summary:\n${previousSummary}` : 'Previous summary: none',
    `New messages:\n${transcript}`,
  ].join('\n\n');
}

function parseMemoryOutput(raw: string, input: CoreMemoryRunInput): ParsedMemoryOutput | { error: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { error: 'memory output was not valid JSON' };
  }

  if (!isRecord(parsed)) {
    return { error: 'memory output was not an object' };
  }

  const summary = typeof parsed.conversationSummary === 'string'
    ? parsed.conversationSummary.trim()
    : '';

  if (!summary) {
    return { error: 'memory output did not include conversationSummary' };
  }

  const rawItems = Array.isArray(parsed.memoryItems) ? parsed.memoryItems : [];
  const memories: MemoryRecord[] = [];

  for (const item of rawItems) {
    if (!isRecord(item)) {
      continue;
    }

    if (!isMemoryKind(item.kind) || !isMemoryScope(item.scope)) {
      continue;
    }

    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) {
      continue;
    }

    const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence)
      ? Math.min(1, Math.max(0, item.confidence))
      : null;
    const importance = typeof item.importance === 'number' && Number.isFinite(item.importance)
      ? Math.min(10, Math.max(1, Math.round(item.importance)))
      : 5;

    memories.push({
      id: `memory_${randomUUID()}`,
      characterId: item.scope === 'global' ? null : input.characterId,
      timelineId: input.timelineId,
      scope: item.scope,
      kind: item.kind,
      content,
      currentValue: optionalString(item.currentValue),
      previousValue: optionalString(item.previousValue),
      historicalNote: optionalString(item.historicalNote),
      sourceMessageIds: Array.isArray(item.sourceMessageIds)
        ? item.sourceMessageIds.filter((id): id is string => typeof id === 'string')
        : [],
      confidence,
      origin: 'summary',
      status: 'active',
      pinned: Boolean(item.pinned),
      includeInContext: true,
      audience: 'private',
      importance,
      provenance: 'agent',
    });
  }

  return { summary, memories };
}

function normalizeContent(content: string) {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class CoreMemoryRunner {
  private readonly repos: Repositories;
  private readonly llmConfig?: LlmConfig;
  private readonly llmConfigPath?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: CoreMemoryRunnerOptions['logger'];
  private readonly enabled: boolean;
  private readonly triggerMessageCount: number;
  private readonly inFlight = new Set<string>();
  private readonly pending = new Set<Promise<CoreMemoryRunResult>>();
  private closed = false;

  constructor(options: CoreMemoryRunnerOptions) {
    this.repos = options.repos;
    this.llmConfig = options.llmConfig;
    this.llmConfigPath = options.llmConfigPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? {
      warn: (message, detail) => console.warn(message, detail ?? ''),
      info: (message, detail) => console.log(message, detail ?? ''),
    };
    this.enabled = options.enabled ?? process.env.HEREIN_MEMORY_ENABLED !== '0';
    this.triggerMessageCount = options.triggerMessageCount
      ?? (Number.parseInt(process.env.HEREIN_MEMORY_TRIGGER_MESSAGES ?? '', 10) || 20);
  }

  async run(input: CoreMemoryRunInput): Promise<CoreMemoryRunResult> {
    if (!this.enabled || this.closed) {
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
    if (this.llmConfig) {
      return this.llmConfig;
    }

    try {
      return await loadLlmConfig(this.llmConfigPath);
    } catch {
      return null;
    }
  }

  private async execute(input: CoreMemoryRunInput): Promise<CoreMemoryRunResult> {
    try {
      const summary = this.repos.summaries.getByTimeline(input.timelineId);
      const totalCount = this.repos.messages.countByTimeline(input.timelineId);
      const summarizedCount = summary?.messageCount ?? 0;
      const needed = Math.max(0, totalCount - summarizedCount);

      if (needed < this.triggerMessageCount) {
        return {
          status: 'skipped',
          reason: `only ${needed} new messages, need ${this.triggerMessageCount}`,
        };
      }

      const freshMessages = this.repos.messages.listRecent(input.timelineId, needed);

      if (freshMessages.length < this.triggerMessageCount) {
        return {
          status: 'skipped',
          reason: `only ${freshMessages.length} new messages, need ${this.triggerMessageCount}`,
        };
      }

      const config = await this.resolveConfig();

      if (!config) {
        return { status: 'skipped', reason: 'LLM is not configured' };
      }

      const completion = await chatCompletion(
        config,
        [
          { role: 'system', content: MEMORY_SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(summary?.content, freshMessages) },
        ],
        {
          temperature: 0,
          maxTokens: 1400,
          fetchImpl: this.fetchImpl,
        },
      );

      const parsed = parseMemoryOutput(completion.content, input);

      if ('error' in parsed) {
        return { status: 'failed', error: parsed.error };
      }

      const sourceMessageIds = freshMessages.map(message => message.id);
      const summaryRecord: SummaryRecord = {
        id: `summary_${input.timelineId}`,
        timelineId: input.timelineId,
        content: parsed.summary,
        messageCount: totalCount,
        tokenEstimate: Math.ceil(parsed.summary.length / 2),
        sourceMessageIds,
        status: 'active',
      };

      this.repos.summaries.upsert(summaryRecord);

      const existing = new Set(
        this.repos.memories
          .listActive({ characterId: input.characterId, timelineId: input.timelineId })
          .map(memory => normalizeContent(memory.content)),
      );
      let memoryCount = 0;

      for (const memory of parsed.memories) {
        const normalized = normalizeContent(memory.content);

        if (existing.has(normalized)) {
          continue;
        }

        existing.add(normalized);
        memory.sourceMessageIds = memory.sourceMessageIds?.length
          ? memory.sourceMessageIds
          : sourceMessageIds;

        try {
          this.repos.memories.create(memory);
          memoryCount += 1;
        } catch (error) {
          this.logger?.warn('memory item was not persisted', error);
        }
      }

      this.logger?.info?.('memory update completed', {
        characterId: input.characterId,
        timelineId: input.timelineId,
        summaryId: summaryRecord.id,
        memoryCount,
      });

      return {
        status: 'updated',
        summaryId: summaryRecord.id,
        memoryCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn('memory update failed', error);
      return { status: 'failed', error: message };
    }
  }
}
