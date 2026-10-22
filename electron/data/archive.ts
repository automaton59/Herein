import AdmZip from 'adm-zip';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { CURRENT_SCHEMA_VERSION } from './database';
import type { Phase2Database } from './database';
import { openPhase2Database, closePhase2Database } from './database';
import { createPhase2Repositories } from './repositories';

type CharacterArchiveMode = 'profile' | 'full';

interface ExportCharacterArchiveInput {
  db: Phase2Database;
  dataDir: string;
  characterId: string;
  mode: CharacterArchiveMode;
  targetPath?: string;
}

interface ImportCharacterArchiveInput {
  db: Phase2Database;
  dataDir: string;
  archivePath: string;
}

interface ExportFullBackupInput {
  db: Phase2Database;
  dataDir: string;
  targetPath?: string;
  includeSecrets?: boolean;
}

interface RestoreFullBackupInput {
  dataDir: string;
  backupPath: string;
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureParent(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultCharacterArchivePath(dataDir: string, characterId: string, mode: CharacterArchiveMode) {
  return path.join(dataDir, 'exports', `herein-character-${characterId}-${mode}-${safeTimestamp()}.zip`);
}

function defaultBackupPath(dataDir: string) {
  return path.join(dataDir, 'backups', `herein-backup-${safeTimestamp()}.zip`);
}

function addDirectoryToZip(zip: AdmZip, directoryPath: string, zipRoot: string) {
  if (!existsSync(directoryPath)) {
    return;
  }

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const sourcePath = path.join(directoryPath, entry.name);
    const zipPath = path.posix.join(zipRoot, entry.name);

    if (entry.isDirectory()) {
      addDirectoryToZip(zip, sourcePath, zipPath);
    } else if (entry.isFile()) {
      zip.addLocalFile(sourcePath, path.posix.dirname(zipPath), path.posix.basename(zipPath));
    }
  }
}

function getRelationship(db: Phase2Database, characterId: string) {
  const row = db.prepare('select * from relationship_profiles where character_id = ?').get(characterId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

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

function buildCharacterPayload(db: Phase2Database, characterId: string, mode: CharacterArchiveMode) {
  const repos = createPhase2Repositories(db);
  const character = repos.characters.get(characterId);

  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const payload: Record<string, unknown> = {
    character,
    assets: repos.assets.list({ characterId }),
    presentationProfile: repos.presentationProfiles.get(characterId),
  };

  if (mode === 'full') {
    const timeline = repos.timelines.getPrimaryForCharacter(characterId);
    payload.relationship = getRelationship(db, characterId);
    payload.memories = repos.memories.listAll({ characterId });

    if (timeline) {
      payload.summary = repos.summaries.getByTimeline(timeline.id);
      payload.timeline = {
        ...timeline,
        messages: repos.messages.listRecent(timeline.id, 100000),
      };
    }
  }

  return payload;
}

function getArchivedAssetRelativePath(assetRelativePath: string, characterId: string) {
  const normalized = assetRelativePath.replace(/\\/g, '/');
  const prefix = path.posix.join('assets', characterId) + '/';
  const relative = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : path.posix.basename(normalized);
  const safeRelative = path.posix.normalize(relative);

  if (!safeRelative || safeRelative === '.' || safeRelative.startsWith('../') || path.posix.isAbsolute(safeRelative)) {
    throw new Error(`Invalid asset path in character archive: ${assetRelativePath}`);
  }

  return safeRelative;
}

function getSafeArchiveEntryRelativePath(entryName: string) {
  const relative = entryName.replace(/\\/g, '/').replace(/^assets\//, '');
  const safeRelative = path.posix.normalize(relative);

  if (!safeRelative || safeRelative === '.' || safeRelative.startsWith('../') || path.posix.isAbsolute(safeRelative)) {
    throw new Error(`Invalid asset entry in character archive: ${entryName}`);
  }

  return safeRelative;
}

function extractArchivedAssetFiles(zip: AdmZip, dataDir: string, importedId: string) {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('assets/')) {
      continue;
    }

    const safeRelative = getSafeArchiveEntryRelativePath(entry.entryName);
    const targetPath = path.join(dataDir, 'assets', importedId, safeRelative);
    ensureParent(targetPath);
    writeFileSync(targetPath, entry.getData());
  }
}

export async function exportCharacterArchive(input: ExportCharacterArchiveInput) {
  const targetPath = input.targetPath ?? defaultCharacterArchivePath(input.dataDir, input.characterId, input.mode);
  const zip = new AdmZip();
  const payload = buildCharacterPayload(input.db, input.characterId, input.mode);

  ensureParent(targetPath);
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'herein-character-archive',
    version: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    mode: input.mode,
    characterId: input.characterId,
    exportedAt: new Date().toISOString(),
  }, null, 2)));
  zip.addFile('character.json', Buffer.from(JSON.stringify(payload, null, 2)));

  const characterAssetsDir = path.join(input.dataDir, 'assets', input.characterId);
  addDirectoryToZip(zip, characterAssetsDir, 'assets');
  zip.writeZip(targetPath);

  return targetPath;
}

