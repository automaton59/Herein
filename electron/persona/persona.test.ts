import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { compilePersona } from './compiler';
import { loadPersonaPack, loadPersonaPacks } from './loader';
import { seedPersonaCharacter, syncPersonaCharacter } from './seed';

const roots: string[] = [];

async function createPack(options: { id?: string; safety?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'herein-persona-'));
  roots.push(root);
  const id = options.id ?? 'test-persona';
  await mkdir(path.join(root, 'prompts'), { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id,
    version: '1.0.0',
    engine: '>=0.1.0',
    character: 'character.json',
    templates: [
      { id: 'safety_identity', layer: 'L0_safety_identity', file: 'prompts/safety.md', required: true },
      { id: 'character_core', layer: 'L1_character_core', file: 'prompts/core.md', required: true },
      { id: 'relationship', layer: 'L2_relationship', file: 'prompts/relationship.md' },
      { id: 'chat_behavior', layer: 'L5_task', file: 'prompts/chat.md', required: true },
      { id: 'group_behavior', layer: 'L5_task', file: 'prompts/group.md' },
    ],
  }), 'utf8');
  await writeFile(path.join(root, 'character.json'), JSON.stringify({
    schemaVersion: 1,
    id,
    name: '测试角色',
    nickname: '小测',
    relationshipFrame: '朋友',
    personality: { core: ['冷静', '直接'] },
    speakingStyle: { defaultAddress: '你', occasionalAddress: '喂' },
  }), 'utf8');
  await writeFile(path.join(root, 'prompts', 'safety.md'), options.safety ?? '你是{{character_name}}。', 'utf8');
  await writeFile(path.join(root, 'prompts', 'core.md'), '人格：{{character_name}}', 'utf8');
  await writeFile(path.join(root, 'prompts', 'relationship.md'), '关系：{{relationship_stage}}/{{closeness}}', 'utf8');
  await writeFile(path.join(root, 'prompts', 'chat.md'), '私聊：{{character_name}} 对 {{user_address}}', 'utf8');
  await writeFile(path.join(root, 'prompts', 'group.md'), '群聊：{{presence_mode}}', 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('persona pack', () => {
  it('loads and compiles private and group prompts', async () => {
    const root = await createPack();
    const pack = await loadPersonaPack(root);

    expect(pack.manifest.id).toBe('test-persona');
    expect(pack.character.name).toBe('测试角色');

    const privatePrompt = compilePersona(pack, { audience: 'private' });
    expect(privatePrompt.identity).toContain('你是测试角色');
    expect(privatePrompt.relationship).toContain('关系：刚开始/0');
    expect(privatePrompt.behavior).toContain('私聊：测试角色 对 你');

    const groupPrompt = compilePersona(pack, { audience: 'group', presenceMode: 'observer' });
    expect(groupPrompt.behavior).toContain('群聊：observer');
    expect(groupPrompt.relationship).toBeNull();
  });

  it('rejects templates with unknown variables', async () => {
    const root = await createPack({ safety: '你是{{character_name}}，{{unknown}}' });
    await expect(loadPersonaPack(root)).rejects.toThrow(/unknown variables/);
  });

  it('rejects unsafe paths', async () => {
    const root = await createPack();
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.character = '../character.json';
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await expect(loadPersonaPack(root)).rejects.toThrow(/safe relative path/);
  });

  it('rejects duplicate pack ids', async () => {
    const first = await createPack({ id: 'same' });
    const second = await createPack({ id: 'same' });
    const parent = await mkdtemp(path.join(tmpdir(), 'herein-personas-'));
    roots.push(parent);
    await cp(first, path.join(parent, 'a'), { recursive: true });
    await cp(second, path.join(parent, 'b'), { recursive: true });
    await expect(loadPersonaPacks(parent)).rejects.toThrow(/duplicate persona pack id/);
  });

  it('accepts valid tuning and rejects out-of-range values', async () => {
    const root = await createPack();
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.tuning = {
      turnDirector: { ventLongChars: 120, maxTokens: { question: 300 } },
      replyStyle: { maxBubbles: 3 },
    };
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    const pack = await loadPersonaPack(root);
    expect(pack.manifest.tuning?.turnDirector?.ventLongChars).toBe(120);

    manifest.tuning = { replyStyle: { maxBubbles: 99 } };
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await expect(loadPersonaPack(root)).rejects.toThrow(/maxBubbles/);
  });

  it('seeds the character and primary timeline once', async () => {
    const root = await createPack();
    const pack = await loadPersonaPack(root);
    const db = openPhase2Database(':memory:');
    const repos = createPhase2Repositories(db);

    const first = seedPersonaCharacter(repos, pack);
    const second = seedPersonaCharacter(repos, pack);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(repos.characters.get('test-persona')?.name).toBe('测试角色');
    expect(repos.characters.get('test-persona')?.firstMessage).toBe('');
    expect(repos.timelines.getPrimaryForCharacter('test-persona')).toBeTruthy();
    db.close();
  });

  it('drops the legacy canned opening line during sync', async () => {
    const root = await createPack();
    const pack = await loadPersonaPack(root);
    const db = openPhase2Database(':memory:');
    const repos = createPhase2Repositories(db);

    seedPersonaCharacter(repos, pack);
    repos.characters.upsert({
      ...repos.characters.get('test-persona')!,
      firstMessage: '在。',
    });
    syncPersonaCharacter(repos, pack);

    expect(repos.characters.get('test-persona')?.firstMessage).toBe('');
    db.close();
  });

  it('re-applies fixed persona fields while preserving local opening line and avatar', async () => {
    const root = await createPack();
    const pack = await loadPersonaPack(root);
    const db = openPhase2Database(':memory:');
    const repos = createPhase2Repositories(db);

    seedPersonaCharacter(repos, pack);
    repos.characters.upsert({
      ...repos.characters.get('test-persona')!,
      firstMessage: '本地开场白',
      avatarAssetId: 'local-avatar',
    });
    pack.character.name = '改名后的角色';
    const result = syncPersonaCharacter(repos, pack);
    const character = repos.characters.get('test-persona');

    expect(result.created).toBe(false);
    expect(character?.name).toBe('改名后的角色');
    expect(character?.firstMessage).toBe('本地开场白');
    expect(character?.avatarAssetId).toBe('local-avatar');
    expect(repos.settings.get('activeCharacterId')).toBe('test-persona');
    db.close();
  });
});
