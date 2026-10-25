import { randomUUID } from 'node:crypto';
import type { Phase2Database } from './database';

export type Audience = 'private' | 'group' | 'public';
export type Sensitivity = 'normal' | 'sensitive' | 'secret';
export type Provenance = 'owner' | 'agent' | 'untrusted' | 'system';
export type MemorySubject = 'user' | 'self' | 'relationship' | 'world' | string;
export type MemoryKind =
  | 'state'
  | 'trait'
  | 'preference'
  | 'boundary'
  | 'event'
  | 'commitment'
  | 'relationship'
  | 'profile';

export interface MemoryItem {
  id: string;
  characterId: string | null;
  timelineId: string | null;
  subject: string;
  kind: MemoryKind;
  predicate: string | null;
  content: string;
  attributes: Record<string, unknown>;
  validFrom: string | null;
  validTo: string | null;
  audience: Audience;
  sensitivity: Sensitivity;
  importance: number;
  confidence: number | null;
  provenance: Provenance;
  manual: boolean;
  pinned: boolean;
  includeInContext: boolean;
  status: string;
  supersedesId: string | null;
  sourceMessageIds: string[];
  sourceObservationIds: string[];
  origin: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewMemoryItem {
  id?: string;
  characterId?: string | null;
  timelineId?: string | null;
  subject?: string;
  kind: MemoryKind;
  predicate?: string | null;
  content: string;
  attributes?: Record<string, unknown>;
  validFrom?: string | null;
  validTo?: string | null;
  audience?: Audience;
  sensitivity?: Sensitivity;
  importance?: number;
  confidence?: number | null;
  provenance?: Provenance;
  manual?: boolean;
  pinned?: boolean;
  includeInContext?: boolean;
  status?: string;
  supersedesId?: string | null;
  sourceMessageIds?: string[];
  sourceObservationIds?: string[];
  origin?: string;
}

export interface MemoryEventRecord {
  id: string;
  characterId: string | null;
  timelineId: string | null;
  itemId: string | null;
  runId: string | null;
  type: string;
  actor: 'owner' | 'agent' | 'system';
  subject: string | null;
  payload: Record<string, unknown>;
  schemaVersion: number;
  createdAt: string;
}

export interface NarrativeRecord {
  id: string;
  characterId: string;
  timelineId: string;
  version: number;
  content: string;
  openLoops: string[];
  watermarkMessageId: string | null;
  messageCount: number;
  sourceMessageIds: string[];
  status: string;
  createdAt: string;
}

export interface MemoryRunRecord {
  id: string;
  timelineId: string | null;
  characterId: string | null;
  runKey: string | null;
  profileId: string | null;
  status: 'running' | 'updated' | 'skipped' | 'failed';
  error: string | null;
  inputMessageIds: string[];
  rawOutput: string | null;
  policyVersion: string | null;
  packVersion: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  proposals: number;
  applied: number;
  rejected: unknown[];
  watermarkStart: number | null;
  watermarkEnd: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface RecallLogRecord {
  id: string;
  characterId: string;
  timelineId: string | null;
  messageId: string | null;
  purpose: string;
  audience: Audience;
  budget: number;
  itemIds: string[];
  omitted: unknown[];
  scores: Record<string, number>;
  packVersion: string | null;
  policyVersion: string | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface ExperienceItem {
  id: string;
  characterId: string | null;
  kind: string;
  sourceObservationIds: string[];
  title: string;
  summary: string;
  reaction: string;
  relatedMemoryIds: string[];
  importance: number;
  happenedAt: string;
  sharedAt: string | null;
  audience: Audience;
  provenance: Provenance;
}

type MemoryRow = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapMemory(row: MemoryRow): MemoryItem {
  return {
    id: row.id as string,
    characterId: (row.character_id as string | null) ?? null,
    timelineId: (row.timeline_id as string | null) ?? null,
    subject: (row.subject as string) || 'user',
    kind: row.kind as MemoryKind,
    predicate: (row.predicate as string | null) ?? null,
    content: row.content as string,
    attributes: parseJson<Record<string, unknown>>(row.attributes_json, {}),
    validFrom: (row.valid_from as string | null) ?? null,
    validTo: (row.valid_to as string | null) ?? null,
    audience: ((row.audience as Audience) || 'private'),
    sensitivity: ((row.sensitivity as Sensitivity) || 'normal'),
    importance: typeof row.importance === 'number' ? row.importance : 5,
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    provenance: ((row.provenance as Provenance) || 'agent'),
    manual: Boolean(row.manual) || row.origin === 'manual',
    pinned: Boolean(row.pinned),
    includeInContext: row.include_in_context === undefined ? true : Boolean(row.include_in_context),
    status: (row.status as string) || 'active',
    supersedesId: (row.supersedes_id as string | null) ?? null,
    sourceMessageIds: parseJson<string[]>(row.source_message_ids_json, []),
    sourceObservationIds: parseJson<string[]>(row.source_observation_ids_json, []),
    origin: (row.origin as string) || 'agent',
    createdAt: (row.created_at as string) || nowIso(),
    updatedAt: (row.updated_at as string) || nowIso(),
  };
}

function mapExperience(row: MemoryRow): ExperienceItem {
  return {
    id: row.id as string,
    characterId: (row.character_id as string | null) ?? null,
    kind: row.kind as string,
    sourceObservationIds: parseJson<string[]>(row.source_observation_ids_json, []),
    title: row.title as string,
    summary: row.summary as string,
    reaction: row.reaction as string,
    relatedMemoryIds: parseJson<string[]>(row.related_memory_ids_json, []),
    importance: typeof row.importance === 'number' ? row.importance : 5,
    happenedAt: row.happened_at as string,
    sharedAt: (row.shared_at as string | null) ?? null,
    audience: ((row.audience as Audience) || 'private'),
    provenance: ((row.provenance as Provenance) || 'agent'),
  };
}

function scopeForSubject(subject: string) {
  return subject === 'user' || subject === 'world' ? 'global' : 'character';
}

function audienceFilter(audience: Audience) {
  if (audience === 'group') {
    return { audiences: ['group', 'public'] as Audience[], allowSecret: false };
  }

  if (audience === 'public') {
    return { audiences: ['public'] as Audience[], allowSecret: false };
  }

  return { audiences: ['private', 'group', 'public'] as Audience[], allowSecret: true };
}

export class MemoryStore {
  constructor(private readonly db: Phase2Database) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  readonly events = {
    append: (event: Omit<MemoryEventRecord, 'id' | 'createdAt' | 'schemaVersion'> & {
      id?: string;
      createdAt?: string;
    }): MemoryEventRecord => {
      const record: MemoryEventRecord = {
        id: event.id ?? `evt_${randomUUID()}`,
        characterId: event.characterId ?? null,
        timelineId: event.timelineId ?? null,
        itemId: event.itemId ?? null,
        runId: event.runId ?? null,
        type: event.type,
        actor: event.actor,
        subject: event.subject ?? null,
        payload: event.payload ?? {},
        schemaVersion: 1,
        createdAt: event.createdAt ?? nowIso(),
      };

      this.db.prepare(`
        insert into memory_events (
          id, character_id, timeline_id, item_id, run_id, type, actor, subject,
          payload_json, schema_version, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.characterId,
        record.timelineId,
        record.itemId,
        record.runId,
        record.type,
        record.actor,
        record.subject,
        JSON.stringify(record.payload),
        record.schemaVersion,
        record.createdAt,
      );

      return record;
    },

    listRecent: (filter: { characterId?: string; itemId?: string; limit?: number } = {}): MemoryEventRecord[] => {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (filter.characterId) {
        clauses.push('character_id = ?');
        params.push(filter.characterId);
      }

      if (filter.itemId) {
        clauses.push('item_id = ?');
        params.push(filter.itemId);
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const rows = this.db.prepare(`
        select * from memory_events ${where} order by created_at desc limit ?
      `).all(...params, filter.limit ?? 50) as MemoryRow[];

      return rows.map(row => ({
        id: row.id as string,
        characterId: (row.character_id as string | null) ?? null,
        timelineId: (row.timeline_id as string | null) ?? null,
        itemId: (row.item_id as string | null) ?? null,
        runId: (row.run_id as string | null) ?? null,
        type: row.type as string,
        actor: row.actor as MemoryEventRecord['actor'],
        subject: (row.subject as string | null) ?? null,
        payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
        schemaVersion: typeof row.schema_version === 'number' ? row.schema_version : 1,
        createdAt: row.created_at as string,
      }));
    },
  };

  readonly items = {
    create: (item: NewMemoryItem): MemoryItem => {
      const timestamp = nowIso();
      const id = item.id ?? `mem_${randomUUID()}`;
      const subject = item.subject ?? 'user';
      const record: MemoryItem = {
        id,
        characterId: item.characterId ?? null,
        timelineId: item.timelineId ?? null,
        subject,
        kind: item.kind,
        predicate: item.predicate ?? null,
        content: item.content,
        attributes: item.attributes ?? {},
        validFrom: item.validFrom ?? timestamp,
        validTo: item.validTo ?? null,
        audience: item.audience ?? 'private',
        sensitivity: item.sensitivity ?? 'normal',
        importance: item.importance ?? 5,
        confidence: item.confidence ?? null,
        provenance: item.provenance ?? 'agent',
        manual: item.manual ?? false,
        pinned: item.pinned ?? false,
        includeInContext: item.includeInContext ?? true,
        status: item.status ?? 'active',
        supersedesId: item.supersedesId ?? null,
        sourceMessageIds: item.sourceMessageIds ?? [],
        sourceObservationIds: item.sourceObservationIds ?? [],
        origin: item.origin ?? (item.manual ? 'manual' : 'agent'),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.db.prepare(`
        insert into memory_items (
          id, character_id, timeline_id, scope, kind, content, current_value,
          previous_value, historical_note, source_message_ids_json, source_time,
          confidence, origin, status, pinned, include_in_context, audience, importance,
          provenance, supersedes_id, source_observation_ids_json, last_recalled_at,
          recall_count, created_at, updated_at, subject, predicate, attributes_json,
          valid_from, valid_to, sensitivity, manual
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.characterId,
        record.timelineId,
        scopeForSubject(record.subject),
        record.kind,
        record.content,
        null,
        null,
        null,
        JSON.stringify(record.sourceMessageIds),
        null,
        record.confidence,
        record.origin,
        record.status,
        record.pinned ? 1 : 0,
        record.includeInContext ? 1 : 0,
        record.audience,
        record.importance,
        record.provenance,
        record.supersedesId,
        JSON.stringify(record.sourceObservationIds),
        null,
        0,
        record.createdAt,
        record.updatedAt,
        record.subject,
        record.predicate,
        JSON.stringify(record.attributes),
        record.validFrom,
        record.validTo,
        record.sensitivity,
        record.manual ? 1 : 0,
      );

      return record;
    },

    get: (id: string): MemoryItem | null => {
      const row = this.db.prepare('select * from memory_items where id = ?').get(id) as MemoryRow | undefined;
      return row ? mapMemory(row) : null;
    },

    listActive: (filter: {
      characterId?: string;
      subjects?: string[];
      audience?: Audience;
      now?: string;
      limit?: number;
    } = {}): MemoryItem[] => {
      const audience = audienceFilter(filter.audience ?? 'private');
      const now = filter.now ?? nowIso();
      const clauses = [
        "status = 'active'",
        'include_in_context = 1',
        `audience in (${audience.audiences.map(() => '?').join(', ')})`,
      ];
      const params: unknown[] = [...audience.audiences];

      if (!audience.allowSecret) {
        clauses.push("sensitivity = 'normal'");
      }

      clauses.push('(valid_to is null or valid_to > ?)');
      params.push(now);

      if (filter.characterId) {
        clauses.push('(character_id = ? or character_id is null)');
        params.push(filter.characterId);
      }

      if (filter.subjects && filter.subjects.length > 0) {
        clauses.push(`subject in (${filter.subjects.map(() => '?').join(', ')})`);
        params.push(...filter.subjects);
      }

      const rows = this.db.prepare(`
        select * from memory_items
        where ${clauses.join(' and ')}
        order by pinned desc, importance desc, updated_at desc
        limit ?
      `).all(...params, filter.limit ?? 200) as MemoryRow[];

      return rows.map(mapMemory);
    },

    findByPredicate: (input: {
      characterId: string | null;
      subject: string;
      predicate: string;
      now?: string;
    }): MemoryItem | null => {
      const row = this.db.prepare(`
        select * from memory_items
        where status = 'active'
          and subject = ?
          and predicate = ?
          and (character_id = ? or (character_id is null and ? is null))
          and (valid_to is null or valid_to > ?)
        order by updated_at desc
        limit 1
      `).get(
        input.subject,
        input.predicate,
        input.characterId,
        input.characterId,
        input.now ?? nowIso(),
      ) as MemoryRow | undefined;

      return row ? mapMemory(row) : null;
    },

    update: (id: string, patch: Partial<MemoryItem>): MemoryItem | null => {
      const existing = this.items.get(id);

      if (!existing) {
        return null;
      }

      const next: MemoryItem = {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };

      this.db.prepare(`
        update memory_items set
          character_id = ?,
          timeline_id = ?,
          subject = ?,
          kind = ?,
          predicate = ?,
          content = ?,
          attributes_json = ?,
          valid_from = ?,
          valid_to = ?,
          audience = ?,
          sensitivity = ?,
          importance = ?,
          confidence = ?,
          provenance = ?,
          manual = ?,
          pinned = ?,
          include_in_context = ?,
          status = ?,
          supersedes_id = ?,
          source_message_ids_json = ?,
          source_observation_ids_json = ?,
          origin = ?,
          updated_at = ?
        where id = ?
      `).run(
        next.characterId,
        next.timelineId,
        next.subject,
        next.kind,
        next.predicate,
        next.content,
        JSON.stringify(next.attributes),
        next.validFrom,
        next.validTo,
        next.audience,
        next.sensitivity,
        next.importance,
        next.confidence,
        next.provenance,
        next.manual ? 1 : 0,
        next.pinned ? 1 : 0,
        next.includeInContext ? 1 : 0,
        next.status,
        next.supersedesId,
        JSON.stringify(next.sourceMessageIds),
        JSON.stringify(next.sourceObservationIds),
        next.origin,
        next.updatedAt,
        id,
      );

      return next;
    },

    search: (query: string, filter: {
      characterId?: string;
      audience?: Audience;
      limit?: number;
    } = {}): MemoryItem[] => {
      const term = query.trim();

      if (!term) {
        return [];
      }

      const audience = audienceFilter(filter.audience ?? 'private');
      const clauses = [
        "m.status = 'active'",
        'm.include_in_context = 1',
        `m.audience in (${audience.audiences.map(() => '?').join(', ')})`,
      ];
      const params: unknown[] = [...audience.audiences];

      if (!audience.allowSecret) {
        clauses.push("m.sensitivity = 'normal'");
      }

      if (filter.characterId) {
        clauses.push('(m.character_id = ? or m.character_id is null)');
        params.push(filter.characterId);
      }

      const limit = filter.limit ?? 50;

      try {
        const rows = this.db.prepare(`
          select m.* from memory_items m
          join memory_items_fts f on f.rowid = m.rowid
          where memory_items_fts match ?
            and ${clauses.join(' and ')}
          order by m.pinned desc, m.importance desc, m.updated_at desc
          limit ?
        `).all(`"${term.replace(/"/g, '""')}"`, ...params, limit) as MemoryRow[];

        if (rows.length > 0) {
          return rows.map(mapMemory);
        }
      } catch {
        // Fall through to LIKE.
      }

      const rows = this.db.prepare(`
        select m.* from memory_items m
        where ${clauses.join(' and ')}
          and m.content like ?
        order by m.pinned desc, m.importance desc, m.updated_at desc
        limit ?
      `).all(...params, `%${term}%`, limit) as MemoryRow[];

      return rows.map(mapMemory);
    },
  };

  readonly narratives = {
    latest: (timelineId: string): NarrativeRecord | null => {
      const row = this.db.prepare(`
        select * from narratives where timeline_id = ? order by version desc limit 1
      `).get(timelineId) as MemoryRow | undefined;

      if (!row) {
        return null;
      }

      return {
        id: row.id as string,
        characterId: row.character_id as string,
        timelineId: row.timeline_id as string,
        version: row.version as number,
        content: row.content as string,
        openLoops: parseJson<string[]>(row.open_loops_json, []),
        watermarkMessageId: (row.watermark_message_id as string | null) ?? null,
        messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
        sourceMessageIds: parseJson<string[]>(row.source_message_ids_json, []),
        status: (row.status as string) || 'active',
        createdAt: row.created_at as string,
      };
    },

    append: (input: {
      characterId: string;
      timelineId: string;
      content: string;
      openLoops?: string[];
      watermarkMessageId?: string | null;
      messageCount?: number;
      sourceMessageIds?: string[];
    }): NarrativeRecord => {
      const latest = this.narratives.latest(input.timelineId);
      const record: NarrativeRecord = {
        id: `nar_${randomUUID()}`,
        characterId: input.characterId,
        timelineId: input.timelineId,
        version: (latest?.version ?? 0) + 1,
        content: input.content,
        openLoops: input.openLoops ?? [],
        watermarkMessageId: input.watermarkMessageId ?? null,
        messageCount: input.messageCount ?? 0,
        sourceMessageIds: input.sourceMessageIds ?? [],
        status: 'active',
        createdAt: nowIso(),
      };

      this.db.prepare(`
        insert into narratives (
          id, character_id, timeline_id, version, content, open_loops_json,
          watermark_message_id, message_count, source_message_ids_json, status, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.characterId,
        record.timelineId,
        record.version,
        record.content,
        JSON.stringify(record.openLoops),
        record.watermarkMessageId,
        record.messageCount,
        JSON.stringify(record.sourceMessageIds),
        record.status,
        record.createdAt,
      );

      return record;
    },

    versions: (timelineId: string, limit = 10): NarrativeRecord[] => {
      const rows = this.db.prepare(`
        select * from narratives where timeline_id = ? order by version desc limit ?
      `).all(timelineId, limit) as MemoryRow[];

      return rows.map(row => ({
        id: row.id as string,
        characterId: row.character_id as string,
        timelineId: row.timeline_id as string,
        version: row.version as number,
        content: row.content as string,
        openLoops: parseJson<string[]>(row.open_loops_json, []),
        watermarkMessageId: (row.watermark_message_id as string | null) ?? null,
        messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
        sourceMessageIds: parseJson<string[]>(row.source_message_ids_json, []),
        status: (row.status as string) || 'active',
        createdAt: row.created_at as string,
      }));
    },
  };

  readonly runs = {
    start: (input: {
      timelineId: string;
      characterId: string;
      runKey: string;
      profileId?: string | null;
      inputMessageIds?: string[];
      policyVersion?: string | null;
      packVersion?: string | null;
      watermarkStart?: number | null;
      watermarkEnd?: number | null;
    }): string => {
      const id = `run_${randomUUID()}`;
      this.db.prepare('delete from memory_runs where run_key = ?').run(input.runKey);
      this.db.prepare(`
        insert into memory_runs (
          id, timeline_id, character_id, run_key, profile_id, status, error,
          input_message_ids_json, raw_output, created_at, policy_version, pack_version,
          watermark_start, watermark_end, rejected_json
        ) values (?, ?, ?, ?, ?, 'running', null, ?, null, ?, ?, ?, ?, ?, '[]')
      `).run(
        id,
        input.timelineId,
        input.characterId,
        input.runKey,
        input.profileId ?? null,
        JSON.stringify(input.inputMessageIds ?? []),
        nowIso(),
        input.policyVersion ?? null,
        input.packVersion ?? null,
        input.watermarkStart ?? null,
        input.watermarkEnd ?? null,
      );
      return id;
    },

    getByKey: (runKey: string): MemoryRunRecord | null => {
      const row = this.db.prepare('select * from memory_runs where run_key = ?').get(runKey) as MemoryRow | undefined;
      return row ? mapRun(row) : null;
    },

    finish: (id: string, patch: {
      status: 'updated' | 'skipped' | 'failed';
      error?: string | null;
      rawOutput?: string | null;
      model?: string | null;
      promptTokens?: number | null;
      completionTokens?: number | null;
      proposals?: number;
      applied?: number;
      rejected?: unknown[];
      durationMs?: number | null;
    }) => {
      this.db.prepare(`
        update memory_runs set
          status = ?, error = ?, raw_output = ?, model = ?, prompt_tokens = ?,
          completion_tokens = ?, proposals = ?, applied = ?, rejected_json = ?, duration_ms = ?
        where id = ?
      `).run(
        patch.status,
        patch.error ?? null,
        patch.rawOutput ?? null,
        patch.model ?? null,
        patch.promptTokens ?? null,
        patch.completionTokens ?? null,
        patch.proposals ?? 0,
        patch.applied ?? 0,
        JSON.stringify(patch.rejected ?? []),
        patch.durationMs ?? null,
        id,
      );
    },

    listRecent: (limit = 20): MemoryRunRecord[] => {
      const rows = this.db.prepare('select * from memory_runs order by created_at desc limit ?').all(limit) as MemoryRow[];
      return rows.map(mapRun);
    },
  };

  readonly recallLogs = {
    append: (log: Omit<RecallLogRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): RecallLogRecord => {
      const record: RecallLogRecord = {
        ...log,
        id: log.id ?? `recall_${randomUUID()}`,
        createdAt: log.createdAt ?? nowIso(),
      };

      this.db.prepare(`
        insert into recall_logs (
          id, character_id, timeline_id, message_id, purpose, audience, budget,
          item_ids_json, omitted_json, scores_json, pack_version, policy_version,
          latency_ms, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.characterId,
        record.timelineId,
        record.messageId,
        record.purpose,
        record.audience,
        record.budget,
        JSON.stringify(record.itemIds),
        JSON.stringify(record.omitted),
        JSON.stringify(record.scores),
        record.packVersion,
        record.policyVersion,
        record.latencyMs,
        record.createdAt,
      );

      return record;
    },
  };

  readonly experiences = {
    create: (input: {
      id?: string;
      characterId?: string | null;
      kind: string;
      sourceObservationIds?: string[];
      title: string;
      summary: string;
      reaction: string;
      relatedMemoryIds?: string[];
      importance?: number;
      happenedAt: string;
      sharedAt?: string | null;
      audience?: Audience;
      provenance?: Provenance;
    }): ExperienceItem => {
      const record: ExperienceItem = {
        id: input.id ?? `exp_${randomUUID()}`,
        characterId: input.characterId ?? null,
        kind: input.kind,
        sourceObservationIds: input.sourceObservationIds ?? [],
        title: input.title,
        summary: input.summary,
        reaction: input.reaction,
        relatedMemoryIds: input.relatedMemoryIds ?? [],
        importance: input.importance ?? 5,
        happenedAt: input.happenedAt,
        sharedAt: input.sharedAt ?? null,
        audience: input.audience ?? 'private',
        provenance: input.provenance ?? 'agent',
      };

      this.db.prepare(`
        insert into experiences (
          id, kind, source_observation_ids_json, title, summary, reaction,
          related_memory_ids_json, importance, happened_at, shared_at,
          character_id, audience, provenance
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.kind,
        JSON.stringify(record.sourceObservationIds),
        record.title,
        record.summary,
        record.reaction,
        JSON.stringify(record.relatedMemoryIds),
        record.importance,
        record.happenedAt,
        record.sharedAt,
        record.characterId,
        record.audience,
        record.provenance,
      );

      return record;
    },

    listRecent: (filter: { characterId?: string; limit?: number } = {}): ExperienceItem[] => {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (filter.characterId) {
        clauses.push('(character_id = ? or character_id is null)');
        params.push(filter.characterId);
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const rows = this.db.prepare(`
        select * from experiences ${where} order by happened_at desc limit ?
      `).all(...params, filter.limit ?? 20) as MemoryRow[];

      return rows.map(mapExperience);
    },

    search: (query: string, filter: { characterId?: string; limit?: number } = {}): ExperienceItem[] => {
      const term = query.trim();

      if (!term) {
        return [];
      }

      const clauses = ['1 = 1'];
      const params: unknown[] = [];

      if (filter.characterId) {
        clauses.push('(e.character_id = ? or e.character_id is null)');
        params.push(filter.characterId);
      }

      try {
        const rows = this.db.prepare(`
          select e.* from experiences e
          join experiences_fts f on f.rowid = e.rowid
          where experiences_fts match ?
            and ${clauses.join(' and ')}
          order by e.importance desc, e.happened_at desc
          limit ?
        `).all(`"${term.replace(/"/g, '""')}"`, ...params, filter.limit ?? 10) as MemoryRow[];

        if (rows.length > 0) {
          return rows.map(mapExperience);
        }
      } catch {
        // Fall through to LIKE.
      }

      const rows = this.db.prepare(`
        select e.* from experiences e
        where ${clauses.join(' and ')}
          and (e.title like ? or e.summary like ? or e.reaction like ?)
        order by e.importance desc, e.happened_at desc
        limit ?
      `).all(...params, `%${term}%`, `%${term}%`, `%${term}%`, filter.limit ?? 10) as MemoryRow[];

      return rows.map(mapExperience);
    },
  };
}

function mapRun(row: MemoryRow): MemoryRunRecord {
  return {
    id: row.id as string,
    timelineId: (row.timeline_id as string | null) ?? null,
    characterId: (row.character_id as string | null) ?? null,
    runKey: (row.run_key as string | null) ?? null,
    profileId: (row.profile_id as string | null) ?? null,
    status: row.status as MemoryRunRecord['status'],
    error: (row.error as string | null) ?? null,
    inputMessageIds: parseJson<string[]>(row.input_message_ids_json, []),
    rawOutput: (row.raw_output as string | null) ?? null,
    policyVersion: (row.policy_version as string | null) ?? null,
    packVersion: (row.pack_version as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    promptTokens: typeof row.prompt_tokens === 'number' ? row.prompt_tokens : null,
    completionTokens: typeof row.completion_tokens === 'number' ? row.completion_tokens : null,
    proposals: typeof row.proposals === 'number' ? row.proposals : 0,
    applied: typeof row.applied === 'number' ? row.applied : 0,
    rejected: parseJson<unknown[]>(row.rejected_json, []),
    watermarkStart: typeof row.watermark_start === 'number' ? row.watermark_start : null,
    watermarkEnd: typeof row.watermark_end === 'number' ? row.watermark_end : null,
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : null,
    createdAt: row.created_at as string,
  };
}

export function createMemoryStore(db: Phase2Database): MemoryStore {
  return new MemoryStore(db);
}
