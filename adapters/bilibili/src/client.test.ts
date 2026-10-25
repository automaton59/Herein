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

  it('reads replies anonymously without wbi keys', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/x/v2/reply?');
      expect(url).toContain('type=1');
      expect(url).toContain('oid=2');
      return jsonResponse({
        code: 0,
        data: {
          page: { num: 1, size: 20, count: 42, acount: 50 },
          replies: [{
            rpid: 101,
            oid: 2,
            type: 1,
            like: 7,
            rcount: 2,
            content: { message: '前排' },
            member: { mid: '33', uname: '路人甲' },
            replies: [{ rpid: 102, content: { message: '+1' }, member: { mid: '34', uname: '路人乙' } }],
          }],
        },
      });
    }) as typeof fetch;

    const client = new BilibiliClient({ fetchImpl, minIntervalMs: 0, getNowSeconds: () => 1 });
    const page = await client.getReplies({ oid: 2 }, { pn: 1, ps: 20 });
    expect(page.replies).toHaveLength(1);
    expect(page.replies[0]).toEqual(expect.objectContaining({
      rpid: 101,
      like: 7,
      rcount: 2,
    }));
    expect(page.replies[0].content?.message).toBe('前排');
    expect(page.replies[0].replies).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses to post a comment without credentials before any request', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new BilibiliClient({ fetchImpl, minIntervalMs: 0 });

    await expect(client.postReply({ bvid: 'BV1xx411c7mD' }, '你好')).rejects.toMatchObject({
      name: 'BilibiliApiError',
      code: -101,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts a nested reply with csrf, urlencoded body and video referer', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/x/web-interface/nav')) {
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

      if (url.includes('/x/web-interface/view')) {
        return jsonResponse({
          code: 0,
          data: { bvid: 'BV1xx411c7mD', aid: 2, cid: 3, title: '测试视频' },
        });
      }

      expect(url).toBe('https://api.bilibili.com/x/v2/reply/add');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(headers['origin']).toBe('https://www.bilibili.com');
      expect(headers.referer).toBe('https://www.bilibili.com/video/BV1xx411c7mD/');
      expect(headers.cookie).toContain('SESSDATA=abc');
      expect(String(init?.body)).toContain('oid=2');
      expect(String(init?.body)).toContain('type=1');
      expect(String(init?.body)).toContain('root=55');
      expect(String(init?.body)).toContain('parent=55');
      expect(String(init?.body)).toContain('csrf=jct-token');
      expect(String(init?.body)).toContain('message=');
      return jsonResponse({
        code: 0,
        data: { rpid: 9001, oid: 2, root: 55, parent: 55 },
      });
    }) as typeof fetch;

    const client = new BilibiliClient({
      fetchImpl,
      minIntervalMs: 0,
      getNowSeconds: () => 1,
      cookie: 'SESSDATA=abc; bili_jct=jct-token; DedeUserID=42',
    });
    expect(client.canWrite).toBe(true);

    const result = await client.postReply({ bvid: 'BV1xx411c7mD' }, '来晚了', { rootRpid: 55 });
    expect(result).toEqual(expect.objectContaining({ rpid: 9001, root: 55, parent: 55 }));
  });

  it('reports login status from nav for anonymous and logged-in cookies', async () => {
    const anonymous = vi.fn(async () => jsonResponse({
      code: -101,
      message: '账号未登录',
      data: { isLogin: false, wbi_img: {} },
    })) as unknown as typeof fetch;
    const anonClient = new BilibiliClient({ fetchImpl: anonymous, minIntervalMs: 0 });
    expect(await anonClient.getMyInfo()).toEqual(expect.objectContaining({ isLogin: false }));

    const loggedIn = vi.fn(async () => jsonResponse({
      code: 0,
      data: {
        isLogin: true,
        mid: 42,
        uname: '此间的主人',
        level_info: { current_level: 6 },
        coins: 12.5,
      },
    })) as unknown as typeof fetch;
    const loggedClient = new BilibiliClient({ fetchImpl: loggedIn, minIntervalMs: 0 });
    expect(await loggedClient.getMyInfo()).toEqual(expect.objectContaining({
      isLogin: true,
      mid: 42,
      uname: '此间的主人',
      level: 6,
    }));
  });
});
