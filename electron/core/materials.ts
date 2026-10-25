import { randomUUID } from 'node:crypto';
import type { createPhase2Repositories, ObservationRecord } from '../data/repositories';

type Repositories = ReturnType<typeof createPhase2Repositories>;

/**
 * The subset of PluginRegistry the material service needs. Keeping this
 * structural makes the service testable without starting a real registry.
 */
export interface MaterialPluginHost {
  get(pluginId: string): { enabled: boolean } | null;
  invoke(pluginId: string, action: string, input: unknown): Promise<unknown>;
}

export interface MaterialLogger {
  info?: (message: string, detail?: unknown) => void;
  warn?: (message: string, detail?: unknown) => void;
}

export interface MaterialItem {
  id: string;
  source: 'bilibili' | 'netease';
  kind: 'video' | 'song';
  title: string;
  creator: string | null;
  url: string | null;
  coverUrl: string | null;
  discoveredAt: string;
}

export interface MaterialContext {
  block: string;
  hasIntent: boolean;
  refreshed: string[];
  failed: string[];
  /** The entries actually rendered into `block`, in render order. */
  items: MaterialItem[];
}

/**
 * The compact share token for a material entry: the Bilibili BV id, or the
 * NetEase song id. This is what the character quotes when asked for a link —
 * short enough to say out loud, unambiguous enough to search for.
 */
export function materialShortId(item: MaterialItem): string | null {
  if (!item.url) {
    return null;
  }

  const bv = item.url.match(/BV[0-9A-Za-z]{2,}/i);

  if (bv) {
    return bv[0];
  }

  const songId = item.url.match(/[?&]id=(\d+)/);

  return songId ? songId[1] : null;
}

/**
 * Picks the material entry a reply actually talked about.
 *
 * Matching is intentionally dumb: a normalized-title or short-id substring hit.
 * The block told the character what she "just scrolled past"; if her reply
 * repeats one of those titles (or quotes the BV id when handing out a link),
 * that is the entry worth attaching. No hit, no attachment — the card must
 * never appear without the reply referring to it.
 */
export function pickMaterialForReply(items: MaterialItem[], reply: string): MaterialItem | null {
  const normalizedReply = reply.toLowerCase().replace(/\s+/g, '');

  if (!normalizedReply) {
    return null;
  }

  for (const item of items) {
    if (!item.url) {
      continue;
    }

    const title = item.title.toLowerCase().replace(/\s+/g, '');
    const minTitleLength = item.kind === 'video' ? 4 : 2;
    const shortId = materialShortId(item)?.toLowerCase() ?? null;

    if (
      (title.length >= minTitleLength && normalizedReply.includes(title))
      || (shortId && normalizedReply.includes(shortId))
    ) {
      return item;
    }
  }

  return null;
}

export interface MaterialServiceOptions {
  repos: Repositories;
  plugins: MaterialPluginHost;
  now?: () => Date;
  logger?: MaterialLogger;
  bilibiliCooldownMs?: number;
  neteaseCooldownMs?: number;
  requestTimeoutMs?: number;
}

export interface MaterialRefreshOutcome {
  status: 'ok' | 'cached' | 'disabled';
  fetched?: number;
  inserted?: number;
}

const BILIBILI_INTENT = /b\s*站|哔哩|bilibili|(看看|翻翻|刷刷|找找|推荐|有什么|最近).{0,8}(视频|vlog|up主)|视频.{0,6}(推荐|好看|好玩)/i;
const MUSIC_INTENT = /网易云|音乐|歌单|听歌|听什么|来首歌|推荐.{0,6}歌|有什么歌/i;
const WEATHER_INTENT = /天气|下雨|下雪|降温|温度|冷不冷|热不热|带伞/i;
const AMBIENT_INTENT = /在干嘛|在做什么|干嘛呢|好无聊|无聊|有什么好玩|最近.{0,6}(看|听|玩)/i;

