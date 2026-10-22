export interface BilibiliApiResponse<T> {
  code: number;
  message?: string;
  ttl?: number;
  data: T;
}

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

export interface BilibiliOwner {
  mid: number;
  name: string;
  face?: string;
}

export interface BilibiliStat {
  view?: number;
  danmaku?: number;
  reply?: number;
  favorite?: number;
  coin?: number;
  share?: number;
  like?: number;
}

export interface BilibiliVideo {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  desc?: string;
  pic?: string;
  duration?: number;
  pubdate?: number;
  owner?: BilibiliOwner;
  stat?: BilibiliStat;
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
}

export interface BilibiliRcmdItem {
  bvid?: string;
  id?: number;
  title: string;
  cover?: string;
  pic?: string;
  duration?: number;
  pubdate?: number;
  owner?: BilibiliOwner;
  name?: string;
  stat?: BilibiliStat;
  goto?: string;
}

export interface BilibiliRcmdData {
  item?: BilibiliRcmdItem[];
}

export interface BilibiliPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

export interface BilibiliSearchVideo {
  bvid: string;
  title: string;
  author?: string;
  play?: number;
  review?: number;
  danmaku?: number;
  duration?: string;
  description?: string;
  pubdate?: number;
}

export interface BilibiliSubtitleResult {
  bvid: string;
  language: string;
  segments: number;
  text: string;
  empty: boolean;
  reason?: string;
}

export interface BilibiliConclusion {
  code: number;
  model_result?: {
    summary?: string;
    outline?: Array<{ title: string; part_outline?: Array<{ timestamp: number; content: string }> }>;
  };
  stid?: string;
  status?: number;
}

export interface BilibiliSubtitleItem {
  id?: number;
  lan?: string;
  lan_doc?: string;
  subtitle_url?: string;
  author?: { mid: number; name: string };
}

export interface BilibiliPlayerData {
  subtitle?: {
    allow_submit?: boolean;
    list?: BilibiliSubtitleItem[];
  };
  view_points?: unknown[];
}

export interface BilibiliRequestOptions {
  params?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export interface BilibiliClientOptions {
  fetchImpl?: typeof fetch;
  cookie?: string;
  userAgent?: string;
  minIntervalMs?: number;
  getNowSeconds?: () => number;
}
