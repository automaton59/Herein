import { create } from 'zustand';
import type { APIProfile, CharacterConfig, ConnectionStatus, LLMConfig, ThemeMode, VoiceConfig } from '../services/interfaces';
import { ConfigService } from '../services/config';
import { DEFAULT_CHARACTER } from '../services/character';
import {
  generateAPIProfileId,
  loadAPIProfiles,
  makeAPIProfile,
  profileToLLMConfig,
  saveAPIProfiles,
} from '../services/apiProfiles';
import { listLLMModels } from '../services/llm/modelDiscovery';
import { LLMServiceFactory } from '../services/llm';
import { applyThemeMode } from '../services/theme';
import type { AppConfig } from '../services/interfaces';

let characterCounter = 0;

function generateCharacterId() {
  return `character_${Date.now()}_${characterCounter++}`;
}

function getCharacterById(characters: CharacterConfig[], id: string) {
  return characters.find(character => character.id === id) || characters[0] || DEFAULT_CHARACTER;
}

function makeNewCharacter(index: number): CharacterConfig {
  return {
    ...DEFAULT_CHARACTER,
    id: generateCharacterId(),
    name: `新角色 ${index}`,
  };
}

function isLLMConfigured(llmConfig: LLMConfig) {
  const needsBaseURL = llmConfig.provider === 'deepseek' || llmConfig.provider === 'custom';
  return Boolean(
    llmConfig.apiKey.trim()
    && llmConfig.model.trim()
    && (!needsBaseURL || llmConfig.baseURL?.trim())
  );
}

function makeBlankLLMConfig(): LLMConfig {
  return {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.8,
    maxTokens: 2000,
  };
}

interface SettingsState {
  llmConfig: LLMConfig;
  apiProfiles: APIProfile[];
  activeProfileId: string | null;
  characters: CharacterConfig[];
  activeCharacterId: string;
  characterConfig: CharacterConfig;
  themeMode: ThemeMode;
  voiceConfig: VoiceConfig;
  memoryEnabled: boolean;
  memoryProfileMode: AppConfig['memoryProfileMode'];
  memoryProfileId: string | null;
  summaryTriggerMessageCount: number;
  isConfigured: boolean;
  isHydrated: boolean;
  connectionStatus: ConnectionStatus;
  lastConnectionError: string | null;
  hydrate: () => Promise<void>;
  updateLLMConfig: (config: Partial<LLMConfig>, profileName?: string) => Promise<void>;
  createAPIProfile: () => Promise<string>;
  selectAPIProfile: (profileId: string) => Promise<void>;
  deleteAPIProfile: (profileId: string) => Promise<void>;
  checkConnection: () => Promise<boolean>;
  setConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
  markConnectionOnline: () => Promise<void>;
  setActiveCharacter: (characterId: string) => void;
  updateCharacterConfig: (config: Partial<CharacterConfig>) => void;
  createCharacter: () => string;
  duplicateCharacter: (characterId?: string) => string;
  deleteCharacter: (characterId: string) => void;
  setThemeMode: (themeMode: ThemeMode) => void;
  updateVoiceConfig: (config: Partial<Omit<VoiceConfig, 'gptSovits' | 'qwen3Tts' | 'qwen3VoiceClone'>> & {
    gptSovits?: Partial<VoiceConfig['gptSovits']>;
    qwen3Tts?: Partial<VoiceConfig['qwen3Tts']>;
    qwen3VoiceClone?: Partial<VoiceConfig['qwen3VoiceClone']>;
  }) => void;
  updateMemorySettings: (config: Partial<Pick<AppConfig,
    | 'memoryEnabled'
    | 'memoryProfileMode'
    | 'memoryProfileId'
    | 'summaryTriggerMessageCount'
  >>) => void;
  checkConfigured: () => boolean;
}

const initialConfig = ConfigService.load();
const initialCharacter = getCharacterById(initialConfig.characters, initialConfig.activeCharacterId);

async function persistAppConfig(state: SettingsState) {
  await ConfigService.savePersistent({
    llm: { ...state.llmConfig, apiKey: '' },
    characters: state.characters,
    activeCharacterId: state.activeCharacterId,
    activeProfileId: state.activeProfileId,
    themeMode: state.themeMode,
    voice: state.voiceConfig,
    memoryEnabled: state.memoryEnabled,
    memoryProfileMode: state.memoryProfileMode,
    memoryProfileId: state.memoryProfileId,
    summaryTriggerMessageCount: state.summaryTriggerMessageCount,
  });
}

