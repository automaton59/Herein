/**
 * Bilibili plugin: recommendation feed + optional comment access.
 *
 * Default posture is anonymous and read-only: the public recommendation feed
 * (`scan`) and public comment sections (`comments` / `replies`) work without
 * any credentials. Logging in is opt-in via a credentials file; actually
 * posting comments additionally requires the `allowComment` config switch.
 * The plugin never writes to the database itself: everything reaches the Core
 * as observations through `ctx.emit`, and the Core owns storage and pacing.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function resolveLimit(input, config) {
  const body = input && typeof input === 'object' ? input : {};
  const fromInput = typeof body.limit === 'number' ? body.limit : undefined;
  const fromConfig = Number(config.limit);
  const raw = fromInput ?? (Number.isFinite(fromConfig) ? fromConfig : DEFAULT_LIMIT);

  return Math.max(1, Math.min(MAX_LIMIT, Math.round(raw)));
}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Credentials file format (either form works):
 *   { "cookie": "SESSDATA=...; bili_jct=...; DedeUserID=..." }
 *   { "sessdata": "...", "biliJct": "...", "dedeUserId": "..." }
 * Copying the whole browser cookie is the least error-prone.
 */
async function loadCredentials(ctx) {
  const configured = asTrimmedString(ctx.config.credentialsPath);
  const resolved = configured
    ? (path.isAbsolute(configured) ? configured : path.join(ctx.dataDir ?? process.cwd(), configured))
    : path.join(ctx.dataDir ?? process.cwd(), 'bilibili.json');

  let parsed;

  try {
    parsed = JSON.parse(await readFile(resolved, 'utf8'));
  } catch (error) {
    if (!configured && (error?.code === 'ENOENT' || String(error).includes('ENOENT'))) {
      return { cookie: null, found: false, path: resolved };
    }

    return { cookie: null, found: true, path: resolved, error: `凭据文件读取失败：${error instanceof Error ? error.message : String(error)}` };
  }

  if (typeof parsed.cookie === 'string' && parsed.cookie.trim()) {
    return { cookie: parsed.cookie.trim(), found: true, path: resolved };
  }

  const sessdata = asTrimmedString(parsed.sessdata);
  const biliJct = asTrimmedString(parsed.biliJct ?? parsed.bili_jct);

  if (sessdata && biliJct) {
    const parts = [`SESSDATA=${sessdata}`, `bili_jct=${biliJct}`];
    const dedeUserId = asTrimmedString(parsed.dedeUserId ?? parsed.dedeuserid);

    if (dedeUserId) {
      parts.push(`DedeUserID=${dedeUserId}`);
    }

    return { cookie: parts.join('; '), found: true, path: resolved };
  }

  return { cookie: null, found: true, path: resolved, error: '凭据文件里没有 cookie（或 sessdata+biliJct）字段' };
}

function summarizeReply(reply) {
  return {
    rpid: reply.rpid,
    user: reply.member?.uname ?? null,
    mid: reply.member?.mid ?? null,
    like: reply.like ?? 0,
    subReplyCount: reply.rcount ?? 0,
    time: typeof reply.ctime === 'number' ? new Date(reply.ctime * 1000).toISOString() : null,
    message: reply.content?.message ?? '',
    ...(Array.isArray(reply.replies) && reply.replies.length
      ? { preview: reply.replies.map(summarizeReply) }
      : {}),
  };
}

