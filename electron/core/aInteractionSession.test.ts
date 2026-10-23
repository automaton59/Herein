/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AInteractionSession, parseAInteractionBlock } from './aInteractionSession';

describe('parseAInteractionBlock', () => {
  it('parses transcript and ignores ready blocks', () => {
    expect(parseAInteractionBlock('data: {"type":"transcript","text":"你好","final":true,"turnId":"t1"}'))
      .toEqual({
        type: 'transcript',
        text: '你好',
        final: true,
        turnId: 't1',
      });
    expect(parseAInteractionBlock('event: ready\ndata: {}')).toBeNull();
    expect(parseAInteractionBlock('data: not-json')).toBeNull();
  });
});

describe('AInteractionSession', () => {
  it('connects to A SSE and dispatches events', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'herein-a-session-'));
    const endpointFile = path.join(dir, 'endpoint.local.json');
    await writeFile(endpointFile, JSON.stringify({
      url: 'http://a-runtime.test',
      token: 'a-token',
    }), 'utf8');

    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer a-token',
      }));
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"transcript","text":"你好","final":true,"turnId":"turn-1"}\n\n'));
          controller.close();
        },
      }), { status: 200 });
    }) as typeof fetch;
    const events: unknown[] = [];
    const session = new AInteractionSession({
      endpointFile,
      fetchImpl,
      reconnectMs: 10,
      onEvent: event => {
        events.push(event);
      },
    });

    try {
      session.start();
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 3000 });
      await session.stop();
      expect(events[0]).toEqual(expect.objectContaining({
        type: 'transcript',
        text: '你好',
        turnId: 'turn-1',
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
