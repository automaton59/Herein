import { randomUUID } from 'crypto';
import type { Phase2Database } from './database';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type PresentationEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'shy' | 'excited' | 'worried' | 'playful' | 'serious';
type PresentationRenderer = 'auto' | 'static' | 'video' | 'live2d';

export interface APIProfileRecord {
  id: string;
  name: string;
  provider: string;
  baseURL?: string | null;
  model: string;
  temperature?: number | null;
  maxTokens?: number | null;
  encryptedApiKey: string;
  keyEncoding: string;
  lastConnectedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CharacterRecord {
  id: string;
  name: string;
  nickname?: string | null;
  description?: string;
  scenario?: string;
  firstMessage?: string;
  systemPrompt?: string;
  personalityCore?: string;
  speakingStyle?: string;
  valuesText?: string;
  boundaries?: string;
  avatarAssetId?: string | null;
  assetDir?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RelationshipRecord {
  characterId: string;
  tone: string;
  closeness: number;
  sharedHabits: string;
  privateLanguage: string;
  importantExperiences: string;
  unresolvedContext: string;
  updatedAt?: string;
}

export interface TimelineRecord {
  id: string;
  characterId: string;
  title: string;
  kind: 'primary' | 'archive';
  isPrimary: boolean;
  sourceConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface MessageRecord {
  id: string;
  timelineId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  reasoning?: string | null;
  status?: string | null;
  sourceConversationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TimelineSyncResult {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface ChannelAccountRecord {
  id: string;
  platform: string;
  externalId: string;
  displayName?: string | null;
  credentialsRef?: string | null;
  status?: string;
  createdAt?: string;
}

export interface ObservationRecord {
  id: string;
  platform: string;
  accountId?: string | null;
  conversationId: string;
  conversationKind: 'dm' | 'group' | 'public';
  actorId?: string | null;
  actorName?: string | null;
  isSelf?: boolean;
  isBot?: boolean;
  kind: string;
  content?: string | null;
  media?: unknown[];
  occurredAt: string;
  receivedAt: string;
  provenance: 'owner' | 'agent' | 'untrusted' | 'system';
  audience: 'private' | 'group' | 'public';
  trust?: number;
  retention?: 'ephemeral' | 'normal' | 'long';
  raw?: unknown;
  dedupeKey?: string | null;
}

export interface ExperienceRecord {
  id: string;
  kind: 'watched_video' | 'listened_music' | 'read_group' | 'saw_post';
  sourceObservationIds: string[];
  title: string;
  summary: string;
  reaction: string;
  relatedMemoryIds?: string[];
  importance?: number;
  happenedAt: string;
  sharedAt?: string | null;
}

export interface IdentityLinkRecord {
  id: string;
  platform: string;
  externalId: string;
  canonicalPersonId: string;
  displayName?: string | null;
  createdAt?: string;
}

export interface SyncOpRecord {
  id: string;
  deviceId: string;
  hlc: string;
  entity: string;
  entityId: string;
  op: string;
  payload: unknown;
  createdAt?: string;
}

export interface ActivitySessionRecord {
  id: string;
  kind: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  stats?: Record<string, unknown>;
  summary?: string | null;
}

export interface RecommendationEventRecord {
  id: string;
  itemId: string;
  itemType: 'song' | 'video';
  recommendedAt: string;
  feedback?: 'like' | 'skip' | null;
  feedbackAt?: string | null;
  createdAt?: string;
}

export interface SummaryRecord {
  id: string;
  timelineId: string;
  content: string;
  messageCount: number;
  tokenEstimate?: number;
  sourceMessageIds: string[];
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReadStateRecord {
  characterId: string;
  lastReadMessageId: string | null;
  lastReadAt: string | null;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  characterId?: string | null;
  timelineId?: string | null;
  scope: 'global' | 'character' | 'timeline';
  kind: 'state' | 'event' | 'preference' | 'relationship' | 'profile';
  content: string;
  currentValue?: string | null;
  previousValue?: string | null;
  historicalNote?: string | null;
  sourceMessageIds?: string[];
  sourceTime?: string | null;
  confidence?: number | null;
  origin?: 'manual' | 'auto' | 'summary' | 'imported';
  status?: 'active' | 'disabled';
  pinned?: boolean;
  includeInContext?: boolean;
  audience?: 'private' | 'group' | 'public';
  importance?: number;
  provenance?: 'owner' | 'agent' | 'untrusted' | 'system';
  supersedesId?: string | null;
  sourceObservationIds?: string[];
  lastRecalledAt?: string | null;
  recallCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssetRecord {
  id: string;
  characterId?: string | null;
  kind: 'avatar' | 'expression' | 'live2d' | 'video' | 'other';
  relativePath: string;
  mimeType?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface CharacterPresentationProfileRecord {
  characterId: string;
  defaultAssetId?: string | null;
  dynamicAssetId?: string | null;
  emotionAssetMap: Partial<Record<PresentationEmotion, string>>;
  fallbackEmotion: PresentationEmotion;
  preferredRenderer?: PresentationRenderer;
}

type TimelineRow = {
  id: string;
  character_id: string;
  title: string;
  kind: 'primary' | 'archive';
  is_primary: number;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type MessageRow = {
  id: string;
  timeline_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  emotion: string | null;
  voice_instruct: string | null;
  reasoning: string | null;
  status: string | null;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
};

type SummaryRow = {
  id: string;
  timeline_id: string;
  content: string;
  message_count: number;
  token_estimate: number;
  source_message_ids_json: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type MemoryRow = {
  id: string;
  character_id: string | null;
  timeline_id: string | null;
  scope: 'global' | 'character' | 'timeline';
  kind: 'state' | 'event' | 'preference' | 'relationship' | 'profile';
  content: string;
  current_value: string | null;
  previous_value: string | null;
  historical_note: string | null;
  source_message_ids_json: string;
  source_time: string | null;
  confidence: number | null;
  origin: 'manual' | 'auto' | 'summary' | 'imported';
  status: 'active' | 'disabled';
  pinned: number;
  include_in_context: number;
  audience: 'private' | 'group' | 'public';
  importance: number;
  provenance: 'owner' | 'agent' | 'untrusted' | 'system';
  supersedes_id: string | null;
  source_observation_ids_json: string;
  last_recalled_at: string | null;
  recall_count: number;
  created_at: string;
  updated_at: string;
};

type RelationshipRow = {
  character_id: string;
  tone: string;
  closeness: number;
  shared_habits: string;
  private_language: string;
  important_experiences: string;
  unresolved_context: string;
  updated_at: string;
};

type AssetRow = {
  id: string;
  character_id: string | null;
  kind: AssetRecord['kind'];
  relative_path: string;
  mime_type: string | null;
  label: string | null;
  metadata_json: string;
  created_at: string;
};

type CharacterPresentationProfileRow = {
  character_id: string;
  default_asset_id: string | null;
  dynamic_asset_id: string | null;
  fallback_emotion: PresentationEmotion;
  preferred_renderer: PresentationRenderer;
  emotion_asset_map_json: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function stringifyJson(value: JsonValue | undefined) {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function defaultPresentationProfile(characterId: string): CharacterPresentationProfileRecord {
  return {
    characterId,
    defaultAssetId: null,
    dynamicAssetId: null,
    emotionAssetMap: {},
    fallbackEmotion: 'neutral',
    preferredRenderer: 'auto',
  };
}

function mapTimeline(row: TimelineRow): TimelineRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    kind: row.kind,
    isPrimary: row.is_primary === 1,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    timelineId: row.timeline_id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    emotion: row.emotion,
    voiceInstruct: row.voice_instruct,
    reasoning: row.reasoning,
    status: row.status,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row: SummaryRow): SummaryRecord {
  return {
    id: row.id,
    timelineId: row.timeline_id,
    content: row.content,
    messageCount: row.message_count,
    tokenEstimate: row.token_estimate,
    sourceMessageIds: parseJson<string[]>(row.source_message_ids_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    timelineId: row.timeline_id,
    scope: row.scope,
    kind: row.kind,
    content: row.content,
    currentValue: row.current_value,
    previousValue: row.previous_value,
    historicalNote: row.historical_note,
    sourceMessageIds: parseJson<string[]>(row.source_message_ids_json, []),
    sourceTime: row.source_time,
    confidence: row.confidence,
    origin: row.origin,
    status: row.status,
    pinned: row.pinned === 1,
    includeInContext: row.include_in_context === 1,
    audience: row.audience,
    importance: row.importance,
    provenance: row.provenance,
    supersedesId: row.supersedes_id,
    sourceObservationIds: parseJson<string[]>(row.source_observation_ids_json, []),
    lastRecalledAt: row.last_recalled_at,
    recallCount: row.recall_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationship(row: RelationshipRow): RelationshipRecord {
  return {
    characterId: row.character_id,
    tone: row.tone,
    closeness: row.closeness,
    sharedHabits: row.shared_habits,
    privateLanguage: row.private_language,
    importantExperiences: row.important_experiences,
    unresolvedContext: row.unresolved_context,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    kind: row.kind,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    label: row.label,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function mapPresentationProfile(row: CharacterPresentationProfileRow): CharacterPresentationProfileRecord {
  return {
    characterId: row.character_id,
    defaultAssetId: row.default_asset_id,
    dynamicAssetId: row.dynamic_asset_id,
    fallbackEmotion: row.fallback_emotion,
    preferredRenderer: row.preferred_renderer,
    emotionAssetMap: parseJson<Partial<Record<PresentationEmotion, string>>>(row.emotion_asset_map_json, {}),
  };
}

export function createPhase2Repositories(db: Phase2Database) {
  return {
    settings: {
      get<T = unknown>(key: string, fallback?: T): T | undefined {
        const row = db
          .prepare('select value_json from app_settings where key = ?')
          .get(key) as { value_json: string } | undefined;

        return row ? parseJson<T>(row.value_json, fallback as T) : fallback;
      },

      set(key: string, value: JsonValue) {
        db
          .prepare(`
            insert into app_settings (key, value_json, updated_at)
            values (?, ?, ?)
            on conflict(key) do update set
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
          `)
          .run(key, stringifyJson(value), nowIso());
      },
    },

    apiProfiles: {
      list(): APIProfileRecord[] {
        const rows = db
          .prepare('select * from api_profiles order by updated_at desc, name asc')
          .all() as Array<Record<string, unknown>>;

        return rows.map(row => ({
          id: row.id as string,
          name: row.name as string,
          provider: row.provider as string,
          baseURL: row.base_url as string | null,
          model: row.model as string,
          temperature: row.temperature as number | null,
          maxTokens: row.max_tokens as number | null,
          encryptedApiKey: row.encrypted_api_key as string,
          keyEncoding: row.key_encoding as string,
          lastConnectedAt: row.last_connected_at as string | null,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        }));
      },

      get(id: string): APIProfileRecord | null {
        return this.list().find(profile => profile.id === id) ?? null;
      },

      upsert(profile: APIProfileRecord) {
        const existing = db
          .prepare('select created_at from api_profiles where id = ?')
          .get(profile.id) as { created_at: string } | undefined;
        const timestamp = nowIso();

        db
          .prepare(`
            insert into api_profiles (
              id, name, provider, base_url, model, temperature, max_tokens,
              encrypted_api_key, key_encoding, last_connected_at, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              name = excluded.name,
              provider = excluded.provider,
              base_url = excluded.base_url,
              model = excluded.model,
              temperature = excluded.temperature,
              max_tokens = excluded.max_tokens,
              encrypted_api_key = excluded.encrypted_api_key,
              key_encoding = excluded.key_encoding,
              last_connected_at = excluded.last_connected_at,
              updated_at = excluded.updated_at
          `)
          .run(
            profile.id,
            profile.name,
            profile.provider,
            profile.baseURL ?? null,
            profile.model,
            profile.temperature ?? null,
            profile.maxTokens ?? null,
            profile.encryptedApiKey,
            profile.keyEncoding,
            profile.lastConnectedAt ?? null,
            existing?.created_at ?? timestamp,
            timestamp,
          );
      },

      delete(id: string) {
        db.prepare('delete from api_profiles where id = ?').run(id);
      },
    },

    characters: {
      list(): CharacterRecord[] {
        const rows = db
          .prepare('select * from characters order by updated_at desc, name asc')
          .all() as Array<Record<string, unknown>>;

        return rows.map(row => ({
          id: row.id as string,
          name: row.name as string,
          nickname: row.nickname as string | null,
          description: row.description as string,
          scenario: row.scenario as string,
          firstMessage: row.first_message as string,
          systemPrompt: row.system_prompt as string,
          personalityCore: row.personality_core as string,
          speakingStyle: row.speaking_style as string,
          valuesText: row.values_text as string,
          boundaries: row.boundaries as string,
          avatarAssetId: row.avatar_asset_id as string | null,
          assetDir: row.asset_dir as string | null,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        }));
      },

      get(id: string): CharacterRecord | null {
        return this.list().find(character => character.id === id) ?? null;
      },

      upsert(character: CharacterRecord) {
        const existing = db
          .prepare('select created_at from characters where id = ?')
          .get(character.id) as { created_at: string } | undefined;
        const timestamp = nowIso();

        db
          .prepare(`
            insert into characters (
              id, name, nickname, description, scenario, first_message, system_prompt,
              personality_core, speaking_style, values_text, boundaries,
              avatar_asset_id, asset_dir, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              name = excluded.name,
              nickname = excluded.nickname,
              description = excluded.description,
              scenario = excluded.scenario,
              first_message = excluded.first_message,
              system_prompt = excluded.system_prompt,
              personality_core = excluded.personality_core,
              speaking_style = excluded.speaking_style,
              values_text = excluded.values_text,
              boundaries = excluded.boundaries,
              avatar_asset_id = excluded.avatar_asset_id,
              asset_dir = excluded.asset_dir,
              updated_at = excluded.updated_at
          `)
          .run(
            character.id,
            character.name,
            character.nickname ?? null,
            character.description ?? '',
            character.scenario ?? '',
            character.firstMessage ?? '',
            character.systemPrompt ?? '',
            character.personalityCore ?? '',
            character.speakingStyle ?? '',
            character.valuesText ?? '',
            character.boundaries ?? '',
            character.avatarAssetId ?? null,
            character.assetDir ?? null,
            existing?.created_at ?? timestamp,
            timestamp,
          );
      },
    },

    relationships: {
      get(characterId: string): RelationshipRecord | null {
        const row = db
          .prepare('select * from relationship_profiles where character_id = ?')
          .get(characterId) as RelationshipRow | undefined;

        return row ? mapRelationship(row) : null;
      },

      upsert(relationship: RelationshipRecord) {
        db
          .prepare(`
            insert into relationship_profiles (
              character_id, tone, closeness, shared_habits, private_language,
              important_experiences, unresolved_context, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(character_id) do update set
              tone = excluded.tone,
              closeness = excluded.closeness,
              shared_habits = excluded.shared_habits,
              private_language = excluded.private_language,
              important_experiences = excluded.important_experiences,
              unresolved_context = excluded.unresolved_context,
              updated_at = excluded.updated_at
          `)
          .run(
            relationship.characterId,
            relationship.tone,
            relationship.closeness,
            relationship.sharedHabits,
            relationship.privateLanguage,
            relationship.importantExperiences,
            relationship.unresolvedContext,
            relationship.updatedAt ?? nowIso(),
          );
      },
    },

    timelines: {
      getPrimaryForCharacter(characterId: string): TimelineRecord | null {
        const row = db
          .prepare('select * from timelines where character_id = ? and is_primary = 1')
          .get(characterId) as TimelineRow | undefined;

        return row ? mapTimeline(row) : null;
      },

      ensurePrimaryForCharacter(characterId: string, title: string, sourceConversationId?: string): TimelineRecord {
        const existing = this.getPrimaryForCharacter(characterId);
        if (existing) {
          return existing;
        }

        const timestamp = nowIso();
        const id = randomUUID();
        db
          .prepare(`
            insert into timelines (
              id, character_id, title, kind, is_primary, source_conversation_id,
              created_at, updated_at, archived_at
            )
            values (?, ?, ?, 'primary', 1, ?, ?, ?, null)
          `)
          .run(id, characterId, title, sourceConversationId ?? null, timestamp, timestamp);

        const timeline = this.getPrimaryForCharacter(characterId);
        if (!timeline) {
          throw new Error(`Failed to create primary timeline for character ${characterId}`);
        }

        return timeline;
      },

      createArchiveForCharacter(characterId: string, title: string, sourceConversationId?: string): TimelineRecord {
        const timestamp = nowIso();
        const id = randomUUID();
        db
          .prepare(`
            insert into timelines (
              id, character_id, title, kind, is_primary, source_conversation_id,
              created_at, updated_at, archived_at
            )
            values (?, ?, ?, 'archive', 0, ?, ?, ?, ?)
          `)
          .run(id, characterId, title, sourceConversationId ?? null, timestamp, timestamp, timestamp);

        const row = db.prepare('select * from timelines where id = ?').get(id) as TimelineRow;
        return mapTimeline(row);
      },

      updateTitle(timelineId: string, title: string) {
        db
          .prepare('update timelines set title = ?, updated_at = ? where id = ?')
          .run(title, nowIso(), timelineId);
      },

      listByCharacter(characterId: string): TimelineRecord[] {
        const rows = db
          .prepare(`
            select * from timelines
            where character_id = ?
            order by is_primary asc, updated_at desc, created_at desc
          `)
          .all(characterId) as TimelineRow[];

        return rows.map(mapTimeline);
      },
    },

    messages: {
      append(message: MessageRecord) {
        const timestamp = nowIso();
        db
          .prepare(`
            insert into messages (
              id, timeline_id, role, content, timestamp, emotion, voice_instruct, reasoning, status,
              source_conversation_id, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              timeline_id = excluded.timeline_id,
              role = excluded.role,
              content = excluded.content,
              timestamp = excluded.timestamp,
              emotion = excluded.emotion,
              voice_instruct = excluded.voice_instruct,
              reasoning = excluded.reasoning,
              status = excluded.status,
              source_conversation_id = excluded.source_conversation_id,
              updated_at = excluded.updated_at
          `)
          .run(
            message.id,
            message.timelineId,
            message.role,
            message.content,
            message.timestamp,
            message.emotion ?? null,
            message.voiceInstruct ?? null,
            message.reasoning ?? null,
            message.status ?? null,
            message.sourceConversationId ?? null,
            message.createdAt ?? timestamp,
            message.updatedAt ?? timestamp,
          );
      },

      sync(
        timelineId: string,
        messages: MessageRecord[],
        title?: string,
        options: { prune?: boolean } = {},
      ): TimelineSyncResult {
        const run = db.transaction(() => {
          const existingRows = db
            .prepare(`
              select id, content, emotion, voice_instruct, reasoning, status, timestamp
              from messages
              where timeline_id = ?
            `)
            .all(timelineId) as Array<{
              id: string;
              content: string;
              emotion: string | null;
              voice_instruct: string | null;
              reasoning: string | null;
              status: string | null;
              timestamp: string;
            }>;
          const existing = new Map(existingRows.map(row => [row.id, row]));
          const insert = db.prepare(`
            insert into messages (
              id, timeline_id, role, content, timestamp, emotion, voice_instruct, reasoning, status,
              source_conversation_id, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              timeline_id = excluded.timeline_id,
              role = excluded.role,
              content = excluded.content,
              timestamp = excluded.timestamp,
              emotion = excluded.emotion,
              voice_instruct = excluded.voice_instruct,
              reasoning = excluded.reasoning,
              status = excluded.status,
              source_conversation_id = excluded.source_conversation_id,
              updated_at = excluded.updated_at
          `);
          const update = db.prepare(`
            update messages set
              content = ?,
              emotion = ?,
              voice_instruct = ?,
              reasoning = ?,
              status = ?,
              timestamp = ?,
              updated_at = ?
            where id = ?
          `);
          const timestamp = nowIso();
          let inserted = 0;
          let updated = 0;

          for (const message of messages) {
            const previous = existing.get(message.id);

            if (!previous) {
              insert.run(
                message.id,
                message.timelineId,
                message.role,
                message.content,
                message.timestamp,
                message.emotion ?? null,
                message.voiceInstruct ?? null,
                message.reasoning ?? null,
                message.status ?? null,
                message.sourceConversationId ?? null,
                message.createdAt ?? timestamp,
                message.updatedAt ?? timestamp,
              );
              inserted += 1;
              continue;
            }

            if (
              previous.content !== message.content
              || (previous.emotion ?? null) !== (message.emotion ?? null)
              || (previous.voice_instruct ?? null) !== (message.voiceInstruct ?? null)
              || (previous.reasoning ?? null) !== (message.reasoning ?? null)
              || (previous.status ?? null) !== (message.status ?? null)
              || previous.timestamp !== message.timestamp
            ) {
              update.run(
                message.content,
                message.emotion ?? null,
                message.voiceInstruct ?? null,
                message.reasoning ?? null,
                message.status ?? null,
                message.timestamp,
                timestamp,
                message.id,
              );
              updated += 1;
            }
          }

          if (title !== undefined) {
            db
              .prepare('update timelines set title = ?, updated_at = ? where id = ?')
              .run(title, timestamp, timelineId);
          } else {
            db
              .prepare('update timelines set updated_at = ? where id = ?')
              .run(timestamp, timelineId);
          }

          let deleted = 0;
          if (options.prune !== false) {
            if (messages.length === 0) {
              deleted = db
                .prepare('delete from messages where timeline_id = ?')
                .run(timelineId).changes;
            } else {
              const last = messages[messages.length - 1];
              const target = db
                .prepare('select timestamp, created_at from messages where timeline_id = ? and id = ?')
                .get(timelineId, last.id) as { timestamp: string; created_at: string } | undefined;

              if (target) {
                deleted = db
                  .prepare(`
                    delete from messages
                    where timeline_id = ?
                      and (
                        timestamp > ?
                        or (timestamp = ? and created_at > ?)
                      )
                  `)
                  .run(timelineId, target.timestamp, target.timestamp, target.created_at).changes;
              }
            }
          }

          return { inserted, updated, deleted };
        });

        return run();
      },

      listRecent(timelineId: string, limit: number): MessageRecord[] {
        const rows = db
          .prepare(`
            select * from (
              select * from messages
              where timeline_id = ?
              order by timestamp desc, created_at desc
              limit ?
            )
            order by timestamp asc, created_at asc
          `)
          .all(timelineId, limit) as MessageRow[];

        return rows.map(mapMessage);
      },

      countByTimeline(timelineId: string): number {
        const row = db
          .prepare('select count(*) as count from messages where timeline_id = ?')
          .get(timelineId) as { count: number };

        return row.count;
      },

      update(messageId: string, patch: Partial<MessageRecord>) {
        const existing = db
          .prepare('select * from messages where id = ?')
          .get(messageId) as MessageRow | undefined;

        if (!existing) {
          return;
        }

        db
          .prepare(`
            update messages set
              content = ?,
              emotion = ?,
              voice_instruct = ?,
              reasoning = ?,
              status = ?,
              updated_at = ?
            where id = ?
          `)
          .run(
            patch.content ?? existing.content,
            patch.emotion === undefined ? existing.emotion : patch.emotion,
            patch.voiceInstruct === undefined ? existing.voice_instruct : patch.voiceInstruct,
            patch.reasoning === undefined ? existing.reasoning : patch.reasoning,
            patch.status === undefined ? existing.status : patch.status,
            nowIso(),
            messageId,
          );
      },

      deleteAfter(timelineId: string, messageId: string) {
        const target = db
          .prepare('select timestamp, created_at from messages where timeline_id = ? and id = ?')
          .get(timelineId, messageId) as { timestamp: string; created_at: string } | undefined;

        if (!target) {
          return;
        }

        db
          .prepare(`
            delete from messages
            where timeline_id = ?
              and (
                timestamp > ?
                or (timestamp = ? and created_at > ?)
              )
          `)
          .run(timelineId, target.timestamp, target.timestamp, target.created_at);
      },

      clearTimeline(timelineId: string) {
        db.prepare('delete from messages where timeline_id = ?').run(timelineId);
      },
    },

    summaries: {
      getByTimeline(timelineId: string): SummaryRecord | null {
        const row = db
          .prepare('select * from conversation_summaries where timeline_id = ?')
          .get(timelineId) as SummaryRow | undefined;

        return row ? mapSummary(row) : null;
      },

      upsert(summary: SummaryRecord) {
        const existing = db
          .prepare('select created_at from conversation_summaries where id = ?')
          .get(summary.id) as { created_at: string } | undefined;
        const timestamp = nowIso();

        db
          .prepare(`
            insert into conversation_summaries (
              id, timeline_id, content, message_count, token_estimate,
              source_message_ids_json, status, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              timeline_id = excluded.timeline_id,
              content = excluded.content,
              message_count = excluded.message_count,
              token_estimate = excluded.token_estimate,
              source_message_ids_json = excluded.source_message_ids_json,
              status = excluded.status,
              updated_at = excluded.updated_at
          `)
          .run(
            summary.id,
            summary.timelineId,
            summary.content,
            summary.messageCount,
            summary.tokenEstimate ?? 0,
            JSON.stringify(summary.sourceMessageIds),
            summary.status ?? 'active',
            existing?.created_at ?? timestamp,
            timestamp,
          );
      },
    },

    readState: {
      get(characterId: string): ReadStateRecord | null {
        const row = db
          .prepare('select * from timeline_read_state where character_id = ?')
          .get(characterId) as {
            character_id: string;
            last_read_message_id: string | null;
            last_read_at: string | null;
            updated_at: string;
          } | undefined;

        return row
          ? {
            characterId: row.character_id,
            lastReadMessageId: row.last_read_message_id,
            lastReadAt: row.last_read_at,
            updatedAt: row.updated_at,
          }
          : null;
      },

      upsert(state: ReadStateRecord) {
        const timestamp = nowIso();
        db
          .prepare(`
            insert into timeline_read_state (
              character_id, last_read_message_id, last_read_at, updated_at
            )
            values (?, ?, ?, ?)
            on conflict(character_id) do update set
              last_read_message_id = excluded.last_read_message_id,
              last_read_at = excluded.last_read_at,
              updated_at = excluded.updated_at
          `)
          .run(
            state.characterId,
            state.lastReadMessageId ?? null,
            state.lastReadAt ?? null,
            timestamp,
          );
      },
    },

    memories: {
      create(memory: MemoryRecord) {
        const timestamp = nowIso();
        db
          .prepare(`
            insert into memory_items (
              id, character_id, timeline_id, scope, kind, content, current_value,
              previous_value, historical_note, source_message_ids_json, source_time,
              confidence, origin, status, pinned, include_in_context, audience, importance,
              provenance, supersedes_id, source_observation_ids_json, last_recalled_at,
              recall_count, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            memory.id,
            memory.characterId ?? null,
            memory.timelineId ?? null,
            memory.scope,
            memory.kind,
            memory.content,
            memory.currentValue ?? null,
            memory.previousValue ?? null,
            memory.historicalNote ?? null,
            JSON.stringify(memory.sourceMessageIds ?? []),
            memory.sourceTime ?? null,
            memory.confidence ?? null,
            memory.origin ?? 'manual',
            memory.status ?? 'active',
            memory.pinned ? 1 : 0,
            memory.includeInContext === false ? 0 : 1,
            memory.audience ?? 'private',
            memory.importance ?? 5,
            memory.provenance ?? 'owner',
            memory.supersedesId ?? null,
            JSON.stringify(memory.sourceObservationIds ?? []),
            memory.lastRecalledAt ?? null,
            memory.recallCount ?? 0,
            memory.createdAt ?? timestamp,
            memory.updatedAt ?? timestamp,
          );
      },

      listActive(filter: {
        characterId?: string;
        timelineId?: string;
        audience?: 'private' | 'group' | 'public';
        minImportance?: number;
      } = {}): MemoryRecord[] {
        const clauses = ['status = ?'];
        const params: unknown[] = ['active'];

        if (filter.characterId) {
          clauses.push('character_id = ?');
          params.push(filter.characterId);
        }

        if (filter.timelineId) {
          clauses.push('timeline_id = ?');
          params.push(filter.timelineId);
        }

        if (filter.audience) {
          clauses.push('audience = ?');
          params.push(filter.audience);
        }

        if (filter.minImportance !== undefined) {
          clauses.push('importance >= ?');
          params.push(filter.minImportance);
        }

        const rows = db
          .prepare(`
            select * from memory_items
            where ${clauses.join(' and ')}
              and include_in_context = 1
            order by pinned desc, importance desc, updated_at desc, created_at desc
          `)
          .all(...params) as MemoryRow[];

        return rows.map(mapMemory);
      },

      search(query: string, filter: {
        characterId?: string;
        timelineId?: string;
        audience?: 'private' | 'group' | 'public';
        limit?: number;
      } = {}): MemoryRecord[] {
        const term = query.trim();

        if (!term) {
          return [];
        }

        const clauses = ['m.status = ?', 'm.include_in_context = 1'];
        const params: unknown[] = ['active'];

        if (filter.characterId) {
          clauses.push('m.character_id = ?');
          params.push(filter.characterId);
        }

        if (filter.timelineId) {
          clauses.push('m.timeline_id = ?');
          params.push(filter.timelineId);
        }

        if (filter.audience) {
          clauses.push('m.audience = ?');
          params.push(filter.audience);
        }

        const limit = filter.limit ?? 50;

        if (term.length >= 3) {
          try {
            const rows = db
              .prepare(`
                select m.* from memory_items m
                join memory_items_fts f on f.rowid = m.rowid
                where memory_items_fts match ?
                  and ${clauses.join(' and ')}
                order by m.pinned desc, m.importance desc, m.updated_at desc
                limit ?
              `)
              .all(`"${term.replace(/"/g, '""')}"`, ...params, limit) as MemoryRow[];

            if (rows.length > 0) {
              return rows.map(mapMemory);
            }
          } catch {
            // FTS tokenizer/query failure falls back to LIKE below.
          }
        }

        const rows = db
          .prepare(`
            select m.* from memory_items m
            where ${clauses.join(' and ')}
              and m.content like ?
            order by m.pinned desc, m.importance desc, m.updated_at desc
            limit ?
          `)
          .all(...params, `%${term}%`, limit) as MemoryRow[];

        return rows.map(mapMemory);
      },

      listAll(filter: { characterId?: string; timelineId?: string } = {}): MemoryRecord[] {
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (filter.characterId) {
          clauses.push('character_id = ?');
          params.push(filter.characterId);
        }

        if (filter.timelineId) {
          clauses.push('timeline_id = ?');
          params.push(filter.timelineId);
        }

        const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const rows = db
          .prepare(`
            select * from memory_items
            ${where}
            order by pinned desc, updated_at desc, created_at desc
          `)
          .all(...params) as MemoryRow[];

        return rows.map(mapMemory);
      },

      disable(id: string) {
        db
          .prepare("update memory_items set status = 'disabled', updated_at = ? where id = ?")
          .run(nowIso(), id);
      },

      update(id: string, patch: Partial<MemoryRecord>) {
        const existing = db
          .prepare('select * from memory_items where id = ?')
          .get(id) as MemoryRow | undefined;

        if (!existing) {
          return;
        }

        db
          .prepare(`
            update memory_items set
              scope = ?,
              kind = ?,
              content = ?,
              current_value = ?,
              previous_value = ?,
              historical_note = ?,
              source_message_ids_json = ?,
              source_time = ?,
              confidence = ?,
              origin = ?,
              status = ?,
              pinned = ?,
              include_in_context = ?,
              audience = ?,
              importance = ?,
              provenance = ?,
              supersedes_id = ?,
              source_observation_ids_json = ?,
              last_recalled_at = ?,
              recall_count = ?,
              updated_at = ?
            where id = ?
          `)
          .run(
            patch.scope ?? existing.scope,
            patch.kind ?? existing.kind,
            patch.content ?? existing.content,
            patch.currentValue === undefined ? existing.current_value : patch.currentValue,
            patch.previousValue === undefined ? existing.previous_value : patch.previousValue,
            patch.historicalNote === undefined ? existing.historical_note : patch.historicalNote,
            patch.sourceMessageIds ? JSON.stringify(patch.sourceMessageIds) : existing.source_message_ids_json,
            patch.sourceTime === undefined ? existing.source_time : patch.sourceTime,
            patch.confidence === undefined ? existing.confidence : patch.confidence,
            patch.origin ?? existing.origin,
            patch.status ?? existing.status,
            patch.pinned === undefined ? existing.pinned : patch.pinned ? 1 : 0,
            patch.includeInContext === undefined ? existing.include_in_context : patch.includeInContext ? 1 : 0,
            patch.audience ?? existing.audience,
            patch.importance === undefined ? existing.importance : patch.importance,
            patch.provenance ?? existing.provenance,
            patch.supersedesId === undefined ? existing.supersedes_id : patch.supersedesId,
            patch.sourceObservationIds
              ? JSON.stringify(patch.sourceObservationIds)
              : existing.source_observation_ids_json,
            patch.lastRecalledAt === undefined ? existing.last_recalled_at : patch.lastRecalledAt,
            patch.recallCount === undefined ? existing.recall_count : patch.recallCount,
            nowIso(),
            id,
          );
      },

      delete(id: string) {
        db.prepare('delete from memory_items where id = ?').run(id);
      },
    },

    assets: {
      create(asset: AssetRecord) {
        db
          .prepare(`
            insert into assets (id, character_id, kind, relative_path, mime_type, label, metadata_json, created_at)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              character_id = excluded.character_id,
              kind = excluded.kind,
              relative_path = excluded.relative_path,
              mime_type = excluded.mime_type,
              label = excluded.label,
              metadata_json = excluded.metadata_json
          `)
          .run(
            asset.id,
            asset.characterId ?? null,
            asset.kind,
            asset.relativePath,
            asset.mimeType ?? null,
            asset.label ?? null,
            JSON.stringify(asset.metadata ?? {}),
            asset.createdAt ?? nowIso(),
          );
      },

      get(id: string): AssetRecord | null {
        const row = db
          .prepare('select * from assets where id = ?')
          .get(id) as AssetRow | undefined;

        return row ? mapAsset(row) : null;
      },

      list(filter: { characterId?: string; kind?: AssetRecord['kind'] } = {}): AssetRecord[] {
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (filter.characterId) {
          clauses.push('character_id = ?');
          params.push(filter.characterId);
        }

        if (filter.kind) {
          clauses.push('kind = ?');
          params.push(filter.kind);
        }

        const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const rows = db
          .prepare(`
            select * from assets
            ${where}
            order by created_at asc, id asc
          `)
          .all(...params) as AssetRow[];

        return rows.map(mapAsset);
      },

      update(id: string, patch: Partial<AssetRecord>) {
        const existing = db
          .prepare('select * from assets where id = ?')
          .get(id) as AssetRow | undefined;

        if (!existing) {
          return;
        }

        db
          .prepare(`
            update assets set
              character_id = ?,
              kind = ?,
              relative_path = ?,
              mime_type = ?,
              label = ?,
              metadata_json = ?
            where id = ?
          `)
          .run(
            patch.characterId === undefined ? existing.character_id : patch.characterId,
            patch.kind ?? existing.kind,
            patch.relativePath ?? existing.relative_path,
            patch.mimeType === undefined ? existing.mime_type : patch.mimeType,
            patch.label === undefined ? existing.label : patch.label,
            patch.metadata === undefined ? existing.metadata_json : JSON.stringify(patch.metadata),
            id,
          );
      },

      delete(id: string) {
        db.prepare('delete from assets where id = ?').run(id);
      },
    },

    recommendationEvents: {
      record(event: RecommendationEventRecord) {
        db
          .prepare(`
            insert into recommendation_events (
              id, item_id, item_type, recommended_at, feedback, feedback_at, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            event.id,
            event.itemId,
            event.itemType,
            event.recommendedAt,
            event.feedback ?? null,
            event.feedbackAt ?? null,
            event.createdAt ?? nowIso(),
          );
      },

      lastRecommendedAt(): string | null {
        const row = db
          .prepare('select max(recommended_at) as value from recommendation_events')
          .get() as { value: string | null } | undefined;
        return row?.value ?? null;
      },

      recentItemIds(sinceIso: string): string[] {
        const rows = db
          .prepare(`
            select distinct item_id from recommendation_events
            where recommended_at >= ?
            order by recommended_at desc
          `)
          .all(sinceIso) as Array<{ item_id: string }>;
        return rows.map(row => row.item_id);
      },

      recent(limit = 20): RecommendationEventRecord[] {
        const rows = db
          .prepare('select * from recommendation_events order by recommended_at desc limit ?')
          .all(limit) as Array<{
            id: string;
            item_id: string;
            item_type: 'song' | 'video';
            recommended_at: string;
            feedback: 'like' | 'skip' | null;
            feedback_at: string | null;
            created_at: string;
          }>;

        return rows.map(row => ({
          id: row.id,
          itemId: row.item_id,
          itemType: row.item_type,
          recommendedAt: row.recommended_at,
          feedback: row.feedback,
          feedbackAt: row.feedback_at,
          createdAt: row.created_at,
        }));
      },

      feedback(itemId: string, feedback: 'like' | 'skip'): boolean {
        const timestamp = nowIso();
        const result = db
          .prepare(`
            update recommendation_events set
              feedback = ?,
              feedback_at = ?
            where id = (
              select id from recommendation_events
              where item_id = ?
              order by recommended_at desc
              limit 1
            )
          `)
          .run(feedback, timestamp, itemId);
        return result.changes > 0;
      },
    },

    activitySessions: {
      start(session: ActivitySessionRecord) {
        db
          .prepare(`
            insert into activity_sessions (
              id, kind, status, started_at, ended_at, stats_json, summary
            )
            values (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            session.id,
            session.kind,
            session.status,
            session.startedAt,
            session.endedAt ?? null,
            JSON.stringify(session.stats ?? {}),
            session.summary ?? null,
          );
      },

      finish(id: string, patch: {
        status: string;
        endedAt?: string;
        stats?: Record<string, unknown>;
        summary?: string;
      }) {
        const existing = db
          .prepare('select * from activity_sessions where id = ?')
          .get(id) as {
            status: string;
            ended_at: string | null;
            stats_json: string;
            summary: string | null;
          } | undefined;

        if (!existing) {
          return;
        }

        db
          .prepare(`
            update activity_sessions set
              status = ?,
              ended_at = ?,
              stats_json = ?,
              summary = ?
            where id = ?
          `)
          .run(
            patch.status,
            patch.endedAt ?? existing.ended_at,
            patch.stats ? JSON.stringify(patch.stats) : existing.stats_json,
            patch.summary === undefined ? existing.summary : patch.summary,
            id,
          );
      },

      listRecent(limit = 20): ActivitySessionRecord[] {
        const rows = db
          .prepare('select * from activity_sessions order by started_at desc limit ?')
          .all(limit) as Array<{
            id: string;
            kind: string;
            status: string;
            started_at: string;
            ended_at: string | null;
            stats_json: string;
            summary: string | null;
          }>;

        return rows.map(row => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          stats: JSON.parse(row.stats_json) as Record<string, unknown>,
          summary: row.summary,
        }));
      },
    },

    channelAccounts: {
      upsert(account: ChannelAccountRecord) {
        db
          .prepare(`
            insert into channel_accounts (
              id, platform, external_id, display_name, credentials_ref, status, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?)
            on conflict(platform, external_id) do update set
              display_name = excluded.display_name,
              credentials_ref = excluded.credentials_ref,
              status = excluded.status
          `)
          .run(
            account.id,
            account.platform,
            account.externalId,
            account.displayName ?? null,
            account.credentialsRef ?? null,
            account.status ?? 'active',
            account.createdAt ?? nowIso(),
          );
      },

      list(): ChannelAccountRecord[] {
        const rows = db
          .prepare('select * from channel_accounts order by created_at asc')
          .all() as Array<{
            id: string;
            platform: string;
            external_id: string;
            display_name: string | null;
            credentials_ref: string | null;
            status: string;
            created_at: string;
          }>;

        return rows.map(row => ({
          id: row.id,
          platform: row.platform,
          externalId: row.external_id,
          displayName: row.display_name,
          credentialsRef: row.credentials_ref,
          status: row.status,
          createdAt: row.created_at,
        }));
      },
    },

    identityLinks: {
      upsert(link: IdentityLinkRecord) {
        db
          .prepare(`
            insert into identity_links (
              id, platform, external_id, canonical_person_id, display_name, created_at
            )
            values (?, ?, ?, ?, ?, ?)
            on conflict(platform, external_id) do update set
              canonical_person_id = excluded.canonical_person_id,
              display_name = excluded.display_name
          `)
          .run(
            link.id,
            link.platform,
            link.externalId,
            link.canonicalPersonId,
            link.displayName ?? null,
            link.createdAt ?? nowIso(),
          );
      },

      resolve(platform: string, externalId: string): IdentityLinkRecord | null {
        const row = db
          .prepare('select * from identity_links where platform = ? and external_id = ?')
          .get(platform, externalId) as {
            id: string;
            platform: string;
            external_id: string;
            canonical_person_id: string;
            display_name: string | null;
            created_at: string;
          } | undefined;

        return row ? {
          id: row.id,
          platform: row.platform,
          externalId: row.external_id,
          canonicalPersonId: row.canonical_person_id,
          displayName: row.display_name,
          createdAt: row.created_at,
        } : null;
      },
    },

    observations: {
      insert(observation: ObservationRecord) {
        const result = db
          .prepare(`
            insert or ignore into observations (
              id, platform, account_id, conversation_id, conversation_kind,
              actor_id, actor_name, is_self, is_bot, kind, content, media_json,
              occurred_at, received_at, provenance, audience, trust, retention,
              raw_json, dedupe_key
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            observation.id,
            observation.platform,
            observation.accountId ?? null,
            observation.conversationId,
            observation.conversationKind,
            observation.actorId ?? null,
            observation.actorName ?? null,
            observation.isSelf ? 1 : 0,
            observation.isBot ? 1 : 0,
            observation.kind,
            observation.content ?? null,
            JSON.stringify(observation.media ?? []),
            observation.occurredAt,
            observation.receivedAt,
            observation.provenance,
            observation.audience,
            observation.trust ?? 0.5,
            observation.retention ?? 'normal',
            observation.raw === undefined ? null : JSON.stringify(observation.raw),
            observation.dedupeKey ?? null,
          );

        return result.changes > 0;
      },

      listRecent(filter: { platform?: string; conversationId?: string; limit?: number } = {}): ObservationRecord[] {
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (filter.platform) {
          clauses.push('platform = ?');
          params.push(filter.platform);
        }

        if (filter.conversationId) {
          clauses.push('conversation_id = ?');
          params.push(filter.conversationId);
        }

        const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
        const limit = filter.limit ?? 100;
        const rows = db
          .prepare(`
            select * from observations
            ${where}
            order by occurred_at desc, received_at desc
            limit ?
          `)
          .all(...params, limit) as Array<{
            id: string;
            platform: string;
            account_id: string | null;
            conversation_id: string;
            conversation_kind: 'dm' | 'group' | 'public';
            actor_id: string | null;
            actor_name: string | null;
            is_self: number;
            is_bot: number;
            kind: string;
            content: string | null;
            media_json: string;
            occurred_at: string;
            received_at: string;
            provenance: 'owner' | 'agent' | 'untrusted' | 'system';
            audience: 'private' | 'group' | 'public';
            trust: number;
            retention: 'ephemeral' | 'normal' | 'long';
            raw_json: string | null;
            dedupe_key: string | null;
          }>;

        return rows.map(row => ({
          id: row.id,
          platform: row.platform,
          accountId: row.account_id,
          conversationId: row.conversation_id,
          conversationKind: row.conversation_kind,
          actorId: row.actor_id,
          actorName: row.actor_name,
          isSelf: row.is_self === 1,
          isBot: row.is_bot === 1,
          kind: row.kind,
          content: row.content,
          media: JSON.parse(row.media_json) as unknown[],
          occurredAt: row.occurred_at,
          receivedAt: row.received_at,
          provenance: row.provenance,
          audience: row.audience,
          trust: row.trust,
          retention: row.retention,
          raw: row.raw_json ? JSON.parse(row.raw_json) as unknown : undefined,
          dedupeKey: row.dedupe_key,
        }));
      },
    },

    experiences: {
      create(experience: ExperienceRecord) {
        db
          .prepare(`
            insert into experiences (
              id, kind, source_observation_ids_json, title, summary, reaction,
              related_memory_ids_json, importance, happened_at, shared_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            experience.id,
            experience.kind,
            JSON.stringify(experience.sourceObservationIds),
            experience.title,
            experience.summary,
            experience.reaction,
            JSON.stringify(experience.relatedMemoryIds ?? []),
            experience.importance ?? 5,
            experience.happenedAt,
            experience.sharedAt ?? null,
          );
      },

      listRecent(limit = 20): ExperienceRecord[] {
        const rows = db
          .prepare('select * from experiences order by happened_at desc limit ?')
          .all(limit) as Array<{
            id: string;
            kind: ExperienceRecord['kind'];
            source_observation_ids_json: string;
            title: string;
            summary: string;
            reaction: string;
            related_memory_ids_json: string;
            importance: number;
            happened_at: string;
            shared_at: string | null;
          }>;

        return rows.map(row => ({
          id: row.id,
          kind: row.kind,
          sourceObservationIds: JSON.parse(row.source_observation_ids_json) as string[],
          title: row.title,
          summary: row.summary,
          reaction: row.reaction,
          relatedMemoryIds: JSON.parse(row.related_memory_ids_json) as string[],
          importance: row.importance,
          happenedAt: row.happened_at,
          sharedAt: row.shared_at,
        }));
      },
    },

    syncOps: {
      append(op: SyncOpRecord) {
        db
          .prepare(`
            insert into sync_ops (
              id, device_id, hlc, entity, entity_id, op, payload_json, created_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            op.id,
            op.deviceId,
            op.hlc,
            op.entity,
            op.entityId,
            op.op,
            JSON.stringify(op.payload),
            op.createdAt ?? nowIso(),
          );
      },

      listSince(deviceId: string, sinceCreatedAt: string, limit = 500): SyncOpRecord[] {
        const rows = db
          .prepare(`
            select * from sync_ops
            where device_id != ? and created_at > ?
            order by created_at asc, id asc
            limit ?
          `)
          .all(deviceId, sinceCreatedAt, limit) as Array<{
            id: string;
            device_id: string;
            hlc: string;
            entity: string;
            entity_id: string;
            op: string;
            payload_json: string;
            created_at: string;
          }>;

        return rows.map(row => ({
          id: row.id,
          deviceId: row.device_id,
          hlc: row.hlc,
          entity: row.entity,
          entityId: row.entity_id,
          op: row.op,
          payload: JSON.parse(row.payload_json) as unknown,
          createdAt: row.created_at,
        }));
      },
    },

    presentationProfiles: {
      get(characterId: string): CharacterPresentationProfileRecord {
        const row = db
          .prepare('select * from character_presentation_profiles where character_id = ?')
          .get(characterId) as CharacterPresentationProfileRow | undefined;

        return row ? mapPresentationProfile(row) : defaultPresentationProfile(characterId);
      },

      upsert(profile: CharacterPresentationProfileRecord) {
        db
          .prepare(`
            insert into character_presentation_profiles (
              character_id, default_asset_id, dynamic_asset_id, fallback_emotion,
              preferred_renderer, emotion_asset_map_json, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?)
            on conflict(character_id) do update set
              default_asset_id = excluded.default_asset_id,
              dynamic_asset_id = excluded.dynamic_asset_id,
              fallback_emotion = excluded.fallback_emotion,
              preferred_renderer = excluded.preferred_renderer,
              emotion_asset_map_json = excluded.emotion_asset_map_json,
              updated_at = excluded.updated_at
          `)
          .run(
            profile.characterId,
            profile.defaultAssetId ?? null,
            profile.dynamicAssetId ?? null,
            profile.fallbackEmotion ?? 'neutral',
            profile.preferredRenderer ?? 'auto',
            JSON.stringify(profile.emotionAssetMap ?? {}),
            nowIso(),
          );
      },
    },
  };
}
