import type {
  BilibiliApiResponse,
  BilibiliClientOptions,
  BilibiliConclusion,
  BilibiliPage,
  BilibiliPlayerData,
  BilibiliRcmdData,
  BilibiliRequestOptions,
  BilibiliSearchVideo,
  BilibiliSubtitleResult,
  BilibiliVideo,
  WbiKeys,
} from './types.js';
import { extractWbiKey, mixinKey, signWbiParams } from './wbi.js';

const API_BASE = 'https://api.bilibili.com';
const NAV_PATH = '/x/web-interface/nav';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class BilibiliApiError extends Error {
  readonly code: number;
  readonly status: number;

  constructor(code: number, message: string, status = 200) {
    super(message);
    this.name = 'BilibiliApiError';
    this.code = code;
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class BilibiliClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cookie?: string;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly getNowSeconds: () => number;
  private keys: WbiKeys | null = null;
  private keysExpireAt = 0;
  private lastRequestAt = 0;

  constructor(options: BilibiliClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cookie = options.cookie;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.getNowSeconds = options.getNowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  private async waitForSlot() {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;

    if (wait > 0) {
      await sleep(wait);
    }

    this.lastRequestAt = Date.now();
  }

  private headers(): Record<string, string> {
    return {
      'user-agent': this.userAgent,
      referer: 'https://www.bilibili.com/',
      accept: 'application/json, text/plain, */*',
      ...(this.cookie ? { cookie: this.cookie } : {}),
    };
  }

  private async getParsed<T>(url: string, signal?: AbortSignal): Promise<BilibiliApiResponse<T>> {
    await this.waitForSlot();
    const response = await this.fetchImpl(url, {
      headers: this.headers(),
      signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new BilibiliApiError(response.status, text.slice(0, 300) || `HTTP ${response.status}`, response.status);
    }

    try {
      return JSON.parse(text) as BilibiliApiResponse<T>;
    } catch {
      throw new BilibiliApiError(-1, `non-JSON response: ${text.slice(0, 200)}`, response.status);
    }
  }

  private async getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const parsed = await this.getParsed<T>(url, signal);

    if (parsed.code !== 0) {
      throw new BilibiliApiError(parsed.code, parsed.message ?? 'bilibili api error');
    }

    return parsed.data;
  }

  async loadWbiKeys(): Promise<WbiKeys> {
    if (this.keys && Date.now() < this.keysExpireAt) {
      return this.keys;
    }

    // Unauthenticated /nav returns code -101 but still carries wbi_img. Do not
    // reject it here; only reject a response without usable keys.
    const parsed = await this.getParsed<{
      wbi_img?: { img_url?: string; sub_url?: string };
    }>(`${API_BASE}${NAV_PATH}`);
    const data = parsed.data;
    const imgKey = extractWbiKey(data?.wbi_img?.img_url);
    const subKey = extractWbiKey(data?.wbi_img?.sub_url);

    if (!imgKey || !subKey) {
      throw new BilibiliApiError(-1, 'nav response did not contain wbi keys');
    }

    this.keys = { imgKey, subKey };
    this.keysExpireAt = Date.now() + 10 * 60 * 1000;
    return this.keys;
  }

  async signedGet<T>(path: string, options: BilibiliRequestOptions = {}): Promise<T> {
    const keys = await this.loadWbiKeys();
    const key = mixinKey(keys.imgKey, keys.subKey);
    const signed = signWbiParams(options.params ?? {}, key, this.getNowSeconds());
    const separator = path.includes('?') ? '&' : '?';
    return this.getJson<T>(`${API_BASE}${path}${separator}${signed.query}`, options.signal);
  }

  searchVideos(
    keyword: string,
    limit = 10,
    order: 'totalrank' | 'click' | 'pubdate' | 'dm' = 'totalrank',
    signal?: AbortSignal,
  ): Promise<BilibiliSearchVideo[]> {
    return this.signedGet<{ result?: BilibiliSearchVideo[] }>('/x/web-interface/wbi/search/type', {
      params: {
        search_type: 'video',
        keyword,
        page: 1,
        page_size: limit,
        order,
      },
      signal,
    }).then(data => (data.result ?? []).map(item => ({
      ...item,
      title: item.title?.replace(/<[^>]+>/g, '') ?? '',
    })));
  }

  getPages(bvid: string, signal?: AbortSignal): Promise<BilibiliPage[]> {
    return this.signedGet<BilibiliPage[]>('/x/player/pagelist', {
      params: { bvid },
      signal,
    });
  }

  private async getSubtitleJson(url: string, signal?: AbortSignal): Promise<{
    body?: Array<{ content?: string }>;
  }> {
    await this.waitForSlot();
    const response = await this.fetchImpl(url, {
      headers: this.headers(),
      signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new BilibiliApiError(response.status, text.slice(0, 300) || `HTTP ${response.status}`, response.status);
    }

    return JSON.parse(text) as { body?: Array<{ content?: string }> };
  }

  async getSubtitleText(bvid: string, signal?: AbortSignal): Promise<BilibiliSubtitleResult> {
    const pages = await this.getPages(bvid, signal);
    const cid = pages[0]?.cid;

    if (!cid) {
      return {
        bvid,
        language: '',
        segments: 0,
        text: '',
        empty: true,
        reason: '无法获取 cid',
      };
    }

    const player = await this.getPlayerInfo(bvid, cid, signal);
    const subtitles = player.subtitle?.list ?? [];

    if (subtitles.length === 0) {
      return {
        bvid,
        language: '',
        segments: 0,
        text: '',
        empty: true,
        reason: '该视频没有字幕',
      };
    }

    const target = subtitles.find(item => ['ai-zh', 'zh-CN', 'zh'].includes(item.lan ?? ''))
      ?? subtitles[0];
    const rawUrl = target.subtitle_url;

    if (!rawUrl) {
      return {
        bvid,
        language: target.lan_doc ?? '',
        segments: 0,
        text: '',
        empty: true,
        reason: '字幕地址为空',
      };
    }

    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const data = await this.getSubtitleJson(url, signal);
    const lines = (data.body ?? [])
      .map(item => item.content?.trim() ?? '')
      .filter(Boolean);
    const meaningful = lines.filter(line => !/^字幕\s*(by|：|:|制作|提供|校对|君)/i.test(line));

    if (meaningful.length === 0) {
      return {
        bvid,
        language: target.lan_doc ?? '',
        segments: 0,
        text: '',
        empty: true,
        reason: lines.length ? '字幕只有署名，没有正文' : '字幕内容为空',
      };
    }

    return {
      bvid,
      language: target.lan_doc ?? target.lan ?? '',
      segments: meaningful.length,
      text: meaningful.join('\n'),
      empty: false,
    };
  }

  getView(bvid: string, signal?: AbortSignal): Promise<BilibiliVideo> {
    return this.signedGet<BilibiliVideo>('/x/web-interface/view', {
      params: { bvid },
      signal,
    });
  }

  getRcmd(options: { ps?: number; freshIdx?: number; signal?: AbortSignal } = {}): Promise<BilibiliRcmdData> {
    const freshIdx = options.freshIdx ?? 1;
    return this.signedGet<BilibiliRcmdData>('/x/web-interface/wbi/index/top/feed/rcmd', {
      params: {
        web_location: 1430650,
        y_num: 4,
        fresh_type: 3,
        feed_version: 'V8',
        fresh_idx: freshIdx,
        fresh_idx_1h: freshIdx,
        fetch_row: 1,
        brush: 0,
        homepage_ver: 1,
        ps: options.ps ?? 20,
      },
      signal: options.signal,
    });
  }

  getConclusion(
    bvid: string,
    cid: number,
    upMid?: number,
    signal?: AbortSignal,
  ): Promise<BilibiliConclusion> {
    return this.signedGet<BilibiliConclusion>('/x/web-interface/view/conclusion/get', {
      params: { bvid, cid, up_mid: upMid },
      signal,
    });
  }

  getPlayerInfo(bvid: string, cid: number, signal?: AbortSignal): Promise<BilibiliPlayerData> {
    return this.signedGet<BilibiliPlayerData>('/x/player/wbi/v2', {
      params: { bvid, cid },
      signal,
    });
  }
}
