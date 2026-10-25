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
  /** URL-encoded form body; when present the request is sent as POST. */
  data?: Record<string, string | number | boolean | undefined | null>;
  /** Overrides the default `https://www.bilibili.com/` referer. */
  referer?: string;
  signal?: AbortSignal;
}

export interface BilibiliClientOptions {
  fetchImpl?: typeof fetch;
  cookie?: string;
  userAgent?: string;
  minIntervalMs?: number;
  getNowSeconds?: () => number;
}

export interface BilibiliReply {
  rpid: number;
  parent?: number;
  root?: number;
  oid?: number;
  type?: number;
  like?: number;
  /** 楼中楼回复数 */
  rcount?: number;
  ctime?: number;
  content?: { message?: string; emote?: unknown };
  member?: {
    mid?: string;
    uname?: string;
    avatar?: string;
    level_info?: { current_level?: number };
  };
  /** 内嵌的楼中楼预览（仅顶层评论可能带） */
  replies?: BilibiliReply[];
  reply_control?: Record<string, unknown>;
}

export interface BilibiliReplyPage {
  oid: number;
  type: number;
  page?: { num?: number; size?: number; count?: number; acount?: number };
  replies: BilibiliReply[];
  /** 部分场景下楼层为空但 cursor 指向下一页 */
  cursor?: { is_end?: boolean; next?: number } | null;
}

export interface BilibiliMyInfo {
  isLogin: boolean;
  mid?: number;
  uname?: string;
  level?: number;
  coins?: number;
  vipStatus?: number;
}

export interface BilibiliPostReplyResult {
  rpid: number;
  oid: number;
  type: number;
  root?: number;
  parent?: number;
}
