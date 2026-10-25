import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmFetch } from './http';

const config = {
  provider: 'deepseek' as const,
  apiKey: 'test-key',
  model: 'deepseek-chat',
  baseURL: 'https://api.example.com',
};

function setLocation(url: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: new URL(url),
  });
}

afterEach(() => {
  delete (window as { hereinCore?: unknown }).hereinCore;
  setLocation('http://127.0.0.1:5173/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('llmFetch transport', () => {
  it('routes provider calls through the embedded core so the renderer CSP is satisfied', async () => {
    (window as { hereinCore?: unknown }).hereinCore = {
      url: 'http://127.0.0.1:4321',
      token: 'core-token',
    };

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await llmFetch(config, '/chat/completions', { method: 'POST', body: { ping: true } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('http://127.0.0.1:4321/v1/llm-proxy');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer core-token');

    const payload = JSON.parse(String(init.body)) as {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: unknown;
    };

    expect(payload.url).toBe('https://api.example.com/chat/completions');
    expect(payload.method).toBe('POST');
    expect(payload.headers.Authorization).toBe('Bearer test-key');
    expect(payload.body).toEqual({ ping: true });
  });

  it('uses the dev proxy when served from localhost without a core bridge', async () => {
    setLocation('http://127.0.0.1:5173/');

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await llmFetch(config, '/models');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm-proxy');
  });

  it('falls back to a direct request when the core cannot be reached', async () => {
    setLocation('file:///D:/Herein/dist/index.html');
    (window as { hereinCore?: unknown }).hereinCore = {
      url: 'http://127.0.0.1:4321',
      token: 'core-token',
    };

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await llmFetch(config, '/models');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/models');
  });
});
