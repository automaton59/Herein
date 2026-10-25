import { describe, expect, it, vi } from 'vitest';
import { CoreClient, CoreHttpError } from './coreClient';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('coreClient', () => {
  it('lists messages with token auth', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8787/v1/timeline/char-1/messages?limit=20');
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer token-1',
      }));
      return jsonResponse({
        timeline: { id: 'timeline-1', characterId: 'char-1', title: '聊天' },
        messages: [{
          id: 'msg-1',
          timelineId: 'timeline-1',
          role: 'user',
          content: '在吗',
          timestamp: '2026-10-21T12:00:00.000Z',
        }],
      });
    }) as typeof fetch;

    const client = new CoreClient({
      baseUrl: 'http://127.0.0.1:8787/',
      token: 'token-1',
      fetchImpl,
    });

    const result = await client.listMessages('char-1', 20);
    expect(result.messages[0].content).toBe('在吗');
  });

  it('sends chat and returns the assistant message', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8787/v1/chat');
      const body = JSON.parse(String(init?.body)) as {
        characterId: string;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.characterId).toBe('char-1');
      expect(body.messages).toEqual([{ role: 'user', content: '在吗' }]);
      return jsonResponse({
        message: { role: 'assistant', content: '在。' },
        model: 'test-model',
        latencyMs: 12,
        persisted: true,
        timelineId: 'timeline-1',
      });
    }) as typeof fetch;

    const client = new CoreClient({ baseUrl: 'http://127.0.0.1:8787', fetchImpl });
    const result = await client.chat('char-1', [{ role: 'user', content: '在吗' }]);
    expect(result.message?.content).toBe('在。');
  });

  it('throws a typed error on non-2xx', async () => {
    const fetchImpl = (async () => new Response('no', { status: 503 })) as typeof fetch;
    const client = new CoreClient({ baseUrl: 'http://127.0.0.1:8787', fetchImpl });

    await expect(client.health()).rejects.toMatchObject({
      name: 'CoreHttpError',
      status: 503,
    } satisfies Partial<CoreHttpError>);
  });

  it('calls the platform fetch with the global receiver', async () => {
    const platformFetch = function (this: unknown, input: RequestInfo | URL) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }

      expect(String(input)).toBe('http://127.0.0.1:8787/health');
      return Promise.resolve(jsonResponse({ ok: true, version: '1.0.0' }));
    } as typeof fetch;

    vi.stubGlobal('fetch', platformFetch);

    try {
      const client = new CoreClient({ baseUrl: 'http://127.0.0.1:8787' });
      await expect(client.health()).resolves.toEqual({ ok: true, version: '1.0.0' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
