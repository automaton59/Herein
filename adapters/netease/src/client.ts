import type {
  NeteaseClientOptions,
  NeteaseLyrics,
  NeteasePlaylist,
  NeteaseSearchResult,
  NeteaseSong,
  NeteaseToplist,
} from './types.js';

const API_BASE = 'https://music.163.com';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class NeteaseApiError extends Error {
  readonly code: number;
  readonly status: number;

  constructor(code: number, message: string, status = 200) {
    super(message);
    this.name = 'NeteaseApiError';
    this.code = code;
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class NeteaseClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cookie?: string;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(options: NeteaseClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cookie = options.cookie;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
  }

  private async waitForSlot() {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();

    if (wait > 0) {
      await sleep(wait);
    }

    this.lastRequestAt = Date.now();
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    await this.waitForSlot();
    const query = new URLSearchParams();

    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        query.set(name, String(value));
      }
    }

    const queryString = query.toString();
    const url = `${API_BASE}${path}${queryString ? `?${queryString}` : ''}`;
    const response = await this.fetchImpl(url, {
      headers: {
        'user-agent': this.userAgent,
        referer: 'https://music.163.com/',
        accept: 'application/json, text/plain, */*',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
    });
    const text = await response.text();

    if (!response.ok) {
      throw new NeteaseApiError(response.status, text.slice(0, 300) || `HTTP ${response.status}`, response.status);
    }

    let parsed: { code?: number; message?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as { code?: number; message?: string } & Record<string, unknown>;
    } catch {
      throw new NeteaseApiError(-1, `non-JSON response: ${text.slice(0, 200)}`, response.status);
    }

    if (typeof parsed.code === 'number' && parsed.code !== 200 && parsed.code !== 0) {
      throw new NeteaseApiError(parsed.code, parsed.message ?? 'netease api error', response.status);
    }

    return parsed as unknown as T;
  }

  async search(keyword: string, limit = 20, offset = 0): Promise<NeteaseSearchResult> {
    const parsed = await this.request<{ result?: NeteaseSearchResult }>('/api/search/get', {
      s: keyword,
      type: 1,
      limit,
      offset,
    });
    return parsed.result ?? {};
  }

  async songDetail(ids: number[]): Promise<NeteaseSong[]> {
    const parsed = await this.request<{ songs?: NeteaseSong[] }>('/api/song/detail', {
      ids: JSON.stringify(ids),
    });
    return parsed.songs ?? [];
  }

  async lyrics(id: number): Promise<NeteaseLyrics> {
    return this.request<NeteaseLyrics>('/api/song/lyric', {
      id,
      lv: -1,
      kv: -1,
      tv: -1,
    });
  }

  async playlist(id: number, limit = 100): Promise<NeteasePlaylist | null> {
    const parsed = await this.request<{ playlist?: NeteasePlaylist }>('/api/v6/playlist/detail', {
      id,
      n: limit,
    });
    return parsed.playlist ?? null;
  }

  async toplists(): Promise<NeteaseToplist[]> {
    const parsed = await this.request<{ list?: NeteaseToplist[] }>('/api/toplist');
    return parsed.list ?? [];
  }

  async personalizedPlaylists(limit = 10): Promise<NeteasePlaylist[]> {
    const parsed = await this.request<{ result?: NeteasePlaylist[] }>('/api/personalized/playlist', {
      limit,
    });
    return parsed.result ?? [];
  }
}