export async function importCharacterArchive(input: ImportCharacterArchiveInput) {
  const zip = new AdmZip(input.archivePath);
  const manifest = JSON.parse(zip.readAsText('manifest.json') || '{}') as Record<string, unknown>;

  if (manifest.format !== 'herein-character-archive') {
    throw new Error('Invalid Herein character archive manifest');
  }

  const payload = JSON.parse(zip.readAsText('character.json') || '{}') as Record<string, unknown>;
  const character = payload.character as Record<string, unknown> | undefined;

  if (!character || typeof character.id !== 'string') {
    throw new Error('Character archive is missing character data');
  }

  const repos = createPhase2Repositories(input.db);
  const originalId = character.id;
  const importedId = repos.characters.get(originalId)
    ? `${originalId}_imported_${Date.now()}`
    : originalId;

  repos.characters.upsert({
    ...(character as Record<string, unknown>),
    id: importedId,
  } as Parameters<typeof repos.characters.upsert>[0]);
  const archivedTimeline = payload.timeline as Record<string, unknown> | undefined;
  const timeline = repos.timelines.ensurePrimaryForCharacter(
    importedId,
    String(archivedTimeline?.title || character.name || 'Imported Character'),
  );
  const idSuffix = importedId === originalId ? '' : `_${importedId}`;
  const mapId = (value: unknown) => typeof value === 'string' ? `${value}${idSuffix}` : `${Date.now()}_${Math.random()}`;
  const messageIdMap = new Map<string, string>();
  const assetIdMap = new Map<string, string>();

  extractArchivedAssetFiles(zip, input.dataDir, importedId);

  const archivedAssets = Array.isArray(payload.assets) ? payload.assets : [];
  for (const item of archivedAssets) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const asset = item as Record<string, unknown>;
    if (typeof asset.id !== 'string' || typeof asset.relativePath !== 'string') {
      continue;
    }

    const nextAssetId = repos.assets.get(asset.id) ? mapId(asset.id) : asset.id;
    const archivedRelativePath = getArchivedAssetRelativePath(asset.relativePath, originalId);
    const zipEntryName = path.posix.join('assets', archivedRelativePath);
    const nextRelativePath = path.posix.join('assets', importedId, archivedRelativePath);
    const zipEntry = zip.getEntry(zipEntryName);

    if (zipEntry && !zipEntry.isDirectory) {
      const targetPath = path.join(input.dataDir, nextRelativePath);
      ensureParent(targetPath);
      writeFileSync(targetPath, zipEntry.getData());
    }

    assetIdMap.set(asset.id, nextAssetId);
    repos.assets.create({
      ...(asset as Record<string, unknown>),
      id: nextAssetId,
      characterId: importedId,
      relativePath: nextRelativePath,
    } as Parameters<typeof repos.assets.create>[0]);
  }

  const originalAvatarAssetId = typeof character.avatarAssetId === 'string' ? character.avatarAssetId : null;
  if (originalAvatarAssetId && assetIdMap.has(originalAvatarAssetId)) {
    const importedCharacter = repos.characters.get(importedId);
    if (importedCharacter) {
      repos.characters.upsert({
        ...importedCharacter,
        avatarAssetId: assetIdMap.get(originalAvatarAssetId) ?? importedCharacter.avatarAssetId,
      });
    }
  }

  const presentationProfile = payload.presentationProfile as Record<string, unknown> | undefined;
  if (presentationProfile) {
    const originalMap = presentationProfile.emotionAssetMap && typeof presentationProfile.emotionAssetMap === 'object'
      ? presentationProfile.emotionAssetMap as Record<string, unknown>
      : {};
    const remappedEmotionMap = Object.fromEntries(
      Object.entries(originalMap)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([emotion, assetId]) => [emotion, assetIdMap.get(assetId) ?? assetId]),
    );
    const originalDefaultAssetId = typeof presentationProfile.defaultAssetId === 'string'
      ? presentationProfile.defaultAssetId
      : null;
    const originalDynamicAssetId = typeof presentationProfile.dynamicAssetId === 'string'
      ? presentationProfile.dynamicAssetId
      : null;
    const preferredRenderer = typeof presentationProfile.preferredRenderer === 'string'
      && ['auto', 'static', 'video', 'live2d'].includes(presentationProfile.preferredRenderer)
      ? presentationProfile.preferredRenderer
      : 'auto';

    repos.presentationProfiles.upsert({
      characterId: importedId,
      defaultAssetId: originalDefaultAssetId ? assetIdMap.get(originalDefaultAssetId) ?? originalDefaultAssetId : null,
      dynamicAssetId: originalDynamicAssetId ? assetIdMap.get(originalDynamicAssetId) ?? originalDynamicAssetId : null,
      fallbackEmotion: typeof presentationProfile.fallbackEmotion === 'string'
        ? presentationProfile.fallbackEmotion
        : 'neutral',
      preferredRenderer,
      emotionAssetMap: remappedEmotionMap,
    } as Parameters<typeof repos.presentationProfiles.upsert>[0]);
  }

  const relationship = payload.relationship as Record<string, unknown> | null | undefined;
  if (relationship) {
    input.db.prepare(`
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
    `).run(
      importedId,
      relationship.tone ?? '',
      relationship.closeness ?? 0,
      relationship.sharedHabits ?? '',
      relationship.privateLanguage ?? '',
      relationship.importantExperiences ?? '',
      relationship.unresolvedContext ?? '',
      relationship.updatedAt ?? new Date().toISOString(),
    );
  }

  const archivedMessages = Array.isArray(archivedTimeline?.messages) ? archivedTimeline.messages : [];
  for (const item of archivedMessages) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const message = item as Record<string, unknown>;
    const nextMessageId = mapId(message.id);
    if (typeof message.id === 'string') {
      messageIdMap.set(message.id, nextMessageId);
    }

    repos.messages.append({
      ...(message as Record<string, unknown>),
      id: nextMessageId,
      timelineId: timeline.id,
    } as Parameters<typeof repos.messages.append>[0]);
  }

  const archivedSummary = payload.summary as Record<string, unknown> | null | undefined;
  if (archivedSummary?.content) {
    repos.summaries.upsert({
      ...(archivedSummary as Record<string, unknown>),
      id: mapId(archivedSummary.id),
      timelineId: timeline.id,
      sourceMessageIds: Array.isArray(archivedSummary.sourceMessageIds)
        ? archivedSummary.sourceMessageIds.map(id => messageIdMap.get(String(id)) ?? String(id))
        : [],
    } as Parameters<typeof repos.summaries.upsert>[0]);
  }

  const memories = Array.isArray(payload.memories) ? payload.memories : [];
  for (const item of memories) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const memory = item as Record<string, unknown>;
    repos.memories.create({
      ...(memory as Record<string, unknown>),
      id: mapId(memory.id),
      characterId: memory.scope === 'global' ? null : importedId,
      timelineId: memory.timelineId ? timeline.id : null,
      sourceMessageIds: Array.isArray(memory.sourceMessageIds)
        ? memory.sourceMessageIds.map(id => messageIdMap.get(String(id)) ?? String(id))
        : [],
    } as Parameters<typeof repos.memories.create>[0]);
  }

  return importedId;
}

