import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { openPhase2Database } = require('../dist-electron/data/database.js');
const { createPhase2Repositories } = require('../dist-electron/data/repositories.js');
const { loadPersonaPacks, resolvePersonaRoot } = require('../dist-electron/persona/loader.js');
const { seedPersonaPacks } = require('../dist-electron/persona/seed.js');

const dataDir = path.resolve(
  process.env.HEREIN_DATA_DIR ?? path.join(process.env.APPDATA ?? '', 'herein', 'data'),
);
const dbPath = path.join(dataDir, 'app.db');

if (!existsSync(dbPath)) {
  console.error(`database not found: ${dbPath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(dataDir, 'backups');
mkdirSync(backupDir, { recursive: true });

for (const suffix of ['', '-wal', '-shm']) {
  const source = `${dbPath}${suffix}`;

  if (existsSync(source)) {
    copyFileSync(source, path.join(backupDir, `app-${stamp}.db${suffix}`));
  }
}

console.log(`backup: ${path.join(backupDir, `app-${stamp}.db`)}`);

const db = openPhase2Database(dbPath);
const repos = createPhase2Repositories(db);
const packs = await loadPersonaPacks(resolvePersonaRoot()).catch(error => {
  console.error(`persona packs were not loaded: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

if (packs.size === 0) {
  console.error(`no persona packs under ${resolvePersonaRoot()}`);
  process.exit(1);
}

const removeIds = process.argv.slice(2).filter(value => !value.startsWith('--'));

for (const id of removeIds) {
  const character = repos.characters.get(id);

  if (!character) {
    console.log(`skip: character not found: ${id}`);
    continue;
  }

  db.prepare('delete from experiences where character_id = ?').run(id);
  db.prepare('delete from characters where id = ?').run(id);
  db.prepare('delete from chat_idempotency where key like ?').run(`%${id}%`);
  const assetDir = path.join(dataDir, 'assets', id);

  if (existsSync(assetDir)) {
    rmSync(assetDir, { recursive: true, force: true });
  }

  console.log(`removed: ${id} (${character.name})`);
}

const results = seedPersonaPacks(repos, packs);
const firstPack = [...packs.keys()][0];

if (firstPack) {
  repos.settings.set('activeCharacterId', firstPack);
}

for (const result of results) {
  const character = repos.characters.get(result.characterId);
  const timeline = repos.timelines.getPrimaryForCharacter(result.characterId);
  console.log(
    `${result.created ? 'created' : 'kept'}: ${result.characterId} `
    + `name=${character?.name ?? '?'} timeline=${timeline ? 'yes' : 'no'}`,
  );
}

console.log(`activeCharacterId=${repos.settings.get('activeCharacterId')}`);
console.log(`characters=${repos.characters.list().map(character => character.id).join(',')}`);
db.close();
