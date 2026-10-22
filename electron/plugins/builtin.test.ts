/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { createBilibiliPlugin, BILIBILI_MANIFEST } from './builtin/bilibili';
import { createNeteasePlugin, NETEASE_MANIFEST } from './builtin/netease';
import { QQ_MANIFEST } from './builtin/qq';
import { PluginRegistry } from './registry';

const tempDirs: string[] = [];
const disposables: Array<{ close: () => Promise<void> | void }> = [];

function createHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-builtin-'));
  tempDirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  const repos = createPhase2Repositories(db);
  repos.characters.upsert({
    id: 'char-1',
    name: '蓝蓝',
    description: '',
    scenario: '',
    firstMessage: '',
    systemPrompt: '',
    personalityCore: '',
    speakingStyle: '',
    valuesText: '',
    boundaries: '',
  });
  const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', '蓝蓝');
  const registry = new PluginRegistry({
    db,
    pluginsDir: path.join(dir, 'plugins'),
    now: () => new Date('2026-10-22T12:00:00.000Z'),
  });

  disposables.push({
    close: async () => {
      await registry.close();
      db.close();
    },
  });

  return { db, repos, timeline, registry };
}

afterEach(async () => {
  for (const disposable of disposables.splice(0)) {
    await disposable.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('built-in plugins', () => {
  it('registers, installs and invokes a built-in plugin through the same registry', async () => {
    const { registry } = createHarness();
    registry.registerBuiltin({
      id: 'builtin-demo',
      name: 'Builtin Demo',
      version: '0.1.0',
      kind: 'tool',
      entry: 'builtin.js',
      permissions: [],
    }, () => ({
      async health(ctx) {
        return { status: 'ok', checkedAt: ctx.now().toISOString() };
      },
      async invoke(action) {
        return { action };
      },
    }));
    await registry.initialize();

    expect(registry.get('builtin-demo')).toEqual(expect.objectContaining({
      installed: false,
      available: true,
    }));

    await registry.install('builtin-demo');
    await registry.enable('builtin-demo');
    await expect(registry.invoke('builtin-demo', 'ping', null)).resolves.toEqual({ action: 'ping' });
  });

  it('scans the Bilibili feed through the built-in source plugin', async () => {
    const { registry, repos } = createHarness();
    const source = {
      getRcmd: vi.fn().mockResolvedValue({
        item: [{
          bvid: 'BV1test',
          title: '一个测试视频',
          owner: { mid: 1, name: 'UP' },
        }],
      }),
    };
    registry.registerBuiltin(BILIBILI_MANIFEST, () => createBilibiliPlugin({
      repos,
      source,
      now: () => new Date('2026-10-22T12:00:00.000Z'),
    }));
    await registry.initialize();
    await registry.install('bilibili');
    await registry.enable('bilibili');

    const result = await registry.invoke('bilibili', 'scan', { limit: 5 }) as {
      fetched: number;
      inserted: number;
    };

    expect(result).toEqual(expect.objectContaining({ fetched: 1, inserted: 1 }));
    expect(repos.observations.listRecent({ platform: 'bilibili' })).toHaveLength(1);
  });

  it('returns NetEase candidates through the built-in source plugin', async () => {
    const { registry } = createHarness();
    const source = {
      search: vi.fn().mockResolvedValue({
        songs: [{ id: 1, name: '夜曲', ar: [{ name: '周杰伦' }] }],
      }),
      toplists: vi.fn().mockResolvedValue([]),
      playlist: vi.fn().mockResolvedValue(null),
    };
    registry.registerBuiltin(NETEASE_MANIFEST, () => createNeteasePlugin({ source }));
    await registry.initialize();
    await registry.install('netease');
    await registry.enable('netease');

    const result = await registry.invoke('netease', 'candidates', {
      query: '周杰伦',
      limit: 1,
    }) as { candidates: Array<{ title: string }> };

    expect(result.candidates[0].title).toBe('夜曲');
  });

  it('registers QQ as a channel capability', async () => {
    const { registry } = createHarness();
    registry.registerBuiltin(QQ_MANIFEST, () => ({
      async health(ctx) {
        return { status: 'degraded', message: 'test profile', checkedAt: ctx.now().toISOString() };
      },
      async invoke(action) {
        return { action, running: false };
      },
    }));
    await registry.initialize();
    await registry.install('qq');
    await registry.enable('qq');

    expect(registry.get('qq')).toEqual(expect.objectContaining({
      installed: true,
      enabled: true,
      manifest: expect.objectContaining({ kind: 'channel', id: 'qq' }),
    }));
    await expect(registry.invoke('qq', 'status', null)).resolves.toEqual({
      action: 'status',
      running: false,
    });
  });
});