function sanitizeBackupDatabase(dbPath: string) {
  const db = openPhase2Database(dbPath);
  db.prepare("update api_profiles set encrypted_api_key = '', key_encoding = 'plain:fallback'").run();
  closePhase2Database(db);
}

export async function exportFullBackup(input: ExportFullBackupInput) {
  const targetPath = input.targetPath ?? defaultBackupPath(input.dataDir);
  const includeSecrets = input.includeSecrets === true;
  const tempDir = path.join(input.dataDir, '.tmp-backup', safeTimestamp());
  const tempDbPath = path.join(tempDir, 'app.db');
  const zip = new AdmZip();

  ensureParent(targetPath);
  mkdirSync(tempDir, { recursive: true });

  try {
    await input.db.backup(tempDbPath);

    if (!includeSecrets) {
      sanitizeBackupDatabase(tempDbPath);
    }

    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      format: 'herein-backup',
      version: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      includesSecrets: includeSecrets,
    }, null, 2)));
    zip.addLocalFile(tempDbPath, '', 'app.db');
    addDirectoryToZip(zip, path.join(input.dataDir, 'assets'), 'assets');
    zip.writeZip(targetPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return targetPath;
}

function validateBackup(zip: AdmZip) {
  const manifestText = zip.readAsText('manifest.json');
  const manifest = manifestText ? JSON.parse(manifestText) as Record<string, unknown> : null;

  if (!manifest || manifest.format !== 'herein-backup') {
    throw new Error('Invalid Herein backup manifest');
  }

  if (!zip.getEntry('app.db')) {
    throw new Error('Backup is missing app.db');
  }
}

