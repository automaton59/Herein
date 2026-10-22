import type { APIKeyEncoding, APIProfile, LLMConfig } from './interfaces';
import { decryptSecret, encryptSecret, readJSONFile, writeJSONFile } from './storage';
import { createPhase2Client } from './phase2/client';

const FILE_NAME = 'api-profiles.json';
const LEGACY_STORAGE_KEY = 'herein-api-profiles';

let profileCounter = 0;

export function generateAPIProfileId() {
  return `api_profile_${Date.now()}_${profileCounter++}`;
}

function getDefaultProfileName(config: LLMConfig) {
  if (config.provider === 'custom') {
    try {
      return config.baseURL ? `Custom ${new URL(config.baseURL).hostname}` : 'Custom API';
    } catch {
      return 'Custom API';
    }
  }

  return config.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
}

export function profileToPublicConfig(profile: APIProfile, apiKey = ''): LLMConfig {
  return {
    provider: profile.provider,
    apiKey,
    model: profile.model,
    baseURL: profile.baseURL,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  };
}

export async function profileToLLMConfig(profile: APIProfile): Promise<LLMConfig> {
  const apiKey = await decryptSecret(profile.encryptedApiKey, profile.keyEncoding);
  return profileToPublicConfig(profile, apiKey);
}

export async function makeAPIProfile(config: LLMConfig, name?: string, id = generateAPIProfileId()): Promise<APIProfile> {
  const encrypted = await encryptSecret(config.apiKey || '');

  return {
    id,
    name: name?.trim() || getDefaultProfileName(config),
    provider: config.provider,
    baseURL: config.baseURL,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    encryptedApiKey: encrypted.value,
    keyEncoding: encrypted.encoding as APIKeyEncoding,
  };
}

function normalizeProfile(raw: Partial<APIProfile>, index: number): APIProfile {
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `api_profile_${index + 1}`,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : `API ${index + 1}`,
    provider: raw.provider || 'openai',
    baseURL: raw.baseURL,
    model: raw.model || 'gpt-4o-mini',
    temperature: raw.temperature,
    maxTokens: raw.maxTokens,
    encryptedApiKey: raw.encryptedApiKey || '',
    keyEncoding: raw.keyEncoding || 'plain:fallback',
    lastConnectedAt: raw.lastConnectedAt,
  };
}

function normalizeProfiles(value: unknown): APIProfile[] {
  const rawProfiles = Array.isArray(value) ? value : [];
  const usedIds = new Set<string>();

  return rawProfiles.map((profile, index) => {
    const normalized = normalizeProfile(profile as Partial<APIProfile>, index);
    let id = normalized.id;

    if (usedIds.has(id)) {
      id = `${id}_${index + 1}`;
    }

    usedIds.add(id);
    return { ...normalized, id };
  });
}

function hasPhase2Storage() {
  return Boolean(window.electron?.phase2);
}

export async function loadAPIProfiles(legacyConfig: LLMConfig): Promise<APIProfile[]> {
  if (hasPhase2Storage()) {
    const bootstrap = await createPhase2Client().bootstrap();
    const profiles = normalizeProfiles(bootstrap.profiles);

    if (profiles.length > 0) {
      return profiles;
    }

    const migratedProfile = await makeAPIProfile(legacyConfig, getDefaultProfileName(legacyConfig), 'default-api-profile');
    await saveAPIProfiles([migratedProfile]);
    return [migratedProfile];
  }

  const fileProfiles = await readJSONFile<unknown>(FILE_NAME);
  const profiles = normalizeProfiles(fileProfiles);

  if (profiles.length > 0) {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(profiles));
    return profiles;
  }

  try {
    const localProfiles = normalizeProfiles(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]'));

    if (localProfiles.length > 0) {
      await saveAPIProfiles(localProfiles);
      return localProfiles;
    }
  } catch {
    // Fall through and migrate the old single API config.
  }

  const migratedProfile = await makeAPIProfile(legacyConfig, getDefaultProfileName(legacyConfig), 'default-api-profile');
  await saveAPIProfiles([migratedProfile]);
  return [migratedProfile];
}

export async function saveAPIProfiles(profiles: APIProfile[]): Promise<void> {
  if (hasPhase2Storage()) {
    const client = createPhase2Client();
    const existingProfiles = await client.profiles.list();
    const nextIds = new Set(profiles.map(profile => profile.id));

    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(profiles));

    await Promise.all(profiles.map(profile => client.profiles.upsert(profile)));
    await Promise.all(existingProfiles
      .filter(profile => !nextIds.has(profile.id))
      .map(profile => client.profiles.delete(profile.id)));
    return;
  }

  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(profiles));
  await writeJSONFile(FILE_NAME, profiles);
}

export async function updateProfileKey(profile: APIProfile, apiKey: string): Promise<APIProfile> {
  const encrypted = await encryptSecret(apiKey);

  return {
    ...profile,
    encryptedApiKey: encrypted.value,
    keyEncoding: encrypted.encoding as APIKeyEncoding,
  };
}
