import { describe, expect, it, vi } from 'vitest';
import { BilibiliApiError, BilibiliClient } from './client';

const IMG = '7cd084941338484aae1ad9425b84077c';
const SUB = '4932caff0ff746eab6f01bf08b70ac45';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('bilibili client', () => {
  it('loads WBI keys from unauthenticated nav and signs view requests', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/x/web-interface/nav')) {
        return jsonResponse({
          code: -101,
          message: '账号未登录',
          data: {
            wbi_img: {
              img_url: `https://i0.hdslb.com/bfs/wbi/${IMG}.png`,
              sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB}.png`,
            },
          },
        });
      }

      if (url.includes('/x/web-interface/view')) {
        expect(url).toContain('w_rid=');
        expect(url).toContain('wts=1700000000');
        return jsonResponse({
          code: 0,
          data: {
            bvid: 'BV1xx411c7mD',
            aid: 1,
            cid: 2,
            title: '测试视频',
            owner: { mid: 3, name: 'UP' },
            stat: { view: 10 },
          },
        });
      }

      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new BilibiliClient({
      fetchImpl,
      minIntervalMs: 0,
      getNowSeconds: () => 1700000000,
    });

    const video = await client.getView('BV1xx411c7mD');
    expect(video.title).toBe('测试视频');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('searches videos and cleans highlighted titles', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/nav')) {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url: `https://i0.hdslb.com/bfs/wbi/${IMG}.png`,
              sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB}.png`,
            },
          },
        });
      }
      expect(url).toContain('/x/web-interface/wbi/search/type');
      expect(url).toContain('keyword=AI');
      return jsonResponse({
        code: 0,
        data: {
          result: [{ bvid: 'BV1xx411c7mD', title: '<em class="keyword">AI</em> 教程', author: 'UP' }],
        },
      });
    }) as typeof fetch;

    const client = new BilibiliClient({ fetchImpl, minIntervalMs: 0, getNowSeconds: () => 1 });
    const videos = await client.searchVideos('AI', 5);
    expect(videos[0]).toEqual(expect.objectContaining({ bvid: 'BV1xx411c7mD', title: 'AI 教程' }));
  });

  it('reads subtitle text and skips credit-only lines', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/nav')) {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url: `https://i0.hdslb.com/bfs/wbi/${IMG}.png`,
              sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB}.png`,
            },
          },
        });
      }
      if (url.includes('/x/player/pagelist')) {
        return jsonResponse({ code: 0, data: [{ cid: 2, page: 1, part: 'P1', duration: 10 }] });
      }
      if (url.includes('/x/player/wbi/v2')) {
        return jsonResponse({
          code: 0,
          data: {
            subtitle: {
              list: [{ lan: 'ai-zh', lan_doc: '中文（AI）', subtitle_url: '//sub.test/a.json' }],
            },
          },
        });
      }
      if (url === 'https://sub.test/a.json') {
        return jsonResponse({
          body: [{ content: '第一句' }, { content: '字幕by 某人' }, { content: '第二句' }],
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new BilibiliClient({ fetchImpl, minIntervalMs: 0, getNowSeconds: () => 1 });
    const subtitle = await client.getSubtitleText('BV1xx411c7mD');
    expect(subtitle).toEqual(expect.objectContaining({
      empty: false,
      segments: 2,
      text: '第一句\n第二句',
    }));
  });

  it('throws a typed api error on non-zero code', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/nav')) {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url: `https://i0.hdslb.com/bfs/wbi/${IMG}.png`,
              sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB}.png`,
            },
          },
        });
      }

      return jsonResponse({ code: -352, message: '风控校验失败' });
    }) as typeof fetch;

    const client = new BilibiliClient({ fetchImpl, minIntervalMs: 0, getNowSeconds: () => 1 });
    await expect(client.getView('BV1xx411c7mD')).rejects.toMatchObject({
      name: 'BilibiliApiError',
      code: -352,
    } satisfies Partial<BilibiliApiError>);
  });
});
