import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { CURRENT_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from './schema';

export { CURRENT_SCHEMA_VERSION };

export type Phase2Database = Database.Database;

function ensureParentDirectory(dbPath: string) {
  const parent = path.dirname(dbPath);
  mkdirSync(parent, { recursive: true });
}

function ensureMigrationTable(db: Phase2Database) {
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
  `);
}

function applyMigrations(db: Phase2Database) {
  ensureMigrationTable(db);

  const appliedRows = db
    .prepare('select version from schema_migrations')
    .all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map(row => row.version));

  const run = db.transaction(() => {
    for (const migration of SCHEMA_MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }

      db.exec(migration.sql);
      db
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    }
  });

  run();
}

export function openPhase2Database(dbPath: string): Phase2Database {
  ensureParentDirectory(dbPath);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);

  return db;
}

export function withTransaction<T>(db: Phase2Database, fn: () => T): T {
  return db.transaction(fn)();
}

export function closePhase2Database(db: Phase2Database) {
  db.close();
}