function extractAssets(zip: AdmZip, dataDir: string) {
  const assetsDir = path.join(dataDir, 'assets');
  rmSync(assetsDir, { recursive: true, force: true });

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('assets/')) {
      continue;
    }

    const relative = entry.entryName.slice('assets/'.length);
    const targetPath = path.join(assetsDir, relative);
    ensureParent(targetPath);
    writeFileSync(targetPath, entry.getData());
  }
}

export async function restoreFullBackup(input: RestoreFullBackupInput) {
  const zip = new AdmZip(input.backupPath);
  validateBackup(zip);

  const snapshotDir = path.join(input.dataDir, 'restore-snapshots', safeTimestamp());
  const dbPath = path.join(input.dataDir, 'app.db');
  const snapshotDbPath = path.join(snapshotDir, 'app.db');
  const assetsDir = path.join(input.dataDir, 'assets');
  const snapshotAssetsDir = path.join(snapshotDir, 'assets');

  mkdirSync(snapshotDir, { recursive: true });

  if (existsSync(dbPath)) {
    copyFileSync(dbPath, snapshotDbPath);
  }

  if (existsSync(assetsDir)) {
    cpSync(assetsDir, snapshotAssetsDir, { recursive: true });
  }

  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    zip.extractEntryTo('app.db', input.dataDir, false, true);
    extractAssets(zip, input.dataDir);
    return true;
  } catch (error) {
    if (existsSync(snapshotDbPath)) {
      copyFileSync(snapshotDbPath, dbPath);
    }

    rmSync(assetsDir, { recursive: true, force: true });
    if (existsSync(snapshotAssetsDir)) {
      cpSync(snapshotAssetsDir, assetsDir, { recursive: true });
    }

    throw error;
  }
}
