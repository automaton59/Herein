import { describe, expect, it, vi } from 'vitest';
import type { CharacterConfig, Message } from '../interfaces';
import type { Phase2PreloadAPI } from './types';
import { buildPhase2ChatContext } from './chatContext';

const character: CharacterConfig = {
  id: 'char-1',
  name: 'AL-1S',
  description: 'Warm companion.',
  scenario: 'Private chat.',
  firstMessage: 'I am here.',
  systemPrompt: 'Stay in character.',
};

const messages: Message[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'I am packing.',
    timestamp: new Date('2026-06-19T08:00:00.000Z'),
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
      get: vi.fn().mockResolvedValue({
        characterId: 'char-1',
        tone: 'close and relaxed',
        closeness: 4,
        sharedHabits: 'Say good night.',
        privateLanguage: 'soft nickname',
        importantExperiences: 'Gift on August 3.',
        unresolvedContext: 'Moving logistics.',
      }),
      upsert: vi.fn(),
    },
    timeline: {
      getPrimary: vi.fn().mockResolvedValue({
        id: 'timeline-1',
        characterId: 'char-1',
        title: 'AL-1S',
        kind: 'primary',
        isPrimary: true,
        createdAt: '2026-06-18T08:00:00.000Z',
        updatedAt: '2026-06-19T08:00:00.000Z',
      }),
      listMessages: vi.fn(),
      appendMessage: vi.fn(),
      syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
      updateMessage: vi.fn(),
      updateTitle: vi.fn(),
      deleteAfter: vi.fn(),
      clearMessages: vi.fn(),
    },
    memory: {
      list: vi.fn().mockResolvedValue([
        {
          id: 'mem-1',
          characterId: 'char-1',
          timelineId: 'timeline-1',
          scope: 'character',
          kind: 'state',
          content: 'User is moving to Shanghai next week.',
          currentValue: 'Moving to Shanghai next week.',
          previousValue: 'Recently in Hangzhou.',
        },
      ]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    summary: {
      get: vi.fn().mockResolvedValue({
        id: 'summary-1',
        timelineId: 'timeline-1',
        content: 'They discussed packing and moving logistics.',
        messageCount: 10,
        sourceMessageIds: ['msg-old'],
      }),
      upsert: vi.fn(),
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

describe('buildPhase2ChatContext', () => {
  it('loads the primary timeline summary and active memories before assembling the chat prompt', async () => {
    const client = makeClient();

    const context = await buildPhase2ChatContext({
      client,
      character,
      messages,
    });

    expect(client.timeline.getPrimary).toHaveBeenCalledWith('char-1');
    expect(client.relationship.get).toHaveBeenCalledWith('char-1');
    expect(client.summary.get).toHaveBeenCalledWith('timeline-1');
    expect(client.memory.list).toHaveBeenCalledWith({
      characterId: 'char-1',
      timelineId: 'timeline-1',
      activeOnly: true,
    });
    expect(context.timelineId).toBe('timeline-1');
    expect(context.systemPrompt).toContain('They discussed packing and moving logistics.');
    expect(context.systemPrompt).toContain('close and relaxed');
    expect(context.systemPrompt).toContain('Gift on August 3.');
    expect(context.systemPrompt).toContain('Moving to Shanghai next week.');
    expect(context.systemPrompt).toContain('Previously: Recently in Hangzhou.');
    expect(context.recentMessages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        timelineId: 'timeline-1',
        content: 'I am packing.',
      }),
    ]);
  });
});
