import type { LLMService, Message } from '../interfaces';
import {
  buildMemoryUpdatePrompt,
  parseMemoryUpdateOutput,
} from './memoryRunner';
import { MEMORY_SYSTEM_PROMPT } from './internalPrompts';
import type { ConversationSummary, Phase2AppSettings, Phase2PreloadAPI } from './types';

interface ShouldRunMemoryUpdateInput {
  settings: Pick<Phase2AppSettings, 'memoryEnabled' | 'summaryTriggerMessageCount'>;
  messages: Message[];
  previousSummary?: ConversationSummary | null;
}

interface RunPhase2MemoryUpdateInput {
  client: Phase2PreloadAPI;
  service: LLMService;
  timelineId: string;
  characterId: string;
  messages: Message[];
  previousSummary?: ConversationSummary | null;
}

type MemoryUpdateRunResult =
  | { ok: true; summaryId: string; memoryCount: number }
  | { ok: false; error: string };

export function shouldRunMemoryUpdate(input: ShouldRunMemoryUpdateInput) {
  if (!input.settings.memoryEnabled) {
    return false;
  }

  const summarizedCount = input.previousSummary?.messageCount ?? 0;
  return input.messages.length - summarizedCount >= input.settings.summaryTriggerMessageCount;
}

export async function runPhase2MemoryUpdate(input: RunPhase2MemoryUpdateInput): Promise<MemoryUpdateRunResult> {
  const prompt = buildMemoryUpdatePrompt({
    previousSummary: input.previousSummary?.content,
    messages: input.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
    })),
  });

  try {
    const response = await input.service.chat({
      messages: [{
        id: `memory_update_${input.timelineId}`,
        role: 'user',
        content: prompt,
        timestamp: new Date(),
      }],
      systemPrompt: MEMORY_SYSTEM_PROMPT,
      temperature: 0,
    });
    const parsed = parseMemoryUpdateOutput(response.content, {
      timelineId: input.timelineId,
      characterId: input.characterId,
    });

    if (!parsed.ok) {
      return parsed;
    }

    const sourceMessageIds = input.messages.map(message => message.id);
    const summary = {
      ...parsed.summary,
      messageCount: input.messages.length,
      sourceMessageIds,
    };

    await input.client.summary.upsert(summary);
    await Promise.all(parsed.memories.map(memory => input.client.memory.create({
      ...memory,
      sourceMessageIds: memory.sourceMessageIds?.length ? memory.sourceMessageIds : sourceMessageIds,
    })));

    return {
      ok: true,
      summaryId: summary.id,
      memoryCount: parsed.memories.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Memory update failed.',
    };
  }
}