async function saveCurrentProfile(
  state: SettingsState,
  llmConfig: LLMConfig,
  profileName?: string,
) {
  const activeProfile = state.apiProfiles.find(profile => profile.id === state.activeProfileId);
  const profile = await makeAPIProfile(
    llmConfig,
    profileName || activeProfile?.name,
    activeProfile?.id || generateAPIProfileId(),
  );
  const mergedProfile = {
    ...profile,
    lastConnectedAt: activeProfile?.lastConnectedAt,
  };
  const apiProfiles = activeProfile
    ? state.apiProfiles.map(item => item.id === activeProfile.id ? mergedProfile : item)
    : [...state.apiProfiles, mergedProfile];

  await saveAPIProfiles(apiProfiles);
  return {
    apiProfiles,
    activeProfileId: mergedProfile.id,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  llmConfig: initialConfig.llm,
  apiProfiles: [],
  activeProfileId: initialConfig.activeProfileId || null,
  characters: initialConfig.characters,
  activeCharacterId: initialConfig.activeCharacterId,
  characterConfig: initialCharacter,
  themeMode: initialConfig.themeMode,
  voiceConfig: initialConfig.voice,
  memoryEnabled: initialConfig.memoryEnabled,
  memoryProfileMode: initialConfig.memoryProfileMode,
  memoryProfileId: initialConfig.memoryProfileId || null,
  summaryTriggerMessageCount: initialConfig.summaryTriggerMessageCount,
  isConfigured: false,
  isHydrated: false,
  connectionStatus: isLLMConfigured(initialConfig.llm) ? 'checking' : 'unconfigured',
  lastConnectionError: null,

  hydrate: async () => {
    const config = await ConfigService.loadPersistent();
    const apiProfiles = await loadAPIProfiles(config.llm);
    const activeProfileId = apiProfiles.some(profile => profile.id === config.activeProfileId)
      ? config.activeProfileId || apiProfiles[0].id
      : apiProfiles[0]?.id || null;
    const activeProfile = apiProfiles.find(profile => profile.id === activeProfileId);
    const llmConfig = activeProfile
      ? await profileToLLMConfig(activeProfile)
      : config.llm;
    const characterConfig = getCharacterById(config.characters, config.activeCharacterId);
    const configured = isLLMConfigured(llmConfig);

    applyThemeMode(config.themeMode);

    set({
      llmConfig,
      apiProfiles,
      activeProfileId,
      characters: config.characters,
      activeCharacterId: characterConfig.id,
      characterConfig,
      themeMode: config.themeMode,
      voiceConfig: config.voice,
      memoryEnabled: config.memoryEnabled,
      memoryProfileMode: config.memoryProfileMode,
      memoryProfileId: config.memoryProfileId || null,
      summaryTriggerMessageCount: config.summaryTriggerMessageCount,
      isConfigured: configured,
      isHydrated: true,
      connectionStatus: configured ? 'checking' : 'unconfigured',
      lastConnectionError: null,
    });

    await persistAppConfig(get());

    if (configured) {
      void get().checkConnection();
    }
  },

  updateLLMConfig: async (config, profileName) => {
    const llmConfig = { ...get().llmConfig, ...config };
    const profileUpdate = await saveCurrentProfile(get(), llmConfig, profileName);

    set({
      llmConfig,
      ...profileUpdate,
      isConfigured: isLLMConfigured(llmConfig),
      connectionStatus: isLLMConfigured(llmConfig) ? 'offline' : 'unconfigured',
      lastConnectionError: null,
    });
    await persistAppConfig(get());
  },

  createAPIProfile: async () => {
    const profile = await makeAPIProfile(makeBlankLLMConfig(), `API ${get().apiProfiles.length + 1}`);
    const apiProfiles = [...get().apiProfiles, profile];

    await saveAPIProfiles(apiProfiles);
    set({
      apiProfiles,
      activeProfileId: profile.id,
      llmConfig: await profileToLLMConfig(profile),
      isConfigured: false,
      connectionStatus: 'unconfigured',
      lastConnectionError: null,
    });
    await persistAppConfig(get());
    return profile.id;
  },

  selectAPIProfile: async (profileId) => {
    const profile = get().apiProfiles.find(item => item.id === profileId);

    if (!profile) {
      return;
    }

    const llmConfig = await profileToLLMConfig(profile);
    const configured = isLLMConfigured(llmConfig);

    set({
      activeProfileId: profile.id,
      llmConfig,
      isConfigured: configured,
      connectionStatus: configured ? 'checking' : 'unconfigured',
      lastConnectionError: null,
    });
    await persistAppConfig(get());

    if (configured) {
      void get().checkConnection();
    }
  },

  deleteAPIProfile: async (profileId) => {
    let apiProfiles = get().apiProfiles.filter(profile => profile.id !== profileId);

    if (apiProfiles.length === 0) {
      apiProfiles = [await makeAPIProfile(makeBlankLLMConfig(), 'OpenAI', 'default-api-profile')];
    }

    const nextProfile = get().activeProfileId === profileId
      ? apiProfiles[0]
      : apiProfiles.find(profile => profile.id === get().activeProfileId) || apiProfiles[0];
    const llmConfig = await profileToLLMConfig(nextProfile);

    await saveAPIProfiles(apiProfiles);
    set({
      apiProfiles,
      activeProfileId: nextProfile.id,
      llmConfig,
      isConfigured: isLLMConfigured(llmConfig),
      connectionStatus: isLLMConfigured(llmConfig) ? 'offline' : 'unconfigured',
      lastConnectionError: null,
    });
    await persistAppConfig(get());
  },

  checkConnection: async () => {
    const { llmConfig } = get();

    if (!isLLMConfigured(llmConfig)) {
      set({ isConfigured: false, connectionStatus: 'unconfigured', lastConnectionError: null });
      return false;
    }

    set({ connectionStatus: 'checking', lastConnectionError: null });

    try {
      try {
        await listLLMModels(llmConfig);
      } catch {
        const service = LLMServiceFactory.create(llmConfig);
        await service.chat({
          messages: [{
            id: 'connection_probe',
            role: 'user',
            content: 'ping',
            timestamp: new Date(),
          }],
          systemPrompt: '只回复 OK。',
          temperature: 0,
          maxTokens: 8,
        });
      }

      await get().markConnectionOnline();
      return true;
    } catch (error) {
      set({
        connectionStatus: 'offline',
        lastConnectionError: error instanceof Error ? error.message : '连接失败',
      });
      return false;
    }
  },

  setConnectionStatus: (status, error = null) => {
    set({ connectionStatus: status, lastConnectionError: error });
  },

  markConnectionOnline: async () => {
    const { activeProfileId, apiProfiles } = get();
    const lastConnectedAt = new Date().toISOString();
    const nextProfiles = apiProfiles.map(profile =>
      profile.id === activeProfileId
        ? { ...profile, lastConnectedAt }
        : profile
    );

    await saveAPIProfiles(nextProfiles);
    set({
      apiProfiles: nextProfiles,
      connectionStatus: 'online',
      lastConnectionError: null,
      isConfigured: isLLMConfigured(get().llmConfig),
    });
  },

  setActiveCharacter: (characterId) => {
    const { characters } = get();
    const characterConfig = getCharacterById(characters, characterId);

    set({
      activeCharacterId: characterConfig.id,
      characterConfig,
    });
    void persistAppConfig(get());
  },

  updateCharacterConfig: (config) => {
    const { characters, activeCharacterId } = get();
    const updatedCharacters = characters.map(character =>
      character.id === activeCharacterId
        ? { ...character, ...config, id: character.id }
        : character
    );
    const characterConfig = getCharacterById(updatedCharacters, activeCharacterId);

    set({
      characters: updatedCharacters,
      characterConfig,
    });
    void persistAppConfig(get());
  },

  createCharacter: () => {
    const { characters } = get();
    const character = makeNewCharacter(characters.length + 1);
    const updatedCharacters = [...characters, character];

    set({
      characters: updatedCharacters,
      activeCharacterId: character.id,
      characterConfig: character,
    });
    void persistAppConfig(get());
    return character.id;
  },

  duplicateCharacter: (characterId) => {
    const { characters, activeCharacterId } = get();
    const source = getCharacterById(characters, characterId || activeCharacterId);
    const character: CharacterConfig = {
      ...source,
      id: generateCharacterId(),
      name: `${source.name} 副本`,
    };
    const updatedCharacters = [...characters, character];

    set({
      characters: updatedCharacters,
      activeCharacterId: character.id,
      characterConfig: character,
    });
    void persistAppConfig(get());
    return character.id;
  },

  deleteCharacter: (characterId) => {
    const { characters, activeCharacterId } = get();

    if (characters.length <= 1) {
      return;
    }

    const updatedCharacters = characters.filter(character => character.id !== characterId);
    const nextActiveCharacterId = activeCharacterId === characterId
      ? updatedCharacters[0].id
      : activeCharacterId;
    const characterConfig = getCharacterById(updatedCharacters, nextActiveCharacterId);

    set({
      characters: updatedCharacters,
      activeCharacterId: characterConfig.id,
      characterConfig,
    });
    void persistAppConfig(get());
  },

  setThemeMode: (themeMode) => {
    applyThemeMode(themeMode);
    set({ themeMode });
    void persistAppConfig(get());
  },

  updateVoiceConfig: (config) => {
    set({
      voiceConfig: {
        ...get().voiceConfig,
        ...config,
        gptSovits: {
          ...get().voiceConfig.gptSovits,
          ...config.gptSovits,
        },
        qwen3Tts: {
          ...get().voiceConfig.qwen3Tts,
          ...config.qwen3Tts,
        },
        qwen3VoiceClone: {
          ...get().voiceConfig.qwen3VoiceClone,
          ...config.qwen3VoiceClone,
        },
      },
    });
    void persistAppConfig(get());
  },

  updateMemorySettings: (config) => {
    set(config);
    void persistAppConfig(get());
  },

  checkConfigured: () => {
    const configured = isLLMConfigured(get().llmConfig);
    set({
      isConfigured: configured,
      connectionStatus: configured ? get().connectionStatus : 'unconfigured',
    });
    return configured;
  },
}));

void useSettingsStore.getState().hydrate();
