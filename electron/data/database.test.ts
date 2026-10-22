/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  closePhase2Database,
  openPhase2Database,
} from './database';
import { SCHEMA_MIGRATIONS } from './schema';

const tempDirs: string[] = [];

function createDbPath() {
  const dir = mkdtempSync(path.join(tmpdir(), 'al-1s-db-'));
  tempDirs.push(dir);
  return path.join(dir, 'app.db');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('openPhase2Database', () => {
  it('creates a fresh database with required pragmas and migrations', () => {
    const db = openPhase2Database(createDbPath());

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');

    const migrations = db
      .prepare('select version from schema_migrations order by version')
      .all() as Array<{ version: number }>;

    expect(migrations.map(row => row.version)).toContain(CURRENT_SCHEMA_VERSION);

    for (const table of [
      'app_settings',
      'api_profiles',
      'characters',
      'timelines',
      'messages',
      'conversation_summaries',
      'memory_items',
      'assets',
      'migration_state',
      'plugin_registry',
      'plugin_audit',
      'timeline_read_state',
    ]) {
      const tableName = db
        .prepare("select name from sqlite_master where type = 'table' and name = ?")
        .get(table) as { name: string } | undefined;

      expect(tableName?.name).toBe(table);
    }

    closePhase2Database(db);
  });

  it('runs migrations idempotently when reopened', () => {
    const dbPath = createDbPath();
    const first = openPhase2Database(dbPath);
    closePhase2Database(first);

    const second = openPhase2Database(dbPath);
    const migrations = second
      .prepare('select version from schema_migrations order by version')
      .all() as Array<{ version: number }>;

    expect(migrations.map(row => row.version)).toEqual(SCHEMA_MIGRATIONS.map(migration => migration.version));
    closePhase2Database(second);
  });
});
