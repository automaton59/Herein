import type {
  BilibiliApiResponse,
  BilibiliClientOptions,
  BilibiliConclusion,
  BilibiliMyInfo,
  BilibiliPage,
  BilibiliPlayerData,
  BilibiliPostReplyResult,
  BilibiliReply,
  BilibiliReplyPage,
  BilibiliRequestOptions,
  BilibiliRcmdData,
  BilibiliSearchVideo,
  BilibiliSubtitleResult,
  BilibiliVideo,
  WbiKeys,
} from './types.js';
import { extractWbiKey, mixinKey, signWbiParams } from './wbi.js';

const API_BASE = 'https://api.bilibili.com';
const NAV_PATH = '/x/web-interface/nav';
const REPLY_PATH = '/x/v2/reply';
const REPLY_ADD_PATH = '/x/v2/reply/add';
const REPLY_REPLIES_PATH = '/x/v2/reply/reply';
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

function readCookie(raw: string | undefined, name: string): string | null {
  if (!raw) {
    return null;
  }

  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  const value = match?.[1]?.trim();
  return value ? value : null;
}

export class BilibiliClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cookie?: string;
  private readonly csrf: string | null;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly getNowSeconds: () => number;
  private keys: WbiKeys | null = null;
  private keysExpireAt = 0;
  private lastRequestAt = 0;

  constructor(options: BilibiliClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cookie = options.cookie;
    this.csrf = readCookie(options.cookie, 'bili_jct');
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.getNowSeconds = options.getNowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  /** True when the client carries SESSDATA + bili_jct and can therefore write. */
  get canWrite(): boolean {
    return Boolean(readCookie(this.cookie, 'SESSDATA') && this.csrf);
  }

  private assertWritable() {
    if (!this.canWrite) {
      throw new BilibiliApiError(
        -101,
        '未登录：发送评论需要 bilibili.json 里的 SESSDATA 和 bili_jct（bili_jct 即 csrf）',
      );
    }
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

  private async getParsed<T>(url: string, options: BilibiliRequestOptions = {}): Promise<BilibiliApiResponse<T>> {
    await this.waitForSlot();
    const headers: Record<string, string> = {
      ...this.headers(),
      ...(options.referer ? { referer: options.referer } : {}),
    };
    let body: string | undefined;

    if (options.data) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(options.data)) {
        if (value === undefined || value === null) {
          continue;
        }

        form.set(key, String(value));
      }

      body = form.toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
      headers['origin'] = 'https://www.bilibili.com';
    }

    const response = await this.fetchImpl(url, {
      method: options.data ? 'POST' : 'GET',
      headers,
      body,
      signal: options.signal,
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

  private async getJson<T>(url: string, options: BilibiliRequestOptions = {}): Promise<T> {
    // Non-WBI endpoints pass plain params here; WBI endpoints embed the signed
    // query into the URL before calling this.
    const entries = Object.entries(options.params ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)] as [string, string]);
    const target = entries.length
      ? `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(entries).toString()}`
      : url;
    const parsed = await this.getParsed<T>(target, options);

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
    return this.getJson<T>(`${API_BASE}${path}${separator}${signed.query}`, {
      signal: options.signal,
    });
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

  /**
   * Login status from the same `nav` endpoint WBI keys come from. Anonymous
   * callers get `{ isLogin: false }` instead of an error (nav returns -101
   * with a usable body when not logged in).
   */
  async getMyInfo(signal?: AbortSignal): Promise<BilibiliMyInfo> {
    const parsed = await this.getParsed<{
      isLogin?: boolean;
      mid?: number;
      uname?: string;
      level_info?: { current_level?: number };
      coins?: number;
      vipStatus?: number;
    }>(`${API_BASE}${NAV_PATH}`, { signal });
    const data = parsed.data ?? {};

    return {
      isLogin: Boolean(data.isLogin) && parsed.code === 0,
      mid: data.mid,
      uname: data.uname,
      level: data.level_info?.current_level,
      coins: data.coins,
      vipStatus: data.vipStatus,
    };
  }

  private async resolveOid(target: { oid?: number; bvid?: string }): Promise<number> {
    if (typeof target.oid === 'number' && Number.isFinite(target.oid)) {
      return target.oid;
    }

    if (target.bvid) {
      const view = await this.getView(target.bvid);
      return view.aid;
    }

    throw new BilibiliApiError(-1, '需要 oid（视频 aid）或 bvid 才能定位评论区');
  }

  /**
   * Read a comment section. Works anonymously; `sort`: 0 按时间, 1 按点赞,
   * 2 按热度（默认按热度）.
   */
  async getReplies(
    target: { oid?: number; bvid?: string },
    options: { pn?: number; ps?: number; sort?: number; signal?: AbortSignal } = {},
  ): Promise<BilibiliReplyPage> {
    const oid = await this.resolveOid(target);
    const data = await this.getJson<{
      page?: BilibiliReplyPage['page'];
      replies?: BilibiliReply[];
      cursor?: BilibiliReplyPage['cursor'];
    }>(`${API_BASE}${REPLY_PATH}`, {
      params: {
        type: 1,
        oid,
        pn: options.pn ?? 1,
        ps: options.ps ?? 20,
        sort: options.sort ?? 2,
      },
      signal: options.signal,
    });

    return {
      oid,
      type: 1,
      page: data.page,
      replies: data.replies ?? [],
      cursor: data.cursor ?? null,
    };
  }

  /** Read the nested replies (楼中楼) under one root comment. */
  async getReplyReplies(
    target: { oid?: number; bvid?: string },
    rootRpid: number,
    options: { pn?: number; ps?: number; signal?: AbortSignal } = {},
  ): Promise<{ oid: number; root: number; page?: BilibiliReplyPage['page']; replies: BilibiliReply[] }> {
    const oid = await this.resolveOid(target);
    const data = await this.getJson<{
      page?: BilibiliReplyPage['page'];
      replies?: BilibiliReply[];
      root?: { rpid?: number };
    }>(`${API_BASE}${REPLY_REPLIES_PATH}`, {
      params: {
        type: 1,
        oid,
        root: rootRpid,
        pn: options.pn ?? 1,
        ps: options.ps ?? 20,
      },
      signal: options.signal,
    });

    return {
      oid,
      root: data.root?.rpid ?? rootRpid,
      page: data.page,
      replies: data.replies ?? [],
    };
  }

  /**
   * Post a top-level comment (`rootRpid` omitted) or a nested reply. Requires
   * SESSDATA + bili_jct in the configured cookie; refuses to hit the network
   * otherwise. Callers own the content and pacing: the client only enforces
   * its generic request interval, it does not rate-limit by content.
   */
  async postReply(
    target: { oid?: number; bvid?: string },
    message: string,
    options: { rootRpid?: number; parentRpid?: number; signal?: AbortSignal } = {},
  ): Promise<BilibiliPostReplyResult> {
    this.assertWritable();
    const text = message.trim();

    if (!text) {
      throw new BilibiliApiError(-1, '评论内容不能为空');
    }

    if (text.length > 1000) {
      throw new BilibiliApiError(-1, '评论内容超过长度限制（1000 字符）');
    }

    const oid = await this.resolveOid(target);
    const data = await this.getJson<{ rpid?: number; root?: number; parent?: number }>(
      `${API_BASE}${REPLY_ADD_PATH}`,
      {
        data: {
          oid,
          type: 1,
          plat: 1,
          message: text,
          csrf: this.csrf,
          web_location: 1315875,
          ...(options.rootRpid ? { root: options.rootRpid } : {}),
          ...(options.parentRpid ?? options.rootRpid
            ? { parent: options.parentRpid ?? options.rootRpid }
            : {}),
        },
        referer: target.bvid
          ? `https://www.bilibili.com/video/${target.bvid}/`
          : 'https://www.bilibili.com/',
        signal: options.signal,
      },
    );

    if (!data.rpid) {
      throw new BilibiliApiError(-1, '评论提交成功但响应缺少 rpid');
    }

    return {
      rpid: data.rpid,
      oid,
      type: 1,
      ...(options.rootRpid ? { root: options.rootRpid } : {}),
      ...(options.parentRpid || options.rootRpid
        ? { parent: options.parentRpid ?? options.rootRpid }
        : {}),
    };
  }
}
