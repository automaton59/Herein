import type { AppConfig, CharacterConfig, LLMConfig, ThemeMode } from '../interfaces';
import { DEFAULT_CHARACTER } from '../character';
import { createPhase2Client } from '../phase2/client';
import { characterConfigToProfile, characterProfileToConfig } from '../phase2/mappers';
import { DEFAULT_VOICE_CONFIG, normalizeVoiceConfig } from '../phase3/voice';
import { readJSONFile, writeJSONFile } from '../storage';

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.8,
    maxTokens: 2000,
  },
  characters: [DEFAULT_CHARACTER],
  activeCharacterId: DEFAULT_CHARACTER.id,
  activeProfileId: null,
  themeMode: 'light',
  voice: DEFAULT_VOICE_CONFIG,
  memoryEnabled: true,
  memoryProfileMode: 'follow-chat',
  memoryProfileId: null,
  summaryTriggerMessageCount: 20,
  connectionAuto: true,
};

type StoredAppConfig = Partial<AppConfig> & {
  character?: Partial<CharacterConfig>;
};

function normalizeCharacter(character: Partial<CharacterConfig> | undefined, fallback: CharacterConfig): CharacterConfig {
  return {
    ...fallback,
    ...(character || {}),
    id: character?.id?.trim() || fallback.id,
    name: character?.name?.trim() || fallback.name,
    description: character?.description ?? fallback.description,
    scenario: character?.scenario ?? fallback.scenario,
    firstMessage: character?.firstMessage ?? fallback.firstMessage,
    systemPrompt: character?.systemPrompt ?? fallback.systemPrompt,
    avatarAssetId: character?.avatarAssetId ?? fallback.avatarAssetId ?? null,
  };
}

function normalizeCharacters(parsed: StoredAppConfig): CharacterConfig[] {
  const rawCharacters = Array.isArray(parsed.characters) && parsed.characters.length > 0
    ? parsed.characters
    : [parsed.character || DEFAULT_CHARACTER];

  const usedIds = new Set<string>();

  return rawCharacters.map((character, index) => {
    const fallback = index === 0
      ? DEFAULT_CHARACTER
      : { ...DEFAULT_CHARACTER, id: `character_${index + 1}`, name: `角色 ${index + 1}` };
    const normalized = normalizeCharacter(character, fallback);
    let id = normalized.id;

    if (usedIds.has(id)) {
      id = `${id}_${index + 1}`;
    }

    usedIds.add(id);
    return { ...normalized, id };
  });
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_CONFIG.themeMode;
}

function normalizeMemoryProfileMode(value: unknown): AppConfig['memoryProfileMode'] {
  return value === 'custom' || value === 'follow-chat' ? value : DEFAULT_CONFIG.memoryProfileMode;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeConfig(parsed: StoredAppConfig | null | undefined): AppConfig {
  if (!parsed) {
    return DEFAULT_CONFIG;
  }

  const characters = normalizeCharacters(parsed);
  const activeCharacterId = characters.some(character => character.id === parsed.activeCharacterId)
    ? parsed.activeCharacterId as string
    : characters[0].id;

  return {
    llm: { ...DEFAULT_CONFIG.llm, ...(parsed.llm || {}) },
    characters,
    activeCharacterId,
    activeProfileId: typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : null,
    themeMode: normalizeThemeMode(parsed.themeMode),
    voice: normalizeVoiceConfig(parsed.voice),
    memoryEnabled: typeof parsed.memoryEnabled === 'boolean' ? parsed.memoryEnabled : DEFAULT_CONFIG.memoryEnabled,
    memoryProfileMode: normalizeMemoryProfileMode(parsed.memoryProfileMode),
    memoryProfileId: typeof parsed.memoryProfileId === 'string' ? parsed.memoryProfileId : null,
    summaryTriggerMessageCount: normalizePositiveInteger(
      parsed.summaryTriggerMessageCount,
      DEFAULT_CONFIG.summaryTriggerMessageCount,
    ),
    connectionAuto: parsed.connectionAuto !== false,
  };
}

function sanitizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    llm: { ...config.llm, apiKey: '' },
  };
}

