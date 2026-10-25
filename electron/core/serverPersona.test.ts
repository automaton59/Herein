import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPersonaPack } from '../persona/loader';
import { startCoreServer, type CoreServerHandle } from './server';

const handles: CoreServerHandle[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createPackDir() {
  const root = mkdtempSync(path.join(tmpdir(), 'herein-persona-api-'));
  tempDirs.push(root);
  mkdirSync(path.join(root, 'prompts'), { recursive: true });
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'api-persona',
    version: '1.0.0',
    engine: '>=0.1.0',
    character: 'character.json',
    templates: [
      { id: 'safety_identity', layer: 'L0_safety_identity', file: 'prompts/safety.md', required: true },
      { id: 'character_core', layer: 'L1_character_core', file: 'prompts/core.md', required: true },
      { id: 'chat_behavior', layer: 'L5_task', file: 'prompts/chat.md', required: true },
    ],
  }), 'utf8');
  writeFileSync(path.join(root, 'character.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'api-persona',
    name: '接口角色',
    nickname: '接口',
    relationshipFrame: '朋友',
    personality: { core: ['直接'] },
    speakingStyle: { defaultAddress: '你' },
  }), 'utf8');
  writeFileSync(path.join(root, 'prompts', 'safety.md'), '你是{{character_name}}。', 'utf8');
  writeFileSync(path.join(root, 'prompts', 'core.md'), '人格：{{character_name}}', 'utf8');
  writeFileSync(path.join(root, 'prompts', 'chat.md'), '场景：{{presence_mode}}', 'utf8');
  return root;
}

function editBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '界面名',
    nickname: '界面昵',
    relationshipFrame: '朋友',
    personalityCore: ['直接'],
    values: [],
    boundaries: [],
    speakingStyle: { defaultAddress: '你', occasionalAddress: '', examples: [] },
    templates: {
      chat_behavior: '场景：{{presence_mode}}。界面改过的策略。',
    },
    ...overrides,
  };
}

describe('persona editing API', () => {
  it('exposes, edits and refreshes the persona over HTTP', async () => {
    const packRoot = createPackDir();
    const pack = await loadPersonaPack(packRoot);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'herein-persona-api-db-'));
    tempDirs.push(dataDir);
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      personaPacks: new Map([[pack.manifest.id, pack]]),
      seedPersonaPacks: true,
    });
    handles.push(handle);

    const base = `http://127.0.0.1:${handle.port}`;

    const initial = await fetch(`${base}/v1/persona`).then(r => r.json());
    expect(initial).toMatchObject({
      available: true,
      packId: 'api-persona',
      fileChanged: false,
      hasEdits: false,
    });
    expect(initial.character).toMatchObject({ name: '接口角色' });
    expect(initial.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'chat_behavior', text: '场景：{{presence_mode}}', edited: false }),
      ]),
    );

    const saved = await fetch(`${base}/v1/persona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editBody()),
    }).then(r => r.json());

    expect(saved.character).toMatchObject({ name: '界面名', nickname: '界面昵' });
    expect(saved.hasEdits).toBe(true);
    expect(saved.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'chat_behavior', edited: true, text: '场景：{{presence_mode}}。界面改过的策略。' }),
      ]),
    );

    // The identity upsert is visible on the characters endpoint too.
    const characters = await fetch(`${base}/v1/characters`).then(r => r.json());
    expect(characters.characters).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'api-persona', name: '界面名' })]),
    );

    // Invalid edits are rejected with a readable error.
    const invalid = await fetch(`${base}/v1/persona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editBody({ templates: { chat_behavior: '你好 {{not_a_variable}}' } })),
    });
    expect(invalid.status).toBe(400);

    // An external edit on disk flips fileChanged and blocks saves until refresh.
    writeFileSync(path.join(packRoot, 'prompts', 'chat.md'), '场景：{{presence_mode}}。磁盘新版本。', 'utf8');

    const afterDiskEdit = await fetch(`${base}/v1/persona`).then(r => r.json());
    expect(afterDiskEdit.fileChanged).toBe(true);

    const blocked = await fetch(`${base}/v1/persona`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editBody()),
    });
    expect(blocked.status).toBe(409);

    const refreshed = await fetch(`${base}/v1/persona/refresh`, { method: 'POST' }).then(r => r.json());
    expect(refreshed.fileChanged).toBe(false);
    expect(refreshed.hasEdits).toBe(false);
    expect(refreshed.character).toMatchObject({ name: '接口角色' });
    expect(refreshed.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'chat_behavior', edited: false, text: '场景：{{presence_mode}}。磁盘新版本。' }),
      ]),
    );
  });

  it('returns available:false when no persona pack exists', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'herein-persona-api-empty-'));
    tempDirs.push(dataDir);
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
    });
    handles.push(handle);

    const view = await fetch(`http://127.0.0.1:${handle.port}/v1/persona`).then(r => r.json());
    expect(view).toMatchObject({ available: false, packId: null });
  });

  it('re-anchors activeCharacterId when it points outside the loaded packs', async () => {
    // Simulate another build's persona having run against this data
    // directory: an unknown character row exists and is the active one.
    const dataDir = mkdtempSync(path.join(tmpdir(), 'herein-persona-api-ghost-'));
    tempDirs.push(dataDir);
    const { openPhase2Database } = await import('../data/database');
    const { createPhase2Repositories } = await import('../data/repositories');
    const db = openPhase2Database(path.join(dataDir, 'app.db'));
    const seedRepos = createPhase2Repositories(db);
    seedRepos.characters.upsert({
      id: 'ghost-companion',
      name: '别的包的角色',
      nickname: null,
      description: '',
      scenario: '',
      firstMessage: '',
      systemPrompt: '',
      personalityCore: '',
      speakingStyle: '',
      valuesText: '',
      boundaries: '',
      avatarAssetId: null,
      assetDir: null,
    });
    seedRepos.settings.set('activeCharacterId', 'ghost-companion');
    db.close();

    const packRoot = createPackDir();
    const pack = await loadPersonaPack(packRoot);
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      personaPacks: new Map([[pack.manifest.id, pack]]),
      seedPersonaPacks: true,
    });
    handles.push(handle);

    const view = await fetch(`http://127.0.0.1:${handle.port}/v1/persona`).then(r => r.json());
    expect(view).toMatchObject({
      available: true,
      packId: 'api-persona',
      activeCharacterId: 'api-persona',
    });

    const characters = await fetch(`http://127.0.0.1:${handle.port}/v1/characters`).then(r => r.json());
    expect(characters.characters).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'api-persona', name: '接口角色' })]),
    );
  });
});
