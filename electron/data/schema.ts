export const CURRENT_SCHEMA_VERSION = 14;

export interface SchemaMigration {
  version: number;
  name: string;
  sql: string;
}

export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    name: 'phase2_initial_schema',
    sql: `
      create table if not exists app_settings (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );

      create table if not exists api_profiles (
        id text primary key,
        name text not null,
        provider text not null,
        base_url text,
        model text not null,
        temperature real,
        max_tokens integer,
        encrypted_api_key text not null default '',
        key_encoding text not null default 'plain:fallback',
        last_connected_at text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists characters (
        id text primary key,
        name text not null,
        nickname text,
        description text not null default '',
        scenario text not null default '',
        first_message text not null default '',
        system_prompt text not null default '',
        personality_core text not null default '',
        speaking_style text not null default '',
        values_text text not null default '',
        boundaries text not null default '',
        avatar_asset_id text,
        asset_dir text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists relationship_profiles (
        character_id text primary key references characters(id) on delete cascade,
        tone text not null default '',
        closeness integer not null default 0,
        shared_habits text not null default '',
        private_language text not null default '',
        important_experiences text not null default '',
        unresolved_context text not null default '',
        updated_at text not null
      );

      create table if not exists timelines (
        id text primary key,
        character_id text not null references characters(id) on delete cascade,
        title text not null,
        kind text not null default 'primary',
        is_primary integer not null default 0,
        source_conversation_id text,
        created_at text not null,
        updated_at text not null,
        archived_at text
      );

      create unique index if not exists idx_timelines_one_primary_per_character
        on timelines(character_id)
        where is_primary = 1;

      create index if not exists idx_timelines_character_updated
        on timelines(character_id, updated_at desc);

      create table if not exists messages (
        id text primary key,
        timeline_id text not null references timelines(id) on delete cascade,
        role text not null,
        content text not null,
        timestamp text not null,
        emotion text,
        reasoning text,
        status text,
        source_conversation_id text,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_messages_timeline_timestamp
        on messages(timeline_id, timestamp, created_at);

      create table if not exists conversation_summaries (
        id text primary key,
        timeline_id text not null unique references timelines(id) on delete cascade,
        content text not null,
        message_count integer not null default 0,
        token_estimate integer not null default 0,
        source_message_ids_json text not null default '[]',
        status text not null default 'active',
        created_at text not null,
        updated_at text not null
      );

      create table if not exists memory_items (
        id text primary key,
        character_id text references characters(id) on delete cascade,
        timeline_id text references timelines(id) on delete cascade,
        scope text not null,
        kind text not null,
        content text not null,
        current_value text,
        previous_value text,
        historical_note text,
        source_message_ids_json text not null default '[]',
        source_time text,
        confidence real,
        origin text not null default 'manual',
        status text not null default 'active',
        pinned integer not null default 0,
        include_in_context integer not null default 1,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_memory_scope_kind_status
        on memory_items(scope, kind, status, pinned desc, updated_at desc);

      create index if not exists idx_memory_character_status
        on memory_items(character_id, status, pinned desc, updated_at desc);

      create table if not exists memory_runs (
        id text primary key,
        timeline_id text references timelines(id) on delete set null,
        profile_id text,
        status text not null,
        error text,
        input_message_ids_json text not null default '[]',
        raw_output text,
        created_at text not null
      );

      create table if not exists assets (
        id text primary key,
        character_id text references characters(id) on delete cascade,
        kind text not null,
        relative_path text not null,
        mime_type text,
        label text,
        created_at text not null
      );

      create table if not exists migration_state (
        key text primary key,
        value_json text not null,
        created_at text not null,
        updated_at text not null
      );
    `,
  },
  {
    version: 2,
    name: 'phase3_asset_metadata',
    sql: `
      alter table assets add column metadata_json text not null default '{}';
    `,
  },
  {
    version: 3,
    name: 'phase3_presentation_profiles',
    sql: `
      create table if not exists character_presentation_profiles (
        character_id text primary key references characters(id) on delete cascade,
        default_asset_id text,
        fallback_emotion text not null default 'neutral',
        emotion_asset_map_json text not null default '{}',
        updated_at text not null
      );
    `,
  },
  {
    version: 4,
    name: 'phase3_dynamic_presentation_assets',
    sql: `
      alter table character_presentation_profiles add column dynamic_asset_id text;
      alter table character_presentation_profiles add column preferred_renderer text not null default 'auto';
    `,
  },
  {
    version: 5,
    name: 'phase3_voice_instruct_messages',
    sql: `
      alter table messages add column voice_instruct text;
    `,
  },
  {
    version: 6,
    name: 'phase0_observations_experiences_sync',
    sql: `
      create table if not exists channel_accounts (
        id text primary key,
        platform text not null,
        external_id text not null,
        display_name text,
        credentials_ref text,
        status text not null default 'active',
        created_at text not null,
        unique(platform, external_id)
      );

      create table if not exists identity_links (
        id text primary key,
        platform text not null,
        external_id text not null,
        canonical_person_id text not null,
        display_name text,
        created_at text not null,
        unique(platform, external_id)
      );

      create table if not exists observations (
        id text primary key,
        platform text not null,
        account_id text references channel_accounts(id) on delete set null,
        conversation_id text not null,
        conversation_kind text not null,
        actor_id text,
        actor_name text,
        is_self integer not null default 0,
        is_bot integer not null default 0,
        kind text not null,
        content text,
        media_json text not null default '[]',
        occurred_at text not null,
        received_at text not null,
        provenance text not null,
        audience text not null,
        trust real not null default 0.5,
        retention text not null default 'normal',
        raw_json text,
        dedupe_key text unique
      );

      create index if not exists idx_observations_conv_time
        on observations(conversation_id, occurred_at);
      create index if not exists idx_observations_platform_time
        on observations(platform, occurred_at desc);

      create table if not exists experiences (
        id text primary key,
        kind text not null,
        source_observation_ids_json text not null default '[]',
        title text not null,
        summary text not null,
        reaction text not null,
        related_memory_ids_json text not null default '[]',
        importance integer not null default 5,
        happened_at text not null,
        shared_at text
      );

      create index if not exists idx_experiences_time
        on experiences(happened_at desc);

      create table if not exists activity_sessions (
        id text primary key,
        kind text not null,
        status text not null,
        started_at text not null,
        ended_at text,
        stats_json text not null default '{}',
        summary text
      );

      create table if not exists sync_ops (
        id text primary key,
        device_id text not null,
        hlc text not null,
        entity text not null,
        entity_id text not null,
        op text not null,
        payload_json text not null,
        created_at text not null
      );

      create index if not exists idx_sync_ops_device_hlc
        on sync_ops(device_id, hlc);

      alter table memory_items add column audience text not null default 'private';
      alter table memory_items add column importance integer not null default 5;
      alter table memory_items add column provenance text not null default 'owner';
      alter table memory_items add column supersedes_id text;
      alter table memory_items add column source_observation_ids_json text not null default '[]';
      alter table memory_items add column last_recalled_at text;
      alter table memory_items add column recall_count integer not null default 0;
    `,
  },
  {
    version: 7,
    name: 'phase0_memory_fts',
    sql: `
      create virtual table if not exists memory_items_fts using fts5(
        content,
        content='memory_items',
        content_rowid='rowid'
      );

      create trigger if not exists memory_items_fts_ai after insert on memory_items begin
        insert into memory_items_fts(rowid, content) values (new.rowid, new.content);
      end;

      create trigger if not exists memory_items_fts_ad after delete on memory_items begin
        insert into memory_items_fts(memory_items_fts, rowid, content) values ('delete', old.rowid, old.content);
      end;

      create trigger if not exists memory_items_fts_au after update on memory_items begin
        insert into memory_items_fts(memory_items_fts, rowid, content) values ('delete', old.rowid, old.content);
        insert into memory_items_fts(rowid, content) values (new.rowid, new.content);
      end;

      insert into memory_items_fts(memory_items_fts) values ('rebuild');
    `,
  },
  {
    version: 8,
    name: 'phase4_recommendation_events',
    sql: `
      create table if not exists recommendation_events (
        id text primary key,
        item_id text not null,
        item_type text not null,
        recommended_at text not null,
        feedback text,
        feedback_at text,
        created_at text not null
      );

      create index if not exists idx_recommendation_events_time
        on recommendation_events(recommended_at desc);
      create index if not exists idx_recommendation_events_item
        on recommendation_events(item_id, recommended_at desc);
    `,
  },
  {
    version: 9,
    name: 'plugin_registry_and_audit',
    sql: `
      create table if not exists plugin_registry (
        plugin_id text primary key,
        manifest_json text not null,
        config_json text not null default '{}',
        enabled integer not null default 0,
        health_json text not null default '{}',
        installed_at text not null,
        updated_at text not null
      );

      create table if not exists plugin_audit (
        id text primary key,
        plugin_id text not null,
        action text not null,
        status text not null,
        detail_json text not null default '{}',
        created_at text not null
      );

      create index if not exists idx_plugin_audit_plugin_time
        on plugin_audit(plugin_id, created_at desc);
      create index if not exists idx_plugin_audit_time
        on plugin_audit(created_at desc);
    `,
  },
  {
    version: 10,
    name: 'timeline_read_state',
    sql: `
      create table if not exists timeline_read_state (
        character_id text primary key references characters(id) on delete cascade,
        last_read_message_id text,
        last_read_at text,
        updated_at text not null
      );
    `,
  },
  {
    version: 11,
    name: 'chat_idempotency',
    sql: `
      create table if not exists chat_idempotency (
        key text primary key,
        response_json text not null,
        created_at text not null
      );
    `,
  },
  {
    version: 12,
    name: 'memory_system_v2',
    sql: `
      alter table memory_items add column subject text not null default 'user';
      alter table memory_items add column predicate text;
      alter table memory_items add column attributes_json text not null default '{}';
      alter table memory_items add column valid_from text;
      alter table memory_items add column valid_to text;
      alter table memory_items add column sensitivity text not null default 'normal';
      alter table memory_items add column manual integer not null default 0;

      update memory_items set subject = 'relationship'
        where kind in ('event', 'relationship') and scope <> 'global';
      update memory_items set subject = 'user'
        where kind in ('profile', 'state', 'preference') or scope = 'global';
      update memory_items set manual = 1 where origin = 'manual';

      create table if not exists memory_events (
        id text primary key,
        character_id text,
        timeline_id text,
        item_id text,
        run_id text,
        type text not null,
        actor text not null,
        subject text,
        payload_json text not null default '{}',
        schema_version integer not null default 1,
        created_at text not null
      );

      create index if not exists idx_memory_events_character_time
        on memory_events(character_id, created_at desc);
      create index if not exists idx_memory_events_item
        on memory_events(item_id, created_at desc);

      create table if not exists narratives (
        id text primary key,
        character_id text not null,
        timeline_id text not null,
        version integer not null,
        content text not null,
        open_loops_json text not null default '[]',
        watermark_message_id text,
        message_count integer not null default 0,
        source_message_ids_json text not null default '[]',
        status text not null default 'active',
        created_at text not null,
        unique(timeline_id, version)
      );

      create index if not exists idx_narratives_timeline_version
        on narratives(timeline_id, version desc);

      create table if not exists recall_logs (
        id text primary key,
        character_id text not null,
        timeline_id text,
        message_id text,
        purpose text not null,
        audience text not null,
        budget integer not null,
        item_ids_json text not null default '[]',
        omitted_json text not null default '[]',
        scores_json text not null default '{}',
        pack_version text,
        policy_version text,
        latency_ms integer,
        created_at text not null
      );

      create index if not exists idx_recall_logs_character_time
        on recall_logs(character_id, created_at desc);

      alter table memory_runs add column character_id text;
      alter table memory_runs add column run_key text;
      alter table memory_runs add column policy_version text;
      alter table memory_runs add column pack_version text;
      alter table memory_runs add column model text;
      alter table memory_runs add column prompt_tokens integer;
      alter table memory_runs add column completion_tokens integer;
      alter table memory_runs add column proposals integer;
      alter table memory_runs add column applied integer;
      alter table memory_runs add column rejected_json text not null default '[]';
      alter table memory_runs add column watermark_start integer;
      alter table memory_runs add column watermark_end integer;
      alter table memory_runs add column duration_ms integer;

      create unique index if not exists idx_memory_runs_key
        on memory_runs(run_key) where run_key is not null;

      alter table experiences add column character_id text;
      alter table experiences add column audience text not null default 'private';
      alter table experiences add column provenance text not null default 'agent';

      create index if not exists idx_experiences_character_time
        on experiences(character_id, happened_at desc);

      create virtual table if not exists experiences_fts using fts5(
        title,
        summary,
        reaction,
        content='experiences',
        content_rowid='rowid'
      );

      create trigger if not exists experiences_fts_ai after insert on experiences begin
        insert into experiences_fts(rowid, title, summary, reaction)
        values (new.rowid, new.title, new.summary, new.reaction);
      end;

      create trigger if not exists experiences_fts_ad after delete on experiences begin
        insert into experiences_fts(experiences_fts, rowid, title, summary, reaction)
        values ('delete', old.rowid, old.title, old.summary, old.reaction);
      end;

      create trigger if not exists experiences_fts_au after update on experiences begin
        insert into experiences_fts(experiences_fts, rowid, title, summary, reaction)
        values ('delete', old.rowid, old.title, old.summary, old.reaction);
        insert into experiences_fts(rowid, title, summary, reaction)
        values (new.rowid, new.title, new.summary, new.reaction);
      end;

      insert into experiences_fts(experiences_fts) values ('rebuild');
    `,
  },
  {
    version: 13,
    name: 'aliveness_p1_state',
    sql: `
      create table if not exists affect_state (
        character_id text primary key,
        mood real not null default 0,
        energy real not null default 0.7,
        busy real not null default 0.2,
        patience real not null default 0.7,
        updated_at text not null
      );

      create table if not exists open_loops (
        id text primary key,
        character_id text not null,
        timeline_id text not null,
        text text not null,
        source_message_id text,
        status text not null default 'open',
        created_at text not null,
        expires_at text,
        closed_at text
      );

      create index if not exists idx_open_loops_character_status
        on open_loops(character_id, status, created_at desc);

      create table if not exists initiative_bids (
        id text primary key,
        character_id text not null,
        timeline_id text not null,
        kind text not null,
        channel text not null,
        score real not null default 0,
        material_id text,
        status text not null default 'pending',
        outcome text,
        created_at text not null,
        expires_at text,
        outcome_at text
      );

      create index if not exists idx_initiative_bids_character_time
        on initiative_bids(character_id, created_at desc);
    `,
  },
  {
    version: 14,
    name: 'chat_sticker',
    sql: `
      alter table messages add column sticker text;
    `,
  },
  {
    version: 15,
    name: 'chat_material',
    sql: `
      alter table messages add column material text;
    `,
  },
];
