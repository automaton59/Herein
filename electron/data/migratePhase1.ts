import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import type { Phase2Database } from './database';
import { withTransaction } from './database';
import { createPhase2Repositories, type CharacterRecord } from './repositories';

const MIGRATION_KEY = 'phase1-json';
const PHASE1_FILES = ['config.json', 'api-profiles.json', 'chat-history.json'] as const;

interface MigratePhase1Options {
  db: Phase2Database;
  dataDir: string;
}

interface StoredCharacter {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  scenario?: unknown;
  firstMessage?: unknown;
  systemPrompt?: unknown;
}

interface StoredConfig {
  activeCharacterId?: unknown;
  activeProfileId?: unknown;
  themeMode?: unknown;
  characters?: unknown;
  character?: unknown;
}

interface StoredProfile {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  baseURL?: unknown;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  encryptedApiKey?: unknown;
  keyEncoding?: unknown;
  lastConnectedAt?: unknown;
}

interface StoredMessage {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  emotion?: unknown;
  voiceInstruct?: unknown;
  reasoning?: unknown;
  status?: unknown;
}

interface StoredConversation {
  id?: unknown;
  title?: unknown;
  characterId?: unknown;
  messages?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface StoredChatHistory {
  conversations?: unknown;
  activeConversationId?: unknown;
}

export interface MigrationResult {
  status: 'migrated' | 'already-migrated' | 'no-data';
  backupDir?: string;
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeIso(value: unknown, fallback = new Date().toISOString()) {
  const date = value ? new Date(String(value)) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeCharacter(raw: StoredCharacter, index: number): CharacterRecord {
  const id = normalizeString(raw.id, index === 0 ? 'al-1s-default' : `character_${index + 1}`);
  const name = normalizeString(raw.name, index === 0 ? 'AL-1S' : `角色 ${index + 1}`);

  return {
    id,
    name,
    description: normalizeString(raw.description),
    scenario: normalizeString(raw.scenario),
    firstMessage: normalizeString(raw.firstMessage),
    systemPrompt: normalizeString(raw.systemPrompt),
  };
}

function normalizeCharacters(config: StoredConfig | null): CharacterRecord[] {
  const rawCharacters = Array.isArray(config?.characters)
    ? config.characters as StoredCharacter[]
    : config?.character && typeof config.character === 'object'
      ? [config.character as StoredCharacter]
      : [];

  if (rawCharacters.length === 0) {
    return [normalizeCharacter({ id: 'al-1s-default', name: 'AL-1S' }, 0)];
  }

  const used = new Set<string>();
  return rawCharacters.map((character, index) => {
    const normalized = normalizeCharacter(character, index);
    let id = normalized.id;

    if (used.has(id)) {
      id = `${id}_${index + 1}`;
    }

    used.add(id);
    return { ...normalized, id };
  });
}

function normalizeProfiles(value: unknown): StoredProfile[] {
  return Array.isArray(value) ? value as StoredProfile[] : [];
}

function normalizeConversations(value: unknown): StoredConversation[] {
  return Array.isArray(value) ? value as StoredConversation[] : [];
}

function createBackup(dataDir: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, 'phase1-json-backup', stamp);
  mkdirSync(backupDir, { recursive: true });

  for (const fileName of PHASE1_FILES) {
    const source = path.join(dataDir, fileName);
    if (existsSync(source)) {
      copyFileSync(source, path.join(backupDir, fileName));
    }
  }

  return backupDir;
}

function getMigrationState(db: Phase2Database): MigrationResult | null {
  const row = db
    .prepare('select value_json from migration_state where key = ?')
    .get(MIGRATION_KEY) as { value_json: string } | undefined;

  return row ? JSON.parse(row.value_json) as MigrationResult : null;
}

function setMigrationState(db: Phase2Database, result: MigrationResult) {
  const timestamp = new Date().toISOString();
  db
    .prepare(`
      insert into migration_state (key, value_json, created_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(key) do update set
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    .run(MIGRATION_KEY, JSON.stringify(result), timestamp, timestamp);
}

function choosePrimaryConversation(conversations: StoredConversation[], activeConversationId: string | null) {
  const active = activeConversationId
    ? conversations.find(conversation => normalizeString(conversation.id) === activeConversationId)
    : undefined;

  if (active) {
    return active;
  }

  return [...conversations].sort((a, b) => {
    const aTime = new Date(normalizeIso(a.updatedAt, normalizeIso(a.createdAt))).getTime();
    const bTime = new Date(normalizeIso(b.updatedAt, normalizeIso(b.createdAt))).getTime();
    return bTime - aTime;
  })[0] ?? null;
}

function migrateMessages(
  repos: ReturnType<typeof createPhase2Repositories>,
  timelineId: string,
  conversation: StoredConversation,
) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages as StoredMessage[] : [];
  const conversationId = normalizeString(conversation.id);

  for (const [index, message] of messages.entries()) {
    const role = message.role === 'assistant' || message.role === 'system' ? message.role : 'user';
    repos.messages.append({
      id: normalizeString(message.id, `${conversationId || 'conversation'}_message_${index + 1}`),
      timelineId,
      role,
      content: normalizeString(message.content),
      timestamp: normalizeIso(message.timestamp),
      emotion: typeof message.emotion === 'string' ? message.emotion : null,
      voiceInstruct: typeof message.voiceInstruct === 'string' ? message.voiceInstruct : null,
      reasoning: typeof message.reasoning === 'string' ? message.reasoning : null,
      status: typeof message.status === 'string' ? message.status : null,
      sourceConversationId: conversationId || null,
    });
  }
}

export function migratePhase1JsonData({ db, dataDir }: MigratePhase1Options): MigrationResult {
  const existing = getMigrationState(db);
  if (existing?.status === 'migrated') {
    return { ...existing, status: 'already-migrated' };
  }

  const config = readJsonFile<StoredConfig>(path.join(dataDir, 'config.json'));
  const rawProfiles = readJsonFile<unknown>(path.join(dataDir, 'api-profiles.json'));
  const chatHistory = readJsonFile<StoredChatHistory>(path.join(dataDir, 'chat-history.json'));

  if (!config && !rawProfiles && !chatHistory) {
    const result: MigrationResult = { status: 'no-data' };
    setMigrationState(db, result);
    return result;
  }

  const backupDir = createBackup(dataDir);
  const result: MigrationResult = { status: 'migrated', backupDir };
  const repos = createPhase2Repositories(db);

  withTransaction(db, () => {
    const characters = normalizeCharacters(config);
    for (const character of characters) {
      repos.characters.upsert(character);
    }

    const characterIds = new Set(characters.map(character => character.id));
    const activeCharacterId = normalizeString(config?.activeCharacterId, characters[0]?.id ?? 'al-1s-default');
    repos.settings.set('activeCharacterId', characterIds.has(activeCharacterId) ? activeCharacterId : characters[0].id);
    repos.settings.set('activeProfileId', normalizeString(config?.activeProfileId, '') || null);
    repos.settings.set('themeMode', normalizeString(config?.themeMode, 'system'));

    normalizeProfiles(rawProfiles).forEach((profile, index) => {
      repos.apiProfiles.upsert({
        id: normalizeString(profile.id, `api_profile_${index + 1}`),
        name: normalizeString(profile.name, `API ${index + 1}`),
        provider: normalizeString(profile.provider, 'openai'),
        baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : null,
        model: normalizeString(profile.model, 'gpt-4o-mini'),
        temperature: typeof profile.temperature === 'number' ? profile.temperature : null,
        maxTokens: typeof profile.maxTokens === 'number' ? profile.maxTokens : null,
        encryptedApiKey: normalizeString(profile.encryptedApiKey),
        keyEncoding: normalizeString(profile.keyEncoding, 'plain:fallback'),
        lastConnectedAt: typeof profile.lastConnectedAt === 'string' ? profile.lastConnectedAt : null,
      });
    });

    const activeConversationId = normalizeString(chatHistory?.activeConversationId, '') || null;
    const conversations = normalizeConversations(chatHistory?.conversations);
    const conversationsByCharacter = new Map<string, StoredConversation[]>();

    for (const conversation of conversations) {
      const characterId = normalizeString(conversation.characterId, characters[0]?.id ?? 'al-1s-default');
      if (!conversationsByCharacter.has(characterId)) {
        conversationsByCharacter.set(characterId, []);
      }
      conversationsByCharacter.get(characterId)!.push(conversation);
    }

    for (const character of characters) {
      const characterConversations = conversationsByCharacter.get(character.id) ?? [];
      const primaryConversation = choosePrimaryConversation(characterConversations, activeConversationId);

      if (!primaryConversation) {
        repos.timelines.ensurePrimaryForCharacter(character.id, character.name);
        continue;
      }

      const primary = repos.timelines.ensurePrimaryForCharacter(
        character.id,
        normalizeString(primaryConversation.title, character.name),
        normalizeString(primaryConversation.id) || undefined,
      );
      migrateMessages(repos, primary.id, primaryConversation);

      for (const conversation of characterConversations) {
        if (normalizeString(conversation.id) === normalizeString(primaryConversation.id)) {
          continue;
        }

        const archive = repos.timelines.createArchiveForCharacter(
          character.id,
          normalizeString(conversation.title, '历史聊天'),
          normalizeString(conversation.id) || undefined,
        );
        migrateMessages(repos, archive.id, conversation);
      }
    }

    setMigrationState(db, result);
  });

  return result;
}