export function createPlugin() {
  let lastError = null;
  let lastSuccessAt;
  let clientCache = null; // { cookie: string|null, client: Promise<object> }
  const sentKeys = new Set();

  /**
   * Read the credentials file on every call that needs it: users add or fix
   * `bilibili.json` while the plugin is already enabled, and a stale cache
   * would make that look like login is broken. The file is tiny; invokes are
   * not hot loops (scan runs every ~45 min, comment writes are explicit).
   */
  async function getCredentials(ctx) {
    return loadCredentials(ctx);
  }

  function getClient(ctx, cookie) {
    if (!clientCache || clientCache.cookie !== (cookie ?? null)) {
      clientCache = {
        cookie: cookie ?? null,
        client: ctx.loadModule('adapters/bilibili/dist/index.js').then(module => {
          if (typeof module.BilibiliClient !== 'function') {
            throw new Error('bilibili adapter does not export BilibiliClient');
          }

          return new module.BilibiliClient({
            minIntervalMs: 1200,
            ...(cookie ? { cookie } : {}),
          });
        }),
      };
    }

    return clientCache.client;
  }

  /** Write guard: needs both a valid-looking credential file and the switch. */
  async function requireCommentPermission(ctx) {
    const credentials = await getCredentials(ctx);

    if (!credentials.cookie) {
      const detail = credentials.found
        ? (credentials.error ?? '凭据文件里缺少 SESSDATA/bili_jct')
        : `没有找到凭据文件（${credentials.path}）`;
      throw new Error(`未登录，不能发评论：${detail}。配置 bilibili.json 后重试。`);
    }

    if (ctx.config.allowComment !== true) {
      throw new Error('「允许发评论」开关未打开：这是对外发言，需要在插件配置里显式开启。');
    }

    return credentials;
  }

  async function postReply(ctx, client, input, { needRoot }) {
    await requireCommentPermission(ctx);
    const message = asTrimmedString(input.message);

    if (!message) {
      throw new Error('message 不能为空');
    }

    const target = {
      ...(typeof input.oid === 'number' ? { oid: input.oid } : {}),
      ...(input.bvid ? { bvid: String(input.bvid) } : {}),
    };

    if (!target.oid && !target.bvid) {
      throw new Error('需要 bvid 或 oid 定位视频');
    }

    const rootRpid = typeof input.root === 'number' ? input.root : null;

    if (needRoot && !rootRpid) {
      throw new Error('回复评论需要 root（被回复的 rpid）');
    }

    const key = `${target.oid ?? target.bvid}|${rootRpid ?? ''}|${message}`;

    if (sentKeys.has(key)) {
      throw new Error('同样的内容已经发过一次，跳过重复发送。');
    }

    const result = await client.postReply(target, message, {
      ...(rootRpid ? { rootRpid, parentRpid: typeof input.parent === 'number' ? input.parent : rootRpid } : {}),
    });
    sentKeys.add(key);

    ctx.log('info', `已发送 B 站评论：rpid=${result.rpid}${rootRpid ? `（回复 ${rootRpid}）` : ''}`);

    return result;
  }

  return {
    async start() {
      lastError = null;
    },

    async stop() {
      lastError = null;
      clientCache = null;
      sentKeys.clear();
    },

    async health(ctx) {
      const checkedAt = ctx.now().toISOString();
      const credentials = await getCredentials(ctx);
      let message;

      if (!credentials.cookie) {
        message = credentials.found
          ? (credentials.error ?? '凭据文件存在但没有可用内容，保持匿名只读')
          : '匿名只读：未配置登录，可以拉推荐流、读评论';
      } else if (ctx.config.allowComment === true) {
        message = '已登录，允许发评论（每次发送都会进审计）';
      } else {
        message = '已登录（只读模式）：评论发送开关未打开';
      }

      if (lastError) {
        return {
          status: 'degraded',
          message: `${message}；最近错误：${lastError}`,
          checkedAt,
          ...(lastSuccessAt ? { lastSuccessAt } : {}),
        };
      }

      return {
        status: 'ok',
        message,
        checkedAt,
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
      };
    },

    async invoke(action, input, ctx) {
      const body = input && typeof input === 'object' ? input : {};

      switch (action) {
        case 'scan':
          return this.scan(body, ctx);
        case 'whoami':
          return this.whoami(ctx);
        case 'comments':
          return this.comments(body, ctx);
        case 'replies':
          return this.replyThread(body, ctx);
        case 'postComment':
          return this.postComment(body, ctx);
        case 'reply':
          return this.replyToComment(body, ctx);
        default:
          throw new Error(`不支持的 B 站动作：${action}`);
      }
    },

    async scan(input, ctx) {
      const limit = resolveLimit(input, ctx.config);
      const startedAt = ctx.now();
      const day = startedAt.toISOString().slice(0, 10);
      const receivedAt = startedAt.toISOString();

      try {
        const credentials = await getCredentials(ctx);
        const client = await getClient(ctx, credentials.cookie);
        const feed = await client.getRcmd({ ps: limit });
        const items = (feed.item ?? []).filter(item => item.bvid && item.title);
        let emitted = 0;

        for (const item of items) {
          const cover = item.cover ?? item.pic;
          const occurredAt = typeof item.pubdate === 'number'
            ? new Date(item.pubdate * 1000).toISOString()
            : receivedAt;

          await ctx.emit({
            type: 'observation',
            payload: {
              platform: 'bilibili',
              conversationId: `bilibili:feed:${day}`,
              conversationKind: 'public',
              actorId: item.owner?.mid === undefined ? null : String(item.owner.mid),
              actorName: item.owner?.name ?? null,
              isSelf: false,
              kind: 'video_watch',
              content: `推荐：${item.title}`,
              media: cover ? [{ kind: 'image', url: cover }] : [],
              occurredAt,
              receivedAt,
              provenance: 'agent',
              audience: 'private',
              trust: 0.5,
              retention: 'normal',
              raw: item,
              dedupeKey: `bilibili:rcmd:${item.bvid}:${day}`,
            },
          });

          emitted += 1;
        }

        lastSuccessAt = ctx.now().toISOString();
        lastError = null;

        return { fetched: items.length, emitted };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },

    /** Login status; works with or without credentials configured. */
    async whoami(ctx) {
      try {
        const credentials = await getCredentials(ctx);
        const client = await getClient(ctx, credentials.cookie);
        const info = await client.getMyInfo();
        return {
          loggedIn: info.isLogin,
          ...(info.isLogin ? { mid: info.mid, uname: info.uname, level: info.level } : {}),
          ...(credentials.found ? { credentialsPath: credentials.path } : {}),
          ...(credentials.error ? { credentialsError: credentials.error } : {}),
        };
      } catch (error) {
        return {
          loggedIn: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    /**
     * Read a comment section. Anonymous-friendly; pass `bvid` (or `oid`),
     * optional page/pageSize/sort (0 时间 1 点赞 2 热度).
     */
    async comments(input, ctx) {
      const credentials = await getCredentials(ctx);
      const client = await getClient(ctx, credentials.cookie);
      const target = {
        ...(typeof input.oid === 'number' ? { oid: input.oid } : {}),
        ...(input.bvid ? { bvid: String(input.bvid) } : {}),
      };

      if (!target.oid && !target.bvid) {
        throw new Error('需要 bvid 或 oid');
      }

      const page = await client.getReplies(target, {
        pn: typeof input.page === 'number' && input.page > 0 ? Math.floor(input.page) : 1,
        ps: Math.min(49, Math.max(1, typeof input.pageSize === 'number' ? Math.floor(input.pageSize) : 20)),
        sort: [0, 1, 2].includes(input.sort) ? input.sort : 2,
      });

      return {
        oid: page.oid,
        total: page.page?.count ?? null,
        page: page.page?.num ?? 1,
        pageSize: page.page?.size ?? null,
        replies: page.replies.map(summarizeReply),
        ...(input.bvid ? { bvid: String(input.bvid) } : {}),
      };
    },

    /** Read the nested thread (楼中楼) under one root comment. */
    async replyThread(input, ctx) {
      const credentials = await getCredentials(ctx);
      const client = await getClient(ctx, credentials.cookie);
      const root = typeof input.root === 'number' ? input.root : Number(input.root);

      if (!Number.isFinite(root)) {
        throw new Error('需要 root（顶层评论的 rpid）');
      }

      const target = {
        ...(typeof input.oid === 'number' ? { oid: input.oid } : {}),
        ...(input.bvid ? { bvid: String(input.bvid) } : {}),
      };

      if (!target.oid && !target.bvid) {
        throw new Error('需要 bvid 或 oid');
      }

      const thread = await client.getReplyReplies(target, root, {
        pn: typeof input.page === 'number' && input.page > 0 ? Math.floor(input.page) : 1,
        ps: Math.min(49, Math.max(1, typeof input.pageSize === 'number' ? Math.floor(input.pageSize) : 20)),
      });

      return {
        oid: thread.oid,
        root: thread.root,
        total: thread.page?.count ?? null,
        page: thread.page?.num ?? 1,
        replies: thread.replies.map(summarizeReply),
        ...(input.bvid ? { bvid: String(input.bvid) } : {}),
      };
    },

    /** Post a top-level comment; requires credentials + allowComment. */
    async postComment(input, ctx) {
      const credentials = await getCredentials(ctx);
      const client = await getClient(ctx, credentials.cookie);
      return postReply(ctx, client, input, { needRoot: false });
    },

    /** Reply inside a comment thread; requires credentials + allowComment. */
    async replyToComment(input, ctx) {
      const credentials = await getCredentials(ctx);
      const client = await getClient(ctx, credentials.cookie);
      return postReply(ctx, client, input, { needRoot: true });
    },
  };
}
