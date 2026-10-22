/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPhase2Database } from '../data/database';
import { PluginRegistry } from './registry';

const tempDirs: string[] = [];
const disposables: Array<{ close: () => Promise<void> | void }> = [];

function createHarness(fetchImpl: typeof fetch) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'herein-weather-'));
  tempDirs.push(dataDir);
  const db = openPhase2Database(path.join(dataDir, 'app.db'));
  const registry = new PluginRegistry({
    db,
    pluginsDir: path.resolve(process.cwd(), 'plugins'),
    fetchImpl,
    now: () => new Date('2026-10-22T12:00:00.000Z'),
  });

  disposables.push({
    close: async () => {
      await registry.close();
      db.close();
    },
  });

  return { registry };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createWeatherFetch() {
  const urls: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.startsWith('https://geocoding-api.open-meteo.com/')) {
      return jsonResponse({
        results: [{
          name: '杭州',
          country: '中国',
          latitude: 30.2741,
          longitude: 120.1551,
        }],
      });
    }

    if (url.startsWith('https://api.open-meteo.com/')) {
      return jsonResponse({
        current: {
          temperature_2m: 22.3,
          apparent_temperature: 21.1,
          relative_humidity_2m: 70,
          wind_speed_10m: 8.2,
          weather_code: 61,
          time: '2026-10-22T20:00',
        },
      });
    }

    return jsonResponse({ error: 'unexpected url' }, 404);
  }) as typeof fetch;

  return { fetchImpl, urls };
}

afterEach(async () => {
  for (const disposable of disposables.splice(0)) {
    await disposable.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('weather plugin', () => {
  it('installs, configures, enables and returns current weather with cache', async () => {
    const { fetchImpl, urls } = createWeatherFetch();
    const { registry } = createHarness(fetchImpl);
    await registry.initialize();

    const available = registry.get('weather');
    expect(available).toEqual(expect.objectContaining({
      installed: false,
      manifest: expect.objectContaining({ id: 'weather', kind: 'tool' }),
    }));

    await registry.install('weather');
    await registry.updateConfig('weather', { city: '杭州', refreshMinutes: 15 });
    const enabled = await registry.enable('weather');
    expect(enabled.enabled).toBe(true);
    expect(enabled.health.status).toBe('ok');

    const first = await registry.invoke('weather', 'current', {}) as {
      location: { name: string };
      current: { temperatureC: number; weather: string };
      cached: boolean;
    };

    expect(first.location.name).toBe('杭州');
    expect(first.current.temperatureC).toBe(22.3);
    expect(first.current.weather).toBe('小雨');
    expect(first.cached).toBe(false);

    const second = await registry.invoke('weather', 'current', {}) as { cached: boolean };
    expect(second.cached).toBe(true);

    expect(urls.filter(url => url.startsWith('https://api.open-meteo.com/'))).toHaveLength(1);
    expect(urls.filter(url => url.startsWith('https://geocoding-api.open-meteo.com/'))).toHaveLength(1);
  });

  it('reports degraded health until configured and rejects an unconfigured invoke', async () => {
    const { registry } = createHarness((async () => jsonResponse({})) as typeof fetch);
    await registry.initialize();
    await registry.install('weather');
    const enabled = await registry.enable('weather');

    expect(enabled.health.status).toBe('degraded');
    await expect(registry.invoke('weather', 'current', {})).rejects.toMatchObject({
      code: 'plugin_failed',
    });
  });

  it('marks failed health when the provider fails', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://geocoding-api.open-meteo.com/')) {
        return jsonResponse({
          results: [{ name: '杭州', latitude: 30.2741, longitude: 120.1551 }],
        });
      }

      return jsonResponse({ error: 'upstream' }, 503);
    }) as typeof fetch;

    const { registry } = createHarness(fetchImpl);
    await registry.initialize();
    await registry.install('weather');
    await registry.updateConfig('weather', { city: '杭州' });
    await registry.enable('weather');

    await expect(registry.invoke('weather', 'current', {})).rejects.toMatchObject({
      code: 'plugin_failed',
    });
    expect(registry.get('weather')?.health.status).toBe('failed');
  });
});
