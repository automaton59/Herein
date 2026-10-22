import { describe, expect, it, vi } from 'vitest';
import type { LLMService, Message } from '../interfaces';
import type { Phase2PreloadAPI, Phase2AppSettings } from './types';
import { runPhase2MemoryUpdate, shouldRunMemoryUpdate } from './chatMemory';
import { MEMORY_SYSTEM_PROMPT, MEMORY_UPDATE_TASK_PROMPT } from './internalPrompts';

const settings: Pick<Phase2AppSettings, 'memoryEnabled' | 'summaryTriggerMessageCount'> = {
  memoryEnabled: true,
  summaryTriggerMessageCount: 2,
};

const messages: Message[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'I am moving from Hangzhou to Shanghai next week.',
    timestamp: new Date('2026-06-19T08:00:00.000Z'),
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'I will remember that timing.',
    timestamp: new Date('2026-06-19T08:01:00.000Z'),
  },
];

function makeClient(): Phase2PreloadAPI {
  return {
    bootstrap: vi.fn(),
    settings: {
      get: vi.fn(),
      set: vi.fn(),
    },
    profiles: {
      list: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    characters: {
      list: vi.fn(),
      upsert: vi.fn(),
    },
    relationship: {
      get: vi.fn(),
      upsert: vi.fn(),
    },
    timeline: {
      getPrimary: vi.fn(),
      listMessages: vi.fn(),
      appendMessage: vi.fn(),
      syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
      updateMessage: vi.fn(),
      updateTitle: vi.fn(),
      deleteAfter: vi.fn(),
      clearMessages: vi.fn(),
    },
    memory: {
      list: vi.fn(),
      create: vi.fn().mockResolvedValue(true),
      update: vi.fn(),
      delete: vi.fn(),
    },
    summary: {
      get: vi.fn(),
      upsert: vi.fn().mockResolvedValue(true),
    },
    assets: {
      importAvatar: vi.fn(),
      importExpression: vi.fn(),
      importVideo: vi.fn(),
      importLive2D: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getDataUrl: vi.fn(),
    },
    presentation: {
      getProfile: vi.fn(),
      upsertProfile: vi.fn(),
    },
    backup: {
      export: vi.fn(),
      restore: vi.fn(),
    },
    characterArchive: {
      export: vi.fn(),
      import: vi.fn(),
    },
  };
}

describe('chatMemory', () => {
  it('triggers only when memory is enabled and enough new messages exist after the previous summary', () => {
    expect(shouldRunMemoryUpdate({
      settings,
      messages,
      previousSummary: null,
    })).toBe(true);

    expect(shouldRunMemoryUpdate({
      settings,
      messages,
      previousSummary: {
        id: 'summary-1',
        timelineId: 'timeline-1',
        content: 'Already summarized.',
        messageCount: 1,
        sourceMessageIds: ['msg-1'],
      },
    })).toBe(false);

    expect(shouldRunMemoryUpdate({
      settings: { ...settings, memoryEnabled: false },
      messages,
      previousSummary: null,
    })).toBe(false);
  });

  it('writes parsed summary and structured memories to Phase 2 storage', async () => {
    const client = makeClient();
    const service: LLMService = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          conversationSummary: 'User is preparing to move from Hangzhou to Shanghai.',
          memoryItems: [
            {
              kind: 'state',
              scope: 'character',
              content: 'User will move from Hangzhou to Shanghai next week.',
              currentValue: 'Moving to Shanghai next week.',
              previousValue: 'Recently in Hangzhou.',
              confidence: 0.9,
            },
          ],
        }),
      }),
      streamChat: vi.fn(),
    };

    const result = await runPhase2MemoryUpdate({
      client,
      service,
      timelineId: 'timeline-1',
      characterId: 'char-1',
      messages,
      previousSummary: null,
    });

    expect(result.ok).toBe(true);
    expect(client.summary.upsert).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: 'timeline-1',
      content: 'User is preparing to move from Hangzhou to Shanghai.',
      messageCount: 2,
      sourceMessageIds: ['msg-1', 'msg-2'],
    }));
    expect(client.memory.create).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: 'timeline-1',
      characterId: 'char-1',
      kind: 'state',
      currentValue: 'Moving to Shanghai next week.',
    }));
  });

  it('uses internal memory prompts for the memory request', async () => {
    const client = makeClient();
    const service: LLMService = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          conversationSummary: 'Summary.',
          memoryItems: [],
        }),
      }),
      streamChat: vi.fn(),
    };

    await runPhase2MemoryUpdate({
      client,
      service,
      timelineId: 'timeline-1',
      characterId: 'char-1',
      messages,
      previousSummary: null,
    });

    expect(service.chat).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        expect.objectContaining({
          content: expect.stringContaining(MEMORY_UPDATE_TASK_PROMPT),
        }),
      ],
      systemPrompt: MEMORY_SYSTEM_PROMPT,
    }));
  });

  it('returns a failed result without writing when the model outputs chat text instead of JSON', async () => {
    const client = makeClient();
    const service: LLMService = {
      chat: vi.fn().mockResolvedValue({ content: '好的，我会记住。' }),
      streamChat: vi.fn(),
    };

    const result = await runPhase2MemoryUpdate({
      client,
      service,
      timelineId: 'timeline-1',
      characterId: 'char-1',
      messages,
      previousSummary: null,
    });

    expect(result.ok).toBe(false);
    expect(client.summary.upsert).not.toHaveBeenCalled();
    expect(client.memory.create).not.toHaveBeenCalled();
  });
});