const NETEASE_DAY_PREFIX = 'netease:toplist:';
const UNSAFE_TITLE = /爆头|血腥|尸体|自杀|跳楼|割腕|色情|裸体|性爱|约炮|毒品|冰毒|海洛因|枪支|恐怖袭击|分尸|虐杀/i;
const MAX_TITLE_LENGTH = 48;

function cleanTitle(value: string): string | null {
  const title = value.replace(/\s+/g, ' ').trim();

  if (!title || UNSAFE_TITLE.test(title)) {
    return null;
  }

  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function firstMediaUrl(media: unknown[]): string | null {
  for (const item of media) {
    if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
      return (item as { url: string }).url;
    }
  }

  return null;
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bilibiliMaterial(observation: ObservationRecord): MaterialItem | null {
  const raw = record(observation.raw);
  const rawTitle = stringField(raw.title);
  const title = cleanTitle(rawTitle ?? (observation.content ?? '').replace(/^推荐：/, ''));

  if (!title) {
    return null;
  }

  const owner = record(raw.owner);
  const bvid = stringField(raw.bvid);

  return {
    id: observation.id,
    source: 'bilibili',
    kind: 'video',
    title,
    creator: stringField(owner.name) ?? observation.actorName ?? null,
    url: bvid ? `https://www.bilibili.com/video/${bvid}` : null,
    coverUrl: firstMediaUrl(observation.media ?? []),
    discoveredAt: observation.receivedAt || observation.occurredAt,
  };
}

function neteaseMaterial(observation: ObservationRecord): MaterialItem | null {
  const raw = record(observation.raw);
  const title = cleanTitle(stringField(raw.title)
    ?? (observation.content ?? '').split(' - ')[0] ?? '');

  if (!title) {
    return null;
  }

  const itemId = stringField(raw.itemId);

  return {
    id: observation.id,
    source: 'netease',
    kind: 'song',
    title,
    creator: stringField(raw.creator) ?? null,
    url: itemId ? `https://music.163.com/song?id=${itemId}` : null,
    coverUrl: stringField(raw.coverUrl) ?? firstMediaUrl(observation.media ?? []),
    discoveredAt: observation.receivedAt || observation.occurredAt,
  };
}

function toMaterial(observation: ObservationRecord): MaterialItem | null {
  if (observation.platform === 'bilibili') {
    return bilibiliMaterial(observation);
  }

  if (observation.platform === 'netease') {
    return neteaseMaterial(observation);
  }

  return null;
}

/**
 * Turns plugin observations into two things:
 *  - a compact prompt block for chat / initiative ("她刚翻到的")
 *  - an on-demand refresh path for "b 站有什么好玩的" style requests
 */
export class MaterialService {
  private readonly repos: Repositories;
  private readonly plugins: MaterialPluginHost;
  private readonly now: () => Date;
  private readonly logger: MaterialLogger;
  private readonly bilibiliCooldownMs: number;
  private readonly neteaseCooldownMs: number;
  private readonly requestTimeoutMs: number;
  private lastBilibiliAt = 0;
  private lastNeteaseAt = 0;
  private weather: { text: string; at: number } | null = null;
  private autoWarmup: ReturnType<typeof setTimeout> | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MaterialServiceOptions) {
    this.repos = options.repos;
    this.plugins = options.plugins;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? {};
    this.bilibiliCooldownMs = options.bilibiliCooldownMs ?? 3 * 60 * 1000;
    this.neteaseCooldownMs = options.neteaseCooldownMs ?? 5 * 60 * 1000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
  }

  async contextForText(text: string): Promise<MaterialContext> {
    const clean = text.trim();
    const wantsBilibili = BILIBILI_INTENT.test(clean);
    const wantsMusic = MUSIC_INTENT.test(clean);
    const wantsWeather = WEATHER_INTENT.test(clean);
    const wantsAmbient = AMBIENT_INTENT.test(clean);
    const refreshed: string[] = [];
    const failed: string[] = [];

    if (!wantsBilibili && !wantsMusic && !wantsWeather && !wantsAmbient) {
      return { block: '', hasIntent: false, refreshed, failed, items: [] };
    }

    if (wantsBilibili) {
      try {
        const outcome = await this.refreshBilibili({ force: /再|还|又|刚|没/.test(clean) });

        if (outcome.status === 'ok') {
          refreshed.push('bilibili');
        }
      } catch (error) {
        failed.push('bilibili');
        this.logger.warn?.('bilibili material refresh failed', error);
      }
    }

    if (wantsMusic) {
      try {
        const outcome = await this.refreshNetease({ force: /再|还|又|刚|没/.test(clean) });

        if (outcome.status === 'ok') {
          refreshed.push('netease');
        }
      } catch (error) {
        failed.push('netease');
        this.logger.warn?.('netease material refresh failed', error);
      }
    }

    if (wantsWeather) {
      try {
        const outcome = await this.refreshWeather();

        if (outcome.status === 'ok') {
          refreshed.push('weather');
        }
      } catch (error) {
        failed.push('weather');
        this.logger.warn?.('weather material refresh failed', error);
      }
    }

    const preferred = wantsMusic && !wantsBilibili
      ? 'netease'
      : wantsBilibili && !wantsMusic
        ? 'bilibili'
        : undefined;
    const preferredResult = this.blockWithItems(6, undefined, preferred);
    let block = preferredResult.text;
    let fedItems = preferredResult.items;

    if (!block) {
      const fallback = this.blockWithItems(6);
      block = fallback.text;
      fedItems = fallback.items;
    }

    const notes: string[] = [];

    if (failed.includes('bilibili')) {
      notes.push('B 站这次没翻到（接口或网络失败）');
    }

    if (failed.includes('netease')) {
      notes.push('音乐这次没翻到（接口或网络失败）');
    }

    if (failed.includes('weather')) {
      notes.push('天气这次没查到');
    }

    if ((wantsBilibili || wantsMusic || wantsWeather) && !block && notes.length === 0) {
      notes.push('这次没有翻到新内容');
    }

    return {
      block: [block, notes.length ? `【说明】${notes.join('；')}` : ''].filter(Boolean).join('\n'),
      hasIntent: wantsBilibili || wantsMusic || wantsWeather || wantsAmbient,
      refreshed,
      failed,
      items: fedItems,
    };
  }

  block(limit = 6, maxAgeMs = 48 * 60 * 60 * 1000, source?: 'bilibili' | 'netease'): string {
    return this.blockWithItems(limit, maxAgeMs, source).text;
  }

  /** Same output as `block()`, but also returns the entries that were rendered. */
  blockWithItems(limit = 6, maxAgeMs = 48 * 60 * 60 * 1000, source?: 'bilibili' | 'netease'): {
    text: string;
    items: MaterialItem[];
  } {
    const items = this.list(limit, maxAgeMs, source);
    const weatherLine = this.weather && Date.now() - this.weather.at < 2 * 60 * 60 * 1000
      ? `- 天气：${this.weather.text}`
      : null;

    if (items.length === 0 && !weatherLine) {
      return { text: '', items: [] };
    }

    const lines = [
      ...(weatherLine ? [weatherLine] : []),
      ...items.map(item => {
        const shortId = materialShortId(item);

        return item.kind === 'video'
          ? `- 视频：${item.title}${item.creator ? `（UP：${item.creator}）` : ''}${shortId ? ` [${shortId}]` : ''}`
          : `- 音乐：${item.title}${item.creator ? ` - ${item.creator}` : ''}${shortId ? ` [${shortId}]` : ''}`;
      }),
    ];

    return {
      text: [
        '【她刚翻到的】（她自己刷到的，不是用户说的；不要提“系统/查询”）',
        ...lines,
        '只能从上面列出的条目里挑一条自然地说；列表里没有的内容不要编，没翻到就说没翻到。',
        '用户要是问链接、要地址，直接把那条末尾方括号里的编号告诉他；平时聊天不用提编号。',
      ].join('\n'),
      items,
    };
  }

  hasFresh(maxAgeMs = 48 * 60 * 60 * 1000): boolean {
    return this.list(1, maxAgeMs).length > 0
      || Boolean(this.weather && Date.now() - this.weather.at < 2 * 60 * 60 * 1000);
  }

  list(limit = 6, maxAgeMs = 48 * 60 * 60 * 1000, source?: 'bilibili' | 'netease'): MaterialItem[] {
    const cutoff = this.now().getTime() - maxAgeMs;
    const rows = [
      ...(source === undefined || source === 'bilibili'
        ? this.repos.observations.listRecent({ platform: 'bilibili', limit: Math.max(limit * 4, 12) })
        : []),
      ...(source === undefined || source === 'netease'
        ? this.repos.observations.listRecent({ platform: 'netease', limit: Math.max(limit * 4, 12) })
        : []),
    ];

    const items: MaterialItem[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const timestamp = Date.parse(row.receivedAt || row.occurredAt);

      if (!Number.isFinite(timestamp) || timestamp < cutoff) {
        continue;
      }

      const item = toMaterial(row);

      if (!item) {
        continue;
      }

      const key = `${item.source}:${item.title}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      items.push(item);
    }

    return items
      .sort((left, right) => Date.parse(right.discoveredAt) - Date.parse(left.discoveredAt))
      .slice(0, limit);
  }

  async refreshBilibili(options: { limit?: number; force?: boolean } = {}): Promise<MaterialRefreshOutcome> {
    const plugin = this.plugins.get('bilibili');

    if (!plugin?.enabled) {
      return { status: 'disabled' };
    }

    const now = Date.now();

    if (!options.force && now - this.lastBilibiliAt < this.bilibiliCooldownMs) {
      return { status: 'cached' };
    }

    // The session wraps the whole scan: the plugin reports items, the event sink
    // persists them, and this ledger records the run for the audit view.
    const sessionId = randomUUID();
    const startedAt = this.now().toISOString();

    this.repos.activitySessions.start({
      id: sessionId,
      kind: 'bilibili_feed',
      status: 'running',
      startedAt,
    });

    let result: { fetched?: unknown; emitted?: unknown } | undefined;

    try {
      result = await withTimeout(
        this.plugins.invoke('bilibili', 'scan', { limit: options.limit ?? 12 }),
        this.requestTimeoutMs,
        'bilibili scan',
      ) as { fetched?: unknown; emitted?: unknown } | undefined;

      const fetched = typeof result?.fetched === 'number' ? result.fetched : 0;
      const inserted = typeof result?.emitted === 'number' ? result.emitted : 0;

      this.repos.activitySessions.finish(sessionId, {
        status: 'completed',
        endedAt: this.now().toISOString(),
        stats: { fetched, inserted },
        summary: `B站推荐流：${fetched} 条，上报 ${inserted} 条。`,
      });

      this.lastBilibiliAt = Date.now();

      return {
        status: 'ok',
        fetched,
        inserted,
      };
    } catch (error) {
      this.repos.activitySessions.finish(sessionId, {
        status: 'failed',
        endedAt: this.now().toISOString(),
        stats: { fetched: 0, inserted: 0 },
        summary: error instanceof Error ? error.message.slice(0, 200) : 'B站推荐流失败',
      });
      throw error;
    }
  }

  async refreshNetease(options: { limit?: number; force?: boolean } = {}): Promise<MaterialRefreshOutcome> {
    const plugin = this.plugins.get('netease');

    if (!plugin?.enabled) {
      return { status: 'disabled' };
    }

    const now = Date.now();

    if (!options.force && now - this.lastNeteaseAt < this.neteaseCooldownMs) {
      return { status: 'cached' };
    }

    const result = await withTimeout(
      this.plugins.invoke('netease', 'candidates', { limit: options.limit ?? 8 }),
      this.requestTimeoutMs,
      'netease candidates',
    ) as { candidates?: unknown[] } | undefined;

    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    let inserted = 0;

    for (const candidate of candidates) {
      if (this.recordSong(candidate)) {
        inserted += 1;
      }
    }

    this.lastNeteaseAt = Date.now();

    return { status: 'ok', fetched: candidates.length, inserted };
  }

  async refreshWeather(options: { force?: boolean } = {}): Promise<MaterialRefreshOutcome> {
    const plugin = this.plugins.get('weather');

    if (!plugin?.enabled) {
      return { status: 'disabled' };
    }

    if (!options.force && this.weather && Date.now() - this.weather.at < 15 * 60 * 1000) {
      return { status: 'cached' };
    }

    const result = await withTimeout(
      this.plugins.invoke('weather', 'current', {}),
      this.requestTimeoutMs,
      'weather current',
    ) as {
      location?: { name?: string };
      current?: {
        weather?: string;
        temperatureC?: number;
      };
    } | undefined;
    const current = result?.current;

    if (!current) {
      throw new Error('weather returned no current conditions');
    }

    const location = result?.location?.name?.trim() || '你那边';
    const temperature = typeof current.temperatureC === 'number'
      ? `${Math.round(current.temperatureC)}°C`
      : '';
    const description = current.weather?.trim() || '天气';

    this.weather = {
      text: `${location}${description}${temperature ? `，${temperature}` : ''}`,
      at: Date.now(),
    };

    return { status: 'ok' };
  }

  async refreshAll(): Promise<void> {
    const results = await Promise.allSettled([
      this.refreshBilibili({ force: true, limit: 12 }),
      this.refreshNetease({ force: true, limit: 8 }),
      this.refreshWeather({ force: true }),
    ]);
    const labels = ['bilibili', 'netease', 'weather'];

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn?.(`material refresh failed: ${labels[index]}`, result.reason);
        return;
      }

      if (result.value.status === 'ok') {
        this.logger.info?.(
          `material refresh: ${labels[index]} fetched=${result.value.fetched ?? 0} inserted=${result.value.inserted ?? 0}`,
        );
      }
    });
  }

  startAutoRefresh(options: { intervalMs?: number; warmupMs?: number } = {}) {
    if (this.autoTimer || this.autoWarmup) {
      return;
    }

    const intervalMs = options.intervalMs ?? 45 * 60 * 1000;
    const warmupMs = options.warmupMs ?? 8_000;

    this.autoWarmup = setTimeout(() => {
      void this.refreshAll();
    }, warmupMs);
    this.autoWarmup.unref?.();

    this.autoTimer = setInterval(() => {
      void this.refreshAll();
    }, intervalMs);
    this.autoTimer.unref?.();
  }

  stopAutoRefresh() {
    if (this.autoWarmup) {
      clearTimeout(this.autoWarmup);
      this.autoWarmup = null;
    }

    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private recordSong(candidate: unknown): boolean {
    const profile = record(candidate);
    const itemId = stringField(profile.itemId);
    const title = stringField(profile.title);

    if (!itemId || !title) {
      return false;
    }

    const creator = stringField(profile.creator);
    const coverUrl = stringField(profile.coverUrl);
    const now = this.now();
    const day = now.toISOString().slice(0, 10);

    return this.repos.observations.insert({
      id: randomUUID(),
      platform: 'netease',
      accountId: null,
      conversationId: `${NETEASE_DAY_PREFIX}${day}`,
      conversationKind: 'public',
      actorId: null,
      actorName: creator,
      isSelf: false,
      isBot: false,
      kind: 'music_candidate',
      content: creator ? `${title} - ${creator}` : title,
      media: coverUrl ? [{ kind: 'image', url: coverUrl }] : [],
      occurredAt: now.toISOString(),
      receivedAt: now.toISOString(),
      provenance: 'agent',
      audience: 'private',
      trust: 0.5,
      retention: 'normal',
      raw: profile,
      dedupeKey: `netease:${itemId}:${day}`,
    });
  }
}
