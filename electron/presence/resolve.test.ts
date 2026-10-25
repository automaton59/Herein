import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import type { PersonaRuntime } from '../persona/runtime';
import { resolveDesktopPresence } from './resolve';

const roots: string[] = [];

function modelJson(expressions: string[]) {
  return JSON.stringify({
    Version: 3,
    FileReferences: {
      Expressions: expressions.map(name => ({ Name: name, File: `${name}.exp3.json` })),
    },
  });
}

async function createFixture(input: {
  personaEntry: string;
  personaModelPath: string;
  legacyAsset?: { relativePath: string; filePath: string; source?: string };
}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'herein-presence-'));
  roots.push(dataDir);
  const db = openPhase2Database(':memory:');
  const repos = createPhase2Repositories(db);

  repos.characters.upsert({
    id: 'persona-1',
    name: '海拾香',
    nickname: '蓝蓝',
    description: '',
    firstMessage: '',
  });
  repos.timelines.ensurePrimaryForCharacter('persona-1', '海拾香');

  const personaModelAbsolute = path.join(dataDir, input.personaModelPath);
  await mkdir(path.dirname(personaModelAbsolute), { recursive: true });
  await writeFile(personaModelAbsolute, modelJson(['happy', 'blush', 'sad']), 'utf8');

  if (input.legacyAsset) {
    const legacyAbsolute = path.join(dataDir, input.legacyAsset.relativePath);
    await mkdir(path.dirname(legacyAbsolute), { recursive: true });
    await writeFile(legacyAbsolute, modelJson(['legacyHappy']), 'utf8');
    repos.assets.create({
      id: 'legacy-asset',
      characterId: 'persona-1',
      kind: 'live2d',
      relativePath: input.legacyAsset.relativePath,
      label: '旧形象',
      metadata: {
        renderer: 'live2d',
        ...(input.legacyAsset.source ? { source: input.legacyAsset.source } : {}),
      },
    });
    repos.presentationProfiles.upsert({
      characterId: 'persona-1',
      dynamicAssetId: 'legacy-asset',
      emotionAssetMap: {},
      fallbackEmotion: 'neutral',
      preferredRenderer: 'live2d',
    });
  }

  const persona = {
    id: 'persona-1',
    name: '海拾香',
    nickname: '蓝蓝',
    pack: {
      manifest: { id: 'persona-1' },
      character: {
        schemaVersion: 1,
        id: 'persona-1',
        name: '海拾香',
        nickname: '蓝蓝',
        relationshipFrame: '女友',
        personality: { core: ['测试'] },
        speakingStyle: { defaultAddress: '你' },
        avatar: {
          type: 'live2d',
          entry: input.personaEntry,
          expressions: {
            happy: 'happy',
            shy: 'blush',
            sad: 'sad',
          },
        },
      },
      templates: new Map(),
      root: dataDir,
    },
  } as unknown as PersonaRuntime;

  return { dataDir, db, repos, persona };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('desktop presence resolver', () => {
  it('prefers the persona Live2D over a legacy presentation-profile asset', async () => {
    const fixture = await createFixture({
      personaEntry: 'assets/avatars/persona/main.model3.json',
      personaModelPath: 'assets/avatars/persona/main.model3.json',
      legacyAsset: {
        relativePath: 'assets/legacy/old.model3.json',
        filePath: 'assets/legacy/old.model3.json',
      },
    });

    try {
      const state = await resolveDesktopPresence({
        repos: fixture.repos,
        dataDir: fixture.dataDir,
        characterId: 'persona-1',
        persona: fixture.persona,
        coreUrl: 'http://127.0.0.1:9999',
        hosting: false,
        mainWindowVisible: true,
      });

      expect(state.avatar?.kind).toBe('live2d');
      expect(state.avatar?.kind === 'live2d' ? state.avatar.modelUrl : '').toContain('/assets/avatars/persona/main.model3.json');
      expect(state.avatar?.kind === 'live2d' ? state.avatar.expressionMap : {}).toMatchObject({
        happy: 'happy',
        shy: 'blush',
        sad: 'sad',
      });
      expect(state.character.name).toBe('海拾香');
      expect(state.online).toBe(true);
    } finally {
      fixture.db.close();
    }
  });

  it('uses an explicitly imported asset as the user override', async () => {
    const fixture = await createFixture({
      personaEntry: 'assets/avatars/persona/main.model3.json',
      personaModelPath: 'assets/avatars/persona/main.model3.json',
      legacyAsset: {
        relativePath: 'assets/imported/custom.model3.json',
        filePath: 'assets/imported/custom.model3.json',
        source: 'user',
      },
    });

    try {
      const state = await resolveDesktopPresence({
        repos: fixture.repos,
        dataDir: fixture.dataDir,
        characterId: 'persona-1',
        persona: fixture.persona,
        coreUrl: 'http://127.0.0.1:9999',
        hosting: true,
        mainWindowVisible: false,
      });

      expect(state.avatar?.kind === 'live2d' ? state.avatar.modelUrl : '').toContain('/assets/imported/custom.model3.json');
      expect(state.hosting).toBe(true);
      expect(state.mainWindowVisible).toBe(false);
    } finally {
      fixture.db.close();
    }
  });

  it('reports a friendly notice instead of throwing when the persona model is missing', async () => {
    const fixture = await createFixture({
      personaEntry: 'assets/avatars/persona/missing.model3.json',
      personaModelPath: 'assets/avatars/persona/main.model3.json',
    });

    try {
      const state = await resolveDesktopPresence({
        repos: fixture.repos,
        dataDir: fixture.dataDir,
        characterId: 'persona-1',
        persona: fixture.persona,
        coreUrl: 'http://127.0.0.1:9999',
        hosting: false,
        mainWindowVisible: true,
      });

      expect(state.avatar).toBeNull();
      expect(state.notice).toContain('missing.model3.json');
    } finally {
      fixture.db.close();
    }
  });
});
