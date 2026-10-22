/** @vitest-environment node */
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from './database';
import { createPhase2Repositories } from './repositories';
import {
  exportCharacterArchive,
  exportFullBackup,
  importCharacterArchive,
  restoreFullBackup,
} from './archive';

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-archive-'));
  tempDirs.push(dir);
  return dir;
}

function createTestDatabase(dataDir: string) {
  return openPhase2Database(path.join(dataDir, 'app.db'));
}

function seedCharacter(db: Phase2Database) {
  const repos = createPhase2Repositories(db);

  repos.characters.upsert({
    id: 'char-1',
    name: 'AL-1S',
    description: 'Warm companion.',
    scenario: 'Private chat.',
    firstMessage: 'I am here.',
    systemPrompt: 'Stay in character.',
    personalityCore: 'Gentle.',
    speakingStyle: 'Natural.',
    valuesText: 'Care.',
    boundaries: 'No reasoning.',
  });
  const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');
  repos.messages.append({
    id: 'msg-1',
    timelineId: timeline.id,
    role: 'user',
    content: 'I gave you a gift on August 3.',
    timestamp: '2026-08-03T20:00:00.000Z',
  });
  repos.summaries.upsert({
    id: 'summary-1',
    timelineId: timeline.id,
    content: 'User gave AL-1S a gift on August 3.',
    messageCount: 1,
    sourceMessageIds: ['msg-1'],
  });
  repos.memories.create({
    id: 'mem-1',
    characterId: 'char-1',
    timelineId: timeline.id,
    scope: 'character',
    kind: 'event',
    content: 'User gave AL-1S a gift on August 3.',
    origin: 'manual',
  });
  db.prepare(`
    insert into relationship_profiles (
      character_id, tone, closeness, shared_habits, private_language,
      important_experiences, unresolved_context, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('char-1', 'close', 4, 'Good night', 'soft nickname', 'Gift on August 3', '', '2026-06-19T00:00:00.000Z');

  return timeline;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('archive helpers', () => {
  it('exports a character profile archive without private memories by default', async () => {
    const dataDir = createTempDir();
    const db = createTestDatabase(dataDir);
    seedCharacter(db);

    const archivePath = await exportCharacterArchive({
      db,
      dataDir,
      characterId: 'char-1',
      mode: 'profile',
      targetPath: path.join(dataDir, 'profile.zip'),
    });
    const zip = new AdmZip(archivePath);
    const payload = JSON.parse(zip.readAsText('character.json'));

    expect(payload.character).toEqual(expect.objectContaining({ id: 'char-1', name: 'AL-1S' }));
    expect(payload.memories).toBeUndefined();
    expect(payload.timeline).toBeUndefined();

    closePhase2Database(db);
  });

  it('exports a full character archive with relationship, memories, summary, and primary timeline', async () => {
    const dataDir = createTempDir();
    const db = createTestDatabase(dataDir);
    const timeline = seedCharacter(db);

    const archivePath = await exportCharacterArchive({
      db,
      dataDir,
      characterId: 'char-1',
      mode: 'full',
      targetPath: path.join(dataDir, 'full.zip'),
    });
    const zip = new AdmZip(archivePath);
    const payload = JSON.parse(zip.readAsText('character.json'));

    expect(payload.relationship).toEqual(expect.objectContaining({ tone: 'close', closeness: 4 }));
    expect(payload.memories).toEqual([expect.objectContaining({ id: 'mem-1' })]);
    expect(payload.summary).toEqual(expect.objectContaining({ content: 'User gave AL-1S a gift on August 3.' }));
    expect(payload.timeline).toEqual(expect.objectContaining({
      id: timeline.id,
      messages: [expect.objectContaining({ id: 'msg-1' })],
    }));

    closePhase2Database(db);
  });

  it('imports a full character archive with relationship, memories, summary, and primary timeline', async () => {
    const sourceDir = createTempDir();
    const sourceDb = createTestDatabase(sourceDir);
    seedCharacter(sourceDb);
    const archivePath = await exportCharacterArchive({
      db: sourceDb,
      dataDir: sourceDir,
      characterId: 'char-1',
      mode: 'full',
      targetPath: path.join(sourceDir, 'full.zip'),
    });
    closePhase2Database(sourceDb);

    const targetDir = createTempDir();
    const targetDb = createTestDatabase(targetDir);
    const importedId = await importCharacterArchive({
      db: targetDb,
      dataDir: targetDir,
      archivePath,
    });
    const repos = createPhase2Repositories(targetDb);
    const timeline = repos.timelines.getPrimaryForCharacter(importedId);
    const relationship = targetDb.prepare('select tone, closeness from relationship_profiles where character_id = ?').get(importedId);

    expect(repos.characters.get(importedId)).toEqual(expect.objectContaining({ name: 'AL-1S' }));
    expect(relationship).toEqual({ tone: 'close', closeness: 4 });
    expect(repos.memories.listAll({ characterId: importedId })).toEqual([
      expect.objectContaining({ content: 'User gave AL-1S a gift on August 3.' }),
    ]);
    expect(timeline).toBeTruthy();
    expect(timeline && repos.summaries.getByTimeline(timeline.id)).toEqual(expect.objectContaining({
      content: 'User gave AL-1S a gift on August 3.',
    }));
    expect(timeline && repos.messages.listRecent(timeline.id, 10)).toEqual([
      expect.objectContaining({ content: 'I gave you a gift on August 3.' }),
    ]);

    closePhase2Database(targetDb);
  });

  it('exports and imports full character expression asset records with metadata', async () => {
    const sourceDir = createTempDir();
    const sourceDb = createTestDatabase(sourceDir);
    seedCharacter(sourceDb);
    const sourceRepos = createPhase2Repositories(sourceDb);

    mkdirSync(path.join(sourceDir, 'assets', 'char-1'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'assets', 'char-1', 'expression-happy.png'), 'image', { encoding: 'utf8', flag: 'w' });
    sourceRepos.assets.create({
      id: 'asset-happy',
      characterId: 'char-1',
      kind: 'expression',
      relativePath: 'assets/char-1/expression-happy.png',
      mimeType: 'image/png',
      label: '开心',
      metadata: { emotion: 'happy', expressionKey: 'happy-main', priority: 10 },
    });

    const archivePath = await exportCharacterArchive({
      db: sourceDb,
      dataDir: sourceDir,
      characterId: 'char-1',
      mode: 'full',
      targetPath: path.join(sourceDir, 'full-with-assets.zip'),
    });
    const zip = new AdmZip(archivePath);
    const payload = JSON.parse(zip.readAsText('character.json'));

    expect(payload.assets).toEqual([
      expect.objectContaining({
        id: 'asset-happy',
        kind: 'expression',
        metadata: expect.objectContaining({ emotion: 'happy', priority: 10 }),
      }),
    ]);
    expect(zip.getEntry('assets/expression-happy.png')).toBeTruthy();
    closePhase2Database(sourceDb);

    const targetDir = createTempDir();
    const targetDb = createTestDatabase(targetDir);
    const importedId = await importCharacterArchive({
      db: targetDb,
      dataDir: targetDir,
      archivePath,
    });
    const targetRepos = createPhase2Repositories(targetDb);

    expect(targetRepos.assets.list({ characterId: importedId, kind: 'expression' })).toEqual([
      expect.objectContaining({
        kind: 'expression',
        relativePath: `assets/${importedId}/expression-happy.png`,
        metadata: expect.objectContaining({ emotion: 'happy', expressionKey: 'happy-main' }),
      }),
    ]);
    expect(existsSync(path.join(targetDir, 'assets', importedId, 'expression-happy.png'))).toBe(true);

    closePhase2Database(targetDb);
  });

  it('exports and imports presentation profiles with remapped static and dynamic asset ids', async () => {
    const sourceDir = createTempDir();
    const sourceDb = createTestDatabase(sourceDir);
    seedCharacter(sourceDb);
    const sourceRepos = createPhase2Repositories(sourceDb);

    mkdirSync(path.join(sourceDir, 'assets', 'char-1'), { recursive: true });
    mkdirSync(path.join(sourceDir, 'assets', 'char-1', 'live2d-main', 'textures'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'assets', 'char-1', 'expression-happy.png'), 'image', { encoding: 'utf8', flag: 'w' });
    writeFileSync(path.join(sourceDir, 'assets', 'char-1', 'video-idle.mp4'), 'video', { encoding: 'utf8', flag: 'w' });
    writeFileSync(path.join(sourceDir, 'assets', 'char-1', 'live2d-main', 'model.model3.json'), '{}', { encoding: 'utf8', flag: 'w' });
    writeFileSync(path.join(sourceDir, 'assets', 'char-1', 'live2d-main', 'textures', 'body.png'), 'texture', { encoding: 'utf8', flag: 'w' });
    sourceRepos.assets.create({
      id: 'asset-happy',
      characterId: 'char-1',
      kind: 'expression',
      relativePath: 'assets/char-1/expression-happy.png',
      mimeType: 'image/png',
      label: '开心',
      metadata: { emotion: 'happy', priority: 10 },
    });
    sourceRepos.assets.create({
      id: 'video-idle',
      characterId: 'char-1',
      kind: 'video',
      relativePath: 'assets/char-1/video-idle.mp4',
      mimeType: 'video/mp4',
      label: '待机循环',
      metadata: { renderer: 'video', loop: true, muted: true },
    });
    sourceRepos.assets.create({
      id: 'live2d-main',
      characterId: 'char-1',
      kind: 'live2d',
      relativePath: 'assets/char-1/live2d-main/model.model3.json',
      mimeType: 'application/json',
      label: 'Live2D 主模型',
      metadata: { renderer: 'live2d', entry: 'model.model3.json' },
    });
    sourceRepos.presentationProfiles.upsert({
      characterId: 'char-1',
      defaultAssetId: 'asset-happy',
      dynamicAssetId: 'video-idle',
      fallbackEmotion: 'happy',
      preferredRenderer: 'video',
      emotionAssetMap: { happy: 'asset-happy' },
    });

    const archivePath = await exportCharacterArchive({
      db: sourceDb,
      dataDir: sourceDir,
      characterId: 'char-1',
      mode: 'full',
      targetPath: path.join(sourceDir, 'full-with-profile.zip'),
    });
    const zip = new AdmZip(archivePath);
    const payload = JSON.parse(zip.readAsText('character.json'));

    expect(payload.presentationProfile).toEqual({
      characterId: 'char-1',
      defaultAssetId: 'asset-happy',
      dynamicAssetId: 'video-idle',
      fallbackEmotion: 'happy',
      preferredRenderer: 'video',
      emotionAssetMap: { happy: 'asset-happy' },
    });
    expect(zip.getEntry('assets/video-idle.mp4')).toBeTruthy();
    expect(zip.getEntry('assets/live2d-main/textures/body.png')).toBeTruthy();
    closePhase2Database(sourceDb);

    const targetDir = createTempDir();
    const targetDb = createTestDatabase(targetDir);
    const targetRepos = createPhase2Repositories(targetDb);
    targetRepos.characters.upsert({ id: 'char-1', name: 'Existing' });
    targetRepos.assets.create({
      id: 'asset-happy',
      characterId: 'char-1',
      kind: 'expression',
      relativePath: 'assets/char-1/existing.png',
      mimeType: 'image/png',
      label: 'Existing',
    });
    targetRepos.assets.create({
      id: 'video-idle',
      characterId: 'char-1',
      kind: 'video',
      relativePath: 'assets/char-1/existing-video.mp4',
      mimeType: 'video/mp4',
      label: 'Existing video',
    });

    const importedId = await importCharacterArchive({
      db: targetDb,
      dataDir: targetDir,
      archivePath,
    });
    const importedAssets = targetRepos.assets.list({ characterId: importedId, kind: 'expression' });
    const importedVideoAssets = targetRepos.assets.list({ characterId: importedId, kind: 'video' });
    const importedProfile = targetRepos.presentationProfiles.get(importedId);

    expect(importedId).not.toBe('char-1');
    expect(importedAssets).toHaveLength(1);
    expect(importedVideoAssets).toHaveLength(1);
    expect(importedProfile).toEqual({
      characterId: importedId,
      defaultAssetId: importedAssets[0].id,
      dynamicAssetId: importedVideoAssets[0].id,
      fallbackEmotion: 'happy',
      preferredRenderer: 'video',
      emotionAssetMap: { happy: importedAssets[0].id },
    });
    expect(existsSync(path.join(targetDir, 'assets', importedId, 'live2d-main', 'textures', 'body.png'))).toBe(true);

    closePhase2Database(targetDb);
  });

  it('exports a full backup zip with manifest, sanitized app.db, and assets', async () => {
    const dataDir = createTempDir();
    const db = createTestDatabase(dataDir);
    const repos = createPhase2Repositories(db);
    repos.apiProfiles.upsert({
      id: 'profile-1',
      name: 'Main',
      provider: 'openai',
      model: 'gpt-4o-mini',
      encryptedApiKey: 'secret-ciphertext',
      keyEncoding: 'safe:v1',
    });
    mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
    writeFileSync(path.join(dataDir, 'assets', 'avatar.txt'), 'asset', { encoding: 'utf8', flag: 'w' });

    const backupPath = await exportFullBackup({
      db,
      dataDir,
      targetPath: path.join(dataDir, 'backup.zip'),
      includeSecrets: false,
    });
    const zip = new AdmZip(backupPath);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    const extractedDb = path.join(createTempDir(), 'app.db');
    zip.extractEntryTo('app.db', path.dirname(extractedDb), false, true);
    const backupDb = openPhase2Database(extractedDb);
    const row = backupDb.prepare('select encrypted_api_key, key_encoding from api_profiles where id = ?').get('profile-1') as {
      encrypted_api_key: string;
      key_encoding: string;
    };

    expect(manifest).toEqual(expect.objectContaining({
      format: 'herein-backup',
      includesSecrets: false,
    }));
    expect(zip.getEntry('app.db')).toBeTruthy();
    expect(zip.getEntry('assets/avatar.txt')).toBeTruthy();
    expect(row).toEqual({ encrypted_api_key: '', key_encoding: 'plain:fallback' });

    closePhase2Database(backupDb);
    closePhase2Database(db);
  });

  it('rejects invalid backup manifests before replacing current data', async () => {
    const dataDir = createTempDir();
    const db = createTestDatabase(dataDir);
    closePhase2Database(db);
    const originalDbContent = readFileSync(path.join(dataDir, 'app.db'));
    const invalidBackupPath = path.join(dataDir, 'invalid.zip');
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: 'wrong-format' })));
    zip.addFile('app.db', Buffer.from('not a database'));
    zip.writeZip(invalidBackupPath);

    await expect(restoreFullBackup({ dataDir, backupPath: invalidBackupPath })).rejects.toThrow('Invalid Herein backup manifest');

    expect(existsSync(path.join(dataDir, 'app.db'))).toBe(true);
    expect(readFileSync(path.join(dataDir, 'app.db'))).toEqual(originalDbContent);
  });
});
