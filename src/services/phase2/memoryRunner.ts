import type { ConversationSummary, MemoryItem, MemoryKind, MemoryScope } from './types';
import { MEMORY_UPDATE_TASK_PROMPT } from './internalPrompts';

interface PromptMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface BuildMemoryUpdatePromptInput {
  previousSummary?: string;
  messages: PromptMessage[];
}

interface ParseContext {
  timelineId: string;
  characterId: string;
}

type MemoryUpdateResult =
  | { ok: true; summary: ConversationSummary; memories: MemoryItem[] }
  | { ok: false; error: string };

const MEMORY_KINDS: MemoryKind[] = ['state', 'event', 'preference', 'relationship', 'profile'];
const MEMORY_SCOPES: MemoryScope[] = ['global', 'character', 'timeline'];

function makeId(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as string[]).includes(value);
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && (MEMORY_SCOPES as string[]).includes(value);
}

export function buildMemoryUpdatePrompt(input: BuildMemoryUpdatePromptInput) {
  const transcript = input.messages
    .map((message, index) => {
      const id = message.id?.trim() || `message-${index + 1}`;
      return `[${id}] ${message.role}: ${message.content}`;
    })
    .join('\n');

  return [
    MEMORY_UPDATE_TASK_PROMPT,
    input.previousSummary ? `Previous summary:\n${input.previousSummary}` : 'Previous summary: none',
    `New messages:\n${transcript}`,
  ].join('\n\n');
}

export function parseMemoryUpdateOutput(rawOutput: string, context: ParseContext): MemoryUpdateResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return { ok: false, error: 'Memory output was not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Memory output did not include a valid conversationSummary.' };
  }

  const record = parsed as Record<string, unknown>;
  const conversationSummary = record.conversationSummary;

  if (typeof conversationSummary !== 'string' || !conversationSummary.trim()) {
    return { ok: false, error: 'Memory output did not include a valid conversationSummary.' };
  }

  const rawItems = Array.isArray(record.memoryItems) ? record.memoryItems : [];
  const memories: MemoryItem[] = [];

  for (const item of rawItems) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const memory = item as Record<string, unknown>;
    if (!isMemoryKind(memory.kind) || !isMemoryScope(memory.scope) || typeof memory.content !== 'string') {
      continue;
    }

    memories.push({
      id: makeId('memory'),
      timelineId: context.timelineId,
      characterId: memory.scope === 'global' ? null : context.characterId,
      kind: memory.kind,
      scope: memory.scope,
      content: memory.content,
      currentValue: typeof memory.currentValue === 'string' ? memory.currentValue : null,
      previousValue: typeof memory.previousValue === 'string' ? memory.previousValue : null,
      historicalNote: typeof memory.historicalNote === 'string' ? memory.historicalNote : null,
      sourceMessageIds: Array.isArray(memory.sourceMessageIds)
        ? memory.sourceMessageIds.filter((id): id is string => typeof id === 'string')
        : [],
      confidence: typeof memory.confidence === 'number' ? memory.confidence : null,
      origin: 'summary',
      status: 'active',
      pinned: Boolean(memory.pinned),
      includeInContext: true,
    });
  }

  return {
    ok: true,
    summary: {
      id: `summary_${context.timelineId}`,
      timelineId: context.timelineId,
      content: conversationSummary.trim(),
      messageCount: 0,
      sourceMessageIds: [],
      status: 'active',
    },
    memories,
  };
}
