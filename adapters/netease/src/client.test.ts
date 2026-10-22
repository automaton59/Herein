import { describe, expect, it, vi } from 'vitest';
import { NeteaseApiError, NeteaseClient } from './client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('netease client', () => {
  it('searches songs anonymously with the music.163 referer', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain('/api/search/get');
      expect(url).toContain('s=%E5%91%A8%E6%9D%B0%E4%BC%A6');
      expect(url).toContain('type=1');
      expect(init?.headers).toEqual(expect.objectContaining({
        referer: 'https://music.163.com/',
      }));
      return jsonResponse({
        code: 200,
        result: {
          songCount: 1,
          songs: [{ id: 1, name: '测试歌曲', ar: [{ id: 2, name: '歌手' }] }],
        },
      });
    }) as typeof fetch;

    const client = new NeteaseClient({ fetchImpl, minIntervalMs: 0 });
    const result = await client.search('周杰伦', 10);
    expect(result.songCount).toBe(1);
    expect(result.songs?.[0].name).toBe('测试歌曲');
  });

  it('returns lyrics text', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 200,
      lrc: { lyric: '[00:00.00]测试歌词' },
    })) as typeof fetch;

    const client = new NeteaseClient({ fetchImpl, minIntervalMs: 0 });
    const lyrics = await client.lyrics(1);
    expect(lyrics.lrc?.lyric).toContain('测试歌词');
  });

  it('throws a typed error on non-success code', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 460,
      message: 'Cheating',
    })) as typeof fetch;

    const client = new NeteaseClient({ fetchImpl, minIntervalMs: 0 });
    await expect(client.toplists()).rejects.toMatchObject({
      name: 'NeteaseApiError',
      code: 460,
    } satisfies Partial<NeteaseApiError>);
  });
});