function hasPhase2Storage() {
  return Boolean(window.electron?.phase2);
}

function phase2SettingsToConfig(input: Awaited<ReturnType<ReturnType<typeof createPhase2Client>['bootstrap']>>): AppConfig {
  const characters = input.characters.length > 0
    ? input.characters.map(characterProfileToConfig)
    : [DEFAULT_CHARACTER];
  const activeCharacterId = typeof input.settings.activeCharacterId === 'string'
    && characters.some(character => character.id === input.settings.activeCharacterId)
    ? input.settings.activeCharacterId
    : characters[0].id;

  return normalizeConfig({
    llm: DEFAULT_CONFIG.llm,
    characters,
    activeCharacterId,
    activeProfileId: typeof input.settings.activeProfileId === 'string' ? input.settings.activeProfileId : null,
    themeMode: input.settings.themeMode,
    voice: input.settings.voiceConfig,
    memoryEnabled: input.settings.memoryEnabled,
    memoryProfileMode: input.settings.memoryProfileMode,
    memoryProfileId: input.settings.memoryProfileId,
    summaryTriggerMessageCount: input.settings.summaryTriggerMessageCount,
    connectionAuto: input.settings.connectionAuto !== false,
  });
}

export class ConfigService {
  private static readonly STORAGE_KEY = 'herein-config';
  private static readonly FILE_NAME = 'config.json';

  static load(): AppConfig {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return normalizeConfig(JSON.parse(stored) as StoredAppConfig);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return DEFAULT_CONFIG;
  }

  static save(config: AppConfig): void {
    try {
      const sanitized = sanitizeConfig(config);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sanitized));
      void writeJSONFile(this.FILE_NAME, sanitized);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  static async loadPersistent(): Promise<AppConfig> {
    if (hasPhase2Storage()) {
      const config = phase2SettingsToConfig(await createPhase2Client().bootstrap());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sanitizeConfig(config)));
      return config;
    }

    const fileConfig = await readJSONFile<StoredAppConfig>(this.FILE_NAME);

    if (fileConfig) {
      const config = normalizeConfig(fileConfig);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
      return config;
    }

    const legacyConfig = this.load();
    await writeJSONFile(this.FILE_NAME, sanitizeConfig(legacyConfig));
    return legacyConfig;
  }

  static async savePersistent(config: AppConfig): Promise<void> {
    const sanitized = sanitizeConfig(config);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sanitized));

    if (hasPhase2Storage()) {
      const client = createPhase2Client();
      await Promise.all(sanitized.characters.map(character => client.characters.upsert(characterConfigToProfile(character))));
      await Promise.all([
        client.settings.set('activeCharacterId', sanitized.activeCharacterId),
        client.settings.set('activeProfileId', sanitized.activeProfileId ?? null),
        client.settings.set('themeMode', sanitized.themeMode),
        client.settings.set('voiceConfig', sanitized.voice),
        client.settings.set('memoryEnabled', sanitized.memoryEnabled),
        client.settings.set('memoryProfileMode', sanitized.memoryProfileMode),
        client.settings.set('memoryProfileId', sanitized.memoryProfileId ?? null),
        client.settings.set('summaryTriggerMessageCount', sanitized.summaryTriggerMessageCount),
        client.settings.set('connectionAuto', sanitized.connectionAuto !== false),
      ]);
      return;
    }

    await writeJSONFile(this.FILE_NAME, sanitized);
  }

  static updateLLM(llmConfig: Partial<LLMConfig>): void {
    const config = this.load();
    config.llm = { ...config.llm, ...llmConfig, apiKey: '' };
    this.save(config);
  }

  static updateCharacters(characters: CharacterConfig[], activeCharacterId?: string): void {
    const config = this.load();
    config.characters = characters;
    config.activeCharacterId = activeCharacterId || config.activeCharacterId;
    this.save(config);
  }

  static updateActiveProfile(activeProfileId: string | null): void {
    const config = this.load();
    config.activeProfileId = activeProfileId;
    this.save(config);
  }
}
