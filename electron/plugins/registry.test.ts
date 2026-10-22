/** @vitest-environment node */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPhase2Database } from '../data/database';
import { PluginRegistry } from './registry';
import { PluginError } from './types';

const tempDirs: string[] = [];
const disposables: Array<{ close: () => Promise<void> | void }> = [];

function createTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-plugin-'));
  tempDirs.push(dir);
  return dir;
}

function writeDemoPlugin(pluginsDir: string, options: { startFails?: boolean } = {}) {
  const pluginDir = path.join(pluginsDir, 'demo');
  mkdirSync(pluginDir, { recursive: true });

  writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    kind: 'tool',
    entry: 'index.mjs',
    permissions: [{ kind: 'network', value: 'example.com' }],
    configSchema: {
      type: 'object',
      properties: {
        greeting: { type: 'string', default: 'hi' },
      },
      additionalProperties: false,
    },
  }));

  writeFileSync(path.join(pluginDir, 'index.mjs'), `
let starts = 0;
export function createPlugin() {
  return {
    async start(ctx) {
      if (${options.startFails ? 'true' : 'false'}) throw new Error('start failed');
      starts += 1;
      ctx.log('info', 'started');
    },
    async stop() {},
    async health(ctx) {
      return { status: 'ok', checkedAt: ctx.now().toISOString() };
    },
    async invoke(action, input, ctx) {
      if (action === 'echo') return { config: ctx.config, input, starts };
      if (action === 'fetch') {
        const response = await ctx.fetch(input.url);
        return { status: response.status };
      }
      throw new Error('unknown action');
    },
  };
}
`);

  return pluginDir;
}

function createHarness(options: {
  startFails?: boolean;
  fetchImpl?: typeof fetch;
} = {}) {
  const pluginsDir = createTempDir();
  writeDemoPlugin(pluginsDir, { startFails: options.startFails });
  const dataDir = createTempDir();
  const db = openPhase2Database(path.join(dataDir, 'app.db'));
  const registry = new PluginRegistry({
    db,
    pluginsDir,
    fetchImpl: options.fetchImpl ?? (async () => new Response('{}', { status: 200 })) as typeof fetch,
    now: () => new Date('2026-10-22T12:00:00.000Z'),
  });

  disposables.push({
    close: async () => {
      await registry.close();
      db.close();
    },
  });

  return { registry, db };
}

afterEach(async () => {
  for (const disposable of disposables.splice(0)) {
    await disposable.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('PluginRegistry', () => {
  it('discovers, installs, enables, invokes, disables and audits a plugin', async () => {
    const { registry } = createHarness();
    await registry.initialize();

    const available = registry.list().find(plugin => plugin.manifest.id === 'demo');
    expect(available).toEqual(expect.objectContaining({
      installed: false,
      enabled: false,
      config: { greeting: 'hi' },
    }));

    await registry.install('demo');
    const enabled = await registry.enable('demo');
    expect(enabled.enabled).toBe(true);
    expect(enabled.health.status).toBe('ok');

    const result = await registry.invoke('demo', 'echo', { hello: 'world' });
    expect(result).toEqual({
      config: { greeting: 'hi' },
      input: { hello: 'world' },
      starts: 1,
    });

    await registry.disable('demo');
    expect(registry.get('demo')?.enabled).toBe(false);

    const actions = registry.audit(20).map(entry => `${entry.pluginId}:${entry.action}:${entry.status}`);
    expect(actions).toEqual(expect.arrayContaining([
      'demo:install:ok',
      'demo:enable:ok',
      'demo:invoke:echo:ok',
      'demo:disable:ok',
    ]));
  });

  it('validates and persists config, restarting an enabled plugin', async () => {
    const { registry } = createHarness();
    await registry.initialize();
    await registry.install('demo');
    await registry.updateConfig('demo', { greeting: 'yo' });
    await registry.enable('demo');

    expect(await registry.invoke('demo', 'echo', null)).toEqual(expect.objectContaining({
      config: { greeting: 'yo' },
    }));

    await registry.updateConfig('demo', { greeting: 'hey' });
    expect(await registry.invoke('demo', 'echo', null)).toEqual(expect.objectContaining({
      config: { greeting: 'hey' },
    }));

    await expect(registry.updateConfig('demo', { unknown: true })).rejects.toMatchObject({
      code: 'invalid_config',
    });
  });

  it('denies network access outside the manifest allowlist and audits it', async () => {
    const { registry } = createHarness();
    await registry.initialize();
    await registry.install('demo');
    await registry.enable('demo');

    await expect(registry.invoke('demo', 'fetch', { url: 'https://evil.example.net/data' }))
      .rejects.toMatchObject({ code: 'permission_denied' });

    const denied = registry.audit(20).find(entry => entry.action === 'network');
    expect(denied).toEqual(expect.objectContaining({
      pluginId: 'demo',
      status: 'denied',
      detail: { hostname: 'evil.example.net' },
    }));
  });

  it('allows network access inside the manifest allowlist', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const { registry } = createHarness({ fetchImpl });
    await registry.initialize();
    await registry.install('demo');
    await registry.enable('demo');

    await expect(registry.invoke('demo', 'fetch', { url: 'https://example.com/data' }))
      .resolves.toEqual({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects invokes while disabled', async () => {
    const { registry } = createHarness();
    await registry.initialize();
    await registry.install('demo');

    await expect(registry.invoke('demo', 'echo', null)).rejects.toBeInstanceOf(PluginError);
    await expect(registry.invoke('demo', 'echo', null)).rejects.toMatchObject({ code: 'disabled' });
  });

  it('reports a failed enable when start() throws', async () => {
    const { registry } = createHarness({ startFails: true });
    await registry.initialize();
    await registry.install('demo');

    await expect(registry.enable('demo')).rejects.toMatchObject({ code: 'plugin_failed' });
    expect(registry.get('demo')).toEqual(expect.objectContaining({
      enabled: false,
      health: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
