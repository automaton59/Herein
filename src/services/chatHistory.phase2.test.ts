import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from './interfaces';
import { CORE_URL_KEY, loadPersistentChatHistory, savePersistentChatHistory } from './chatHistory';
import type { Phase2PreloadAPI } from './phase2/types';

const originalElectron = window.electron;

function installPhase2Api(overrides: Partial<Phase2PreloadAPI>) {
  const api = {
    bootstrap: vi.fn().mockResolvedValue({ settings: {}, profiles: [], characters: [] }),
    settings: {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(true),
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
      appendMessage: vi.fn().mockResolvedValue(true),
      syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
      updateMessage: vi.fn().mockResolvedValue(true),
      updateTitle: vi.fn().mockResolvedValue(true),
      deleteAfter: vi.fn().mockResolvedValue(true),
      clearMessages: vi.fn().mockResolvedValue(true),
    },
    memory: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    summary: {
      get: vi.fn(),
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
    ...overrides,
  } satisfies Phase2PreloadAPI;

  window.electron = {
    platform: 'win32',
    phase2: api,
    storage: {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    },
  };

  return api;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.electron = originalElectron;
  localStorage.clear();
});

describe('chatHistory Phase 2 persistence', () => {
  it('loads one primary conversation per character from Phase 2 timelines', async () => {
    const api = installPhase2Api({
      bootstrap: vi.fn().mockResolvedValue({
        settings: { activeCharacterId: 'char-1' },
        profiles: [],
        characters: [
          {
            id: 'char-1',
            name: 'AL-1S',
            description: '',
            scenario: '',
            firstMessage: '',
            systemPrompt: '',
            personalityCore: '',
            speakingStyle: '',
            valuesText: '',
            boundaries: '',
          },
        ],
      }),
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
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'msg-1',
            timelineId: 'timeline-1',
            role: 'user',
            content: 'Hi',
            timestamp: '2026-06-19T08:00:00.000Z',
          },
        ]),
        appendMessage: vi.fn().mockResolvedValue(true),
        syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
        updateMessage: vi.fn(),
        updateTitle: vi.fn(),
        deleteAfter: vi.fn(),
        clearMessages: vi.fn(),
      },
    });

    await expect(loadPersistentChatHistory()).resolves.toEqual({
      activeConversationId: 'timeline-1',
      conversations: [
        {
          id: 'timeline-1',
          characterId: 'char-1',
          title: 'AL-1S',
          createdAt: new Date('2026-06-18T08:00:00.000Z'),
          updatedAt: new Date('2026-06-19T08:00:00.000Z'),
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Hi',
              timestamp: new Date('2026-06-19T08:00:00.000Z'),
            },
          ],
        },
      ],
    });
    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(api.timeline.getPrimary).toHaveBeenCalledWith('char-1');
    expect(window.electron?.storage?.read).not.toHaveBeenCalled();
  });

  it('persists edited conversations into Phase 2 by updating existing messages and appending new ones', async () => {
    const api = installPhase2Api({
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
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'msg-1',
            timelineId: 'timeline-1',
            role: 'user',
            content: 'Old content',
            timestamp: '2026-06-19T08:00:00.000Z',
          },
        ]),
        appendMessage: vi.fn().mockResolvedValue(true),
        syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
        updateMessage: vi.fn().mockResolvedValue(true),
        updateTitle: vi.fn().mockResolvedValue(true),
        deleteAfter: vi.fn().mockResolvedValue(true),
        clearMessages: vi.fn().mockResolvedValue(true),
      },
    });
    const conversations: Conversation[] = [
      {
        id: 'timeline-1',
        characterId: 'char-1',
        title: 'AL-1S',
        createdAt: new Date('2026-06-18T08:00:00.000Z'),
        updatedAt: new Date('2026-06-19T08:01:00.000Z'),
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Updated content',
            timestamp: new Date('2026-06-19T08:00:00.000Z'),
            status: 'sent',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Reply',
            timestamp: new Date('2026-06-19T08:01:00.000Z'),
          },
        ],
      },
    ];

    await savePersistentChatHistory(conversations, 'timeline-1');

    expect(api.timeline.syncMessages).toHaveBeenCalledWith('timeline-1', [
      expect.objectContaining({
        id: 'msg-1',
        timelineId: 'timeline-1',
        content: 'Updated content',
        status: 'sent',
      }),
      expect.objectContaining({
        id: 'msg-2',
        timelineId: 'timeline-1',
        content: 'Reply',
      }),
    ], 'AL-1S');
    expect(api.timeline.updateMessage).not.toHaveBeenCalled();
    expect(api.timeline.appendMessage).not.toHaveBeenCalled();
    expect(api.settings.set).toHaveBeenCalledWith('activeCharacterId', 'char-1');
    expect(window.electron?.storage?.write).not.toHaveBeenCalled();
  });

  it('persists local contact remarks as timeline titles without changing character names', async () => {
    const api = installPhase2Api({
      bootstrap: vi.fn().mockResolvedValue({
        settings: {},
        profiles: [],
        characters: [
          {
            id: 'char-1',
            name: 'AL-1S',
            description: '',
            scenario: '',
            firstMessage: '',
            systemPrompt: '',
            personalityCore: '',
            speakingStyle: '',
            valuesText: '',
            boundaries: '',
          },
        ],
      }),
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
        listMessages: vi.fn().mockResolvedValue([]),
        appendMessage: vi.fn().mockResolvedValue(true),
        syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
        updateMessage: vi.fn().mockResolvedValue(true),
        updateTitle: vi.fn().mockResolvedValue(true),
        deleteAfter: vi.fn().mockResolvedValue(true),
        clearMessages: vi.fn().mockResolvedValue(true),
      },
    });

    await savePersistentChatHistory([
      {
        id: 'timeline-1',
        characterId: 'char-1',
        title: 'AL-1S',
        contactRemark: '晚上好',
        createdAt: new Date('2026-06-18T08:00:00.000Z'),
        updatedAt: new Date('2026-06-19T08:01:00.000Z'),
        messages: [],
      },
    ], 'timeline-1');

    expect(api.timeline.syncMessages).toHaveBeenCalledWith('timeline-1', [], '晚上好');
    expect(api.timeline.updateTitle).not.toHaveBeenCalled();
    expect(api.characters.upsert).not.toHaveBeenCalled();
  });

  it('clears the Phase 2 timeline when a primary conversation has no messages', async () => {
    const api = installPhase2Api({
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
        listMessages: vi.fn().mockResolvedValue([
          {
            id: 'msg-1',
            timelineId: 'timeline-1',
            role: 'user',
            content: 'Old content',
            timestamp: '2026-06-19T08:00:00.000Z',
          },
        ]),
        appendMessage: vi.fn().mockResolvedValue(true),
        syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
        updateMessage: vi.fn().mockResolvedValue(true),
        updateTitle: vi.fn().mockResolvedValue(true),
        deleteAfter: vi.fn().mockResolvedValue(true),
        clearMessages: vi.fn().mockResolvedValue(true),
      },
    });

    await savePersistentChatHistory([
      {
        id: 'timeline-1',
        characterId: 'char-1',
        title: 'AL-1S',
        createdAt: new Date('2026-06-18T08:00:00.000Z'),
        updatedAt: new Date('2026-06-19T08:01:00.000Z'),
        messages: [],
      },
    ], 'timeline-1');

    expect(api.timeline.syncMessages).toHaveBeenCalledWith('timeline-1', [], 'AL-1S');
    expect(api.timeline.clearMessages).not.toHaveBeenCalled();
    expect(api.timeline.deleteAfter).not.toHaveBeenCalled();
  });

  it('prefers the configured Core HTTP endpoint for timeline sync', async () => {
    const api = installPhase2Api({
      bootstrap: vi.fn().mockResolvedValue({
        settings: {},
        profiles: [],
        characters: [{ id: 'char-1', name: 'AL-1S' }],
      }),
    });
    localStorage.setItem(CORE_URL_KEY, 'http://core.test');

    const respond = (body: unknown) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as Response;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);

      if (url.endsWith('/health')) {
        return respond({ ok: true, version: '0.1.0' });
      }

      if (url.includes('/v1/timeline/char-1/sync')) {
        return respond({
          timeline: { id: 'timeline-1', characterId: 'char-1', title: 'AL-1S' },
          result: { inserted: 1, updated: 0, deleted: 0 },
        });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await savePersistentChatHistory([
      {
        id: 'timeline-1',
        characterId: 'char-1',
        title: 'AL-1S',
        createdAt: new Date('2026-06-18T08:00:00.000Z'),
        updatedAt: new Date('2026-06-19T08:01:00.000Z'),
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: '在吗',
            timestamp: new Date('2026-06-19T08:00:00.000Z'),
          },
        ],
      },
    ], 'timeline-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const syncCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/sync'));
    expect(syncCall).toBeTruthy();
    const body = JSON.parse(String((syncCall?.[1] as RequestInit | undefined)?.body)) as {
      title: string;
      messages: Array<{ content: string; timelineId: string }>;
    };
    expect(body.title).toBe('AL-1S');
    expect(body.messages[0]).toEqual(expect.objectContaining({
      content: '在吗',
      timelineId: 'pending',
    }));
    expect(api.timeline.syncMessages).not.toHaveBeenCalled();
    expect(api.settings.set).toHaveBeenCalledWith('activeCharacterId', 'char-1');
  });
});
