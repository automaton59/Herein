import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../interfaces';
import type { Phase2PreloadAPI } from '../phase2/types';
import { CHAT_BEHAVIOR_PROMPT, MEMORY_SYSTEM_PROMPT, MEMORY_UPDATE_TASK_PROMPT } from '../phase2/internalPrompts';
import { DEFAULT_VOICE_CONFIG } from '../phase3/voice';
import { ConfigService } from './index';

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
      upsert: vi.fn().mockResolvedValue(true),
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
  window.electron = originalElectron;
  localStorage.clear();
});

describe('ConfigService Phase 2 persistence', () => {
  it('keeps behavior and memory prompts as internal product prompts, not config defaults', () => {
    expect(CHAT_BEHAVIOR_PROMPT).toContain('私人 IM 陪伴应用');
    expect(CHAT_BEHAVIOR_PROMPT).toContain('内部提示词');
    expect(MEMORY_SYSTEM_PROMPT).toContain('You are not the chat character');
    expect(MEMORY_SYSTEM_PROMPT).toContain('Return valid JSON only');
    expect(MEMORY_UPDATE_TASK_PROMPT).toContain('natural development');
    expect(MEMORY_UPDATE_TASK_PROMPT).toContain('not a conflict');
    expect(MEMORY_UPDATE_TASK_PROMPT).toContain('previousValue');
  });

  it('loads app settings and characters from Phase 2 bootstrap', async () => {
    const api = installPhase2Api({
      bootstrap: vi.fn().mockResolvedValue({
        settings: {
          activeCharacterId: 'char-1',
          activeProfileId: 'profile-1',
          themeMode: 'dark',
          memoryEnabled: false,
          memoryProfileMode: 'custom',
          memoryProfileId: 'memory-profile',
          summaryTriggerMessageCount: 12,
          summaryPrompt: 'Summarize strictly.',
          extractionPrompt: 'Extract memories strictly.',
        },
        profiles: [],
        characters: [
          {
            id: 'char-1',
            name: 'AL-1S',
            description: 'Warm companion.',
            scenario: 'Private chat.',
            firstMessage: 'I am here.',
            systemPrompt: 'Stay in character.',
            personalityCore: 'Gentle.',
            speakingStyle: 'Natural.',
            valuesText: 'Care.',
            boundaries: 'No reasoning.',
          },
        ],
      }),
    });

    await expect(ConfigService.loadPersistent()).resolves.toEqual(expect.objectContaining({
      activeCharacterId: 'char-1',
      activeProfileId: 'profile-1',
      themeMode: 'dark',
      memoryEnabled: false,
      memoryProfileMode: 'custom',
      memoryProfileId: 'memory-profile',
      summaryTriggerMessageCount: 12,
      voice: DEFAULT_VOICE_CONFIG,
      characters: [
        expect.objectContaining({
          id: 'char-1',
          name: 'AL-1S',
          description: 'Warm companion.',
          scenario: 'Private chat.',
          firstMessage: 'I am here.',
          systemPrompt: 'Stay in character.',
          avatarAssetId: null,
        }),
      ],
    }));
    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(window.electron?.storage?.read).not.toHaveBeenCalled();
  });

  it('persists app settings and character profiles to Phase 2', async () => {
    const api = installPhase2Api({});
    const config: AppConfig = {
      llm: {
        provider: 'openai',
        apiKey: 'should-not-persist',
        model: 'gpt-4o-mini',
      },
      characters: [
        {
          id: 'char-1',
          name: 'AL-1S',
          description: 'Warm companion.',
          scenario: 'Private chat.',
          firstMessage: 'I am here.',
          systemPrompt: 'Stay in character.',
        },
      ],
      activeCharacterId: 'char-1',
      activeProfileId: 'profile-1',
      themeMode: 'light',
      memoryEnabled: true,
      memoryProfileMode: 'follow-chat',
      memoryProfileId: null,
      summaryTriggerMessageCount: 20,
      voice: {
        ...DEFAULT_VOICE_CONFIG,
        provider: 'gpt-sovits',
        gptSovits: {
          ...DEFAULT_VOICE_CONFIG.gptSovits,
          endpoint: 'http://127.0.0.1:9880/tts',
        },
      },
    };

    await ConfigService.savePersistent(config);

    expect(api.characters.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'char-1',
      name: 'AL-1S',
      personalityCore: '',
    }));
    expect(api.settings.set).toHaveBeenCalledWith('activeCharacterId', 'char-1');
    expect(api.settings.set).toHaveBeenCalledWith('activeProfileId', 'profile-1');
    expect(api.settings.set).toHaveBeenCalledWith('themeMode', 'light');
    expect(api.settings.set).toHaveBeenCalledWith('memoryEnabled', true);
    expect(api.settings.set).toHaveBeenCalledWith('voiceConfig', config.voice);
    expect(api.settings.set).not.toHaveBeenCalledWith('summaryPrompt', expect.anything());
    expect(api.settings.set).not.toHaveBeenCalledWith('extractionPrompt', expect.anything());
    expect(window.electron?.storage?.write).not.toHaveBeenCalled();
  });
});
