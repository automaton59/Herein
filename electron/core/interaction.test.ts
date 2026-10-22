/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AInteractionPort,
  HttpInteractionPort,
  InteractionDispatcher,
  type InteractionPort,
} from './interaction';

describe('InteractionDispatcher', () => {
  it('returns a soft failure when no port is configured', async () => {
    const dispatcher = new InteractionDispatcher();
    expect(dispatcher.available()).toBe(false);
    await expect(dispatcher.speak({ text: '在吗' })).resolves.toEqual({
      ok: false,
      error: 'interaction port is not configured',
    });
  });

  it('forwards speak and catches port failures', async () => {
    const port: InteractionPort = {
      speak: vi.fn().mockResolvedValue({ ok: true, latencyMs: 12 }),
    };
    const dispatcher = new InteractionDispatcher(port);
    expect(dispatcher.available()).toBe(true);
    await expect(dispatcher.speak({ text: '在吗' })).resolves.toEqual({
      ok: true,
      latencyMs: 12,
    });

    const failing = new InteractionDispatcher({
      speak: vi.fn().mockRejectedValue(new Error('audio device busy')),
    });
    await expect(failing.speak({ text: '在吗' })).resolves.toEqual({
      ok: false,
      error: 'audio device busy',
    });
  });
});

describe('HttpInteractionPort', () => {  it('posts speak payloads with auth and reads health', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      expect(url).toBe('http://interaction.test/speak');
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer token-1',
      }));
      const body = JSON.parse(String(init?.body)) as { text: string };
      expect(body.text).toBe('在吗');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const port = new HttpInteractionPort({
      url: 'http://interaction.test/',
      token: 'token-1',
      fetchImpl,
    });

    await expect(port.speak({ text: '在吗' })).resolves.toEqual(expect.objectContaining({
      ok: true,
    }));
    await expect(port.health()).resolves.toEqual(expect.objectContaining({
      status: 'ok',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('AInteractionPort', () => {
  it('reads A endpoint.local.json and maps speech/health/cancel', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'herein-a-port-'));
    const endpointFile = path.join(dir, 'endpoint.local.json');
    await writeFile(endpointFile, JSON.stringify({
      url: 'http://a-runtime.test',
      token: 'a-token',
      apiVersion: 1,
    }), 'utf8');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer a-token',
      }));

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ready: true,
          asr: true,
          tts: true,
        }), { status: 200 });
      }

      if (url.endsWith('/v1/speech')) {
        const body = JSON.parse(String(init?.body)) as {
          text: string;
          emotion: string;
          instruct: string;
        };
        expect(body).toEqual(expect.objectContaining({
          text: '在吗',
          emotion: 'neutral',
          instruct: 'soft',
        }));
        return new Response(JSON.stringify({ generation: 3 }), { status: 200 });
      }

      if (url.endsWith('/v1/cancel')) {
        return new Response('{}', { status: 200 });
      }

      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const port = new AInteractionPort({ endpointFile, fetchImpl });

    try {
      await expect(port.speak({
        text: '在吗',
        voiceInstruct: 'soft',
      })).resolves.toEqual(expect.objectContaining({ ok: true }));
      await expect(port.health()).resolves.toEqual(expect.objectContaining({
        status: 'ok',
      }));
      await expect(port.stop()).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports degraded when A TTS is not ready', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'herein-a-port-'));
    const endpointFile = path.join(dir, 'endpoint.local.json');
    await writeFile(endpointFile, JSON.stringify({
      url: 'http://a-runtime.test',
      token: 'a-token',
    }), 'utf8');

    const port = new AInteractionPort({
      endpointFile,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        ready: true,
        asr: true,
        tts: false,
      }), { status: 200 })) as typeof fetch,
    });

    try {
      await expect(port.health()).resolves.toEqual(expect.objectContaining({
        status: 'degraded',
        message: expect.stringContaining('tts'),
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
