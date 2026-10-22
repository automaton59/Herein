import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIProfile, LLMConfig } from './interfaces';
import { loadAPIProfiles, saveAPIProfiles } from './apiProfiles';
import type { Phase2PreloadAPI } from './phase2/types';

const originalElectron = window.electron;

const legacyConfig: LLMConfig = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
};

const profileA: APIProfile = {
  id: 'profile-a',
  name: 'Profile A',
  provider: 'openai',
  model: 'gpt-4o-mini',
  encryptedApiKey: 'encrypted-a',
  keyEncoding: 'safe:v1',
};

const profileB: APIProfile = {
  id: 'profile-b',
  name: 'Profile B',
  provider: 'custom',
  baseURL: 'https://api.example.com/v1',
  model: 'model-b',
  encryptedApiKey: 'encrypted-b',
  keyEncoding: 'safe:v1',
};

function installPhase2Api(overrides: Partial<Phase2PreloadAPI>) {
  const api = {
    bootstrap: vi.fn().mockResolvedValue({ settings: {}, profiles: [], characters: [] }),
    settings: {
      get: vi.fn(),
      set: vi.fn(),
    },
    profiles: {
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
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

describe('apiProfiles Phase 2 persistence', () => {
  it('loads profiles from Phase 2 bootstrap when Electron storage is available', async () => {
    const api = installPhase2Api({
      bootstrap: vi.fn().mockResolvedValue({ settings: {}, profiles: [profileA], characters: [] }),
    });

    await expect(loadAPIProfiles(legacyConfig)).resolves.toEqual([profileA]);
    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(window.electron?.storage?.read).not.toHaveBeenCalled();
  });

  it('saves the full profile list by upserting current profiles and deleting stale Phase 2 rows', async () => {
    const api = installPhase2Api({
      profiles: {
        list: vi.fn().mockResolvedValue([profileA, profileB]),
        upsert: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    });

    await saveAPIProfiles([profileB]);

    expect(api.profiles.upsert).toHaveBeenCalledWith(profileB);
    expect(api.profiles.delete).toHaveBeenCalledWith('profile-a');
    expect(window.electron?.storage?.write).not.toHaveBeenCalled();
  });
});
