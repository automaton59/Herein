import { randomUUID } from 'node:crypto';
import type { createPhase2Repositories } from '../data/repositories';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface BilibiliFeedItem {
  bvid?: string;
  title: string;
  cover?: string;
  pic?: string;
  duration?: number;
  pubdate?: number;
  owner?: { mid?: number; name?: string };
}

export interface BilibiliFeedSource {
  getRcmd(options?: { ps?: number }): Promise<{ item?: BilibiliFeedItem[] }>;
}

export interface BilibiliFeedScanOptions {
  repos: Repositories;
  source: BilibiliFeedSource;
  limit?: number;
  now?: () => Date;
}

export interface BilibiliFeedScanResult {
  sessionId: string;
  fetched: number;
  inserted: number;
}

export async function scanBilibiliFeed(options: BilibiliFeedScanOptions): Promise<BilibiliFeedScanResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const sessionId = randomUUID();
  const day = startedAt.toISOString().slice(0, 10);

  options.repos.activitySessions.start({
    id: sessionId,
    kind: 'bilibili_feed',
    status: 'running',
    startedAt: startedAt.toISOString(),
  });

  try {
    const feed = await options.source.getRcmd({ ps: options.limit ?? 20 });
    const items = (feed.item ?? []).filter(item => item.bvid && item.title);
    let inserted = 0;

    for (const item of items) {
      const occurredAt = typeof item.pubdate === 'number'
        ? new Date(item.pubdate * 1000).toISOString()
        : startedAt.toISOString();
      const cover = item.cover ?? item.pic;

      const didInsert = options.repos.observations.insert({
        id: randomUUID(),
        platform: 'bilibili',
        accountId: null,
        conversationId: `bilibili:feed:${day}`,
        conversationKind: 'public',
        actorId: item.owner?.mid === undefined ? null : String(item.owner.mid),
        actorName: item.owner?.name ?? null,
        isSelf: false,
        kind: 'video_watch',
        content: `推荐：${item.title}`,
        media: cover ? [{ kind: 'image', url: cover }] : [],
        occurredAt,
        receivedAt: startedAt.toISOString(),
        provenance: 'agent',
        audience: 'private',
        trust: 0.5,
        retention: 'normal',
        raw: item,
        dedupeKey: `bilibili:rcmd:${item.bvid}:${day}`,
      });

      if (didInsert) {
        inserted += 1;
      }
    }

    options.repos.activitySessions.finish(sessionId, {
      status: 'completed',
      endedAt: now().toISOString(),
      stats: {
        fetched: items.length,
        inserted,
        skipped: items.length - inserted,
      },
      summary: `B站推荐流：${items.length} 条，新增 ${inserted} 条。`,
    });

    return { sessionId, fetched: items.length, inserted };
  } catch (error) {
    options.repos.activitySessions.finish(sessionId, {
      status: 'failed',
      endedAt: now().toISOString(),
      stats: { fetched: 0, inserted: 0 },
      summary: error instanceof Error ? error.message.slice(0, 200) : 'B站推荐流失败',
    });
    throw error;
  }
}
