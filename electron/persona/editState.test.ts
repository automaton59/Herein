import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { loadPersonaPack } from './loader';
import {
  PERSONA_EDIT_KEY,
  PERSONA_FINGERPRINT_KEY,
  applyPersonaEdit,
  fingerprintPack,
  syncPersonaIfChanged,
  validatePersonaEditInput,
} from './editState';

const roots: string[] = [];

async function createPack(options: { chat?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'herein-edit-'));
  roots.push(root);
  await mkdir(path.join(root, 'prompts'), { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'edit-persona',
    version: '1.0.0',
    engine: '>=0.1.0',
    character: 'character.json',
    templates: [
      { id: 'safety_identity', layer: 'L0_safety_identity', file: 'prompts/safety.md', required: true },
      { id: 'character_core', layer: 'L1_character_core', file: 'prompts/core.md', required: true },
      { id: 'chat_behavior', layer: 'L5_task', file: 'prompts/chat.md', required: true },
    ],
  }), 'utf8');
  await writeFile(path.join(root, 'character.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'edit-persona',
    name: '原名',
    nickname: '原名昵',
    relationshipFrame: '朋友',
    personality: { core: ['冷静'] },
    speakingStyle: { defaultAddress: '你' },
  }), 'utf8');
  await writeFile(path.join(root, 'prompts', 'safety.md'), '你是{{character_name}}。', 'utf8');
  await writeFile(path.join(root, 'prompts', 'core.md'), '人格：{{character_name}}', 'utf8');
  await writeFile(
    path.join(root, 'prompts', 'chat.md'),
    options.chat ?? '场景：{{presence_mode}}',
    'utf8',
  );
  return loadPersonaPack(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function editBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '新名',
    nickname: '新昵',
    relationshipFrame: '挚友',
    personalityCore: ['活泼'],
    values: ['真诚'],
    boundaries: ['不越界'],
    speakingStyle: { defaultAddress: '你', occasionalAddress: '喂', examples: ['嗯。'] },
    templates: {
      chat_behavior: '场景：{{presence_mode}}，自定义策略',
    },
    ...overrides,
  };
}

describe('persona edit state', () => {
  it('fingerprints are stable and change when templates change', async () => {
    const pack = await createPack();
    const again = await createPack();
    const changed = await createPack({ chat: '场景：{{presence_mode}}，改过' });

    expect(fingerprintPack(pack)).toBe(fingerprintPack(again));
    expect(fingerprintPack(pack)).not.toBe(fingerprintPack(changed));
  });

  it('applies edits on top of the pack without mutating it', async () => {
    const pack = await createPack();
    const state = validatePersonaEditInput(pack, editBody());

    if (!state.ok) {
      throw new Error(`unexpected validation errors: ${state.errors.join(';')}`);
    }

    const effective = applyPersonaEdit(pack, state.state);

    expect(effective.character.name).toBe('新名');
    expect(effective.character.nickname).toBe('新昵');
    expect(effective.character.personality.core).toEqual(['活泼']);
    expect(effective.templates.get('chat_behavior')?.text).toContain('自定义策略');
    expect(effective.templates.get('safety_identity')?.text).toBe('你是{{character_name}}。');

    // The base pack stays untouched.
    expect(pack.character.name).toBe('原名');
    expect(pack.templates.get('chat_behavior')?.text).toBe('场景：{{presence_mode}}');
  });

  it('stores template overrides sparsely', async () => {
    const pack = await createPack();
    const state = validatePersonaEditInput(pack, editBody({
      templates: { chat_behavior: '场景：{{presence_mode}}' },
    }));

    expect(state.ok).toBe(true);

    if (state.ok) {
      expect(state.state.templates).toEqual({});
    }
  });

  it('rejects unknown templates, unknown variables, cleared required layers', async () => {
    const pack = await createPack();

    const unknownTemplate = validatePersonaEditInput(pack, editBody({
      templates: { not_a_template: 'text' },
    }));
    expect(unknownTemplate.ok).toBe(false);

    const unknownVariable = validatePersonaEditInput(pack, editBody({
      templates: { chat_behavior: '你好 {{not_a_variable}}' },
    }));
    expect(unknownVariable.ok).toBe(false);

    const clearedRequired = validatePersonaEditInput(pack, editBody({
      templates: { chat_behavior: '   ' },
    }));
    expect(clearedRequired.ok).toBe(false);

    const emptyName = validatePersonaEditInput(pack, editBody({ name: '  ' }));
    expect(emptyName.ok).toBe(false);
  });

  it('keeps in-app edits across restarts and reapplies when the pack changes', async () => {
    const dbPath = path.join(await mkdtemp(path.join(tmpdir(), 'herein-edit-db-')), 'app.db');
    roots.push(path.dirname(dbPath));
    const db = openPhase2Database(dbPath);

    try {
      const repos = createPhase2Repositories(db);

      const pack = await createPack();

      const first = syncPersonaIfChanged(repos, pack);
      expect(first).toEqual({ applied: true, reason: 'seeded' });
      expect(repos.characters.get('edit-persona')?.name).toBe('原名');

      // In-app edit survives an unchanged restart.
      repos.settings.set(PERSONA_EDIT_KEY, {
        name: '界面改的名',
        nickname: '',
        relationshipFrame: '朋友',
        personalityCore: ['冷静'],
        values: [],
        boundaries: [],
        speakingStyle: { defaultAddress: '你', occasionalAddress: '', examples: [] },
        templates: {},
      });
      repos.characters.upsert({
        id: 'edit-persona',
        name: '界面改的名',
        nickname: null,
        description: '',
        scenario: '',
        firstMessage: '',
        systemPrompt: '',
        personalityCore: '冷静',
        speakingStyle: '',
        valuesText: '',
        boundaries: '',
        avatarAssetId: null,
        assetDir: null,
      });

      const unchanged = syncPersonaIfChanged(repos, pack);
      expect(unchanged).toEqual({ applied: false, reason: 'unchanged' });
      expect(repos.characters.get('edit-persona')?.name).toBe('界面改的名');

      // Once the fingerprint changes, the pack wins again and edits are cleared.
      const changed = await createPack({ chat: '场景：{{presence_mode}}，外部修改' });
      const reapplied = syncPersonaIfChanged(repos, changed);
      expect(reapplied).toEqual({ applied: true, reason: 'fingerprint-changed' });
      expect(repos.characters.get('edit-persona')?.name).toBe('原名');
      expect(repos.settings.get(PERSONA_EDIT_KEY)).toBeNull();
      expect(repos.settings.get<string>(PERSONA_FINGERPRINT_KEY)).toBe(fingerprintPack(changed));
    } finally {
      db.close();
    }
  });
});
