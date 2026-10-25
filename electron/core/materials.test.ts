/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { MaterialService, pickMaterialForReply, type MaterialItem, type MaterialPluginHost } from './materials';

const dirs: string[] = [];
const databases: Phase2Database[] = [];

function setup(now = '2026-10-24T08:00:00.000Z') {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-materials-'));
  dirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  const repos = createPhase2Repositories(db);
  const calls: Array<{ pluginId: string; action: string; input: unknown }> = [];
  let bilibiliEnabled = true;
  let neteaseEnabled = true;
  let weatherEnabled = false;

  const plugins: MaterialPluginHost = {
    get(pluginId) {
      if (pluginId === 'bilibili') {
        return { enabled: bilibiliEnabled };
      }

      if (pluginId === 'netease') {
        return { enabled: neteaseEnabled };
      }

      if (pluginId === 'weather') {
        return { enabled: weatherEnabled };
      }

      return null;
    },
    async invoke(pluginId, action, input) {
      calls.push({ pluginId, action, input });

      if (pluginId === 'weather') {
        return {
          location: { name: '杭州' },
          current: { weather: '小雨', temperatureC: 19 },
        };
      }

      if (pluginId === 'bilibili') {
        repos.observations.insert({
          id: 'obs-bilibili-1',
          platform: 'bilibili',
          conversationId: 'bilibili:feed:2026-10-24',
          conversationKind: 'public',
          kind: 'video_watch',
          content: '推荐：关羽对线教程',
          media: [{ kind: 'image', url: 'https://example.test/cover.jpg' }],
          occurredAt: now,
          receivedAt: now,
          provenance: 'agent',
          audience: 'private',
          raw: {
            bvid: 'BV1xx',
            title: '关羽对线教程',
            owner: { mid: 1, name: '某UP' },
          },
          dedupeKey: 'bilibili:rcmd:BV1xx:2026-10-24',
        });

        return { fetched: 1, inserted: 1 };
      }

      return {
        candidates: [{
          type: 'song',
          itemId: 'song-1',
          title: '时过境迁',
          creator: '某歌手',
          coverUrl: 'https://example.test/song.jpg',
        }],
      };
    },
  };

  const service = new MaterialService({
    repos,
    plugins,
    now: () => new Date(now),
    requestTimeoutMs: 1000,
  });

  return {
    repos,
    service,
    calls,
    setBilibiliEnabled: (value: boolean) => { bilibiliEnabled = value; },
    setNeteaseEnabled: (value: boolean) => { neteaseEnabled = value; },
    setWeatherEnabled: (value: boolean) => { weatherEnabled = value; },
  };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    closePhase2Database(db);
  }

  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('material service', () => {
  it('stores NetEase candidates as observations and renders them for prompts', async () => {
    const { repos, service } = setup();

    const outcome = await service.refreshNetease({ force: true, limit: 3 });
    expect(outcome).toEqual({ status: 'ok', fetched: 1, inserted: 1 });

    const observations = repos.observations.listRecent({ platform: 'netease', limit: 5 });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual(expect.objectContaining({
      kind: 'music_candidate',
      content: '时过境迁 - 某歌手',
    }));

    const block = service.block(5);
    expect(block).toContain('【她刚翻到的】');
    expect(block).toContain('音乐：时过境迁 - 某歌手');
  });

  it('deduplicates a repeated NetEase refresh on the same day', async () => {
    const { service } = setup();

    await service.refreshNetease({ force: true });
    const second = await service.refreshNetease({ force: true });

    expect(second).toEqual({ status: 'ok', fetched: 1, inserted: 0 });
  });

  it('refreshes Bilibili on intent and includes the result in chat context', async () => {
    const { service, calls } = setup();

    const context = await service.contextForText('b 站有什么好玩的');

    expect(context.hasIntent).toBe(true);
    expect(context.failed).toEqual([]);
    expect(context.block).toContain('关羽对线教程');
    expect(context.block).toContain('某UP');
    expect(calls).toEqual([
      expect.objectContaining({ pluginId: 'bilibili', action: 'scan' }),
    ]);
  });

  it('does not leak ambient material into unrelated chat', async () => {
    const { service } = setup();
    await service.refreshBilibili({ force: true });

    const context = await service.contextForText('今天有点累');

    expect(context.block).toBe('');
    expect(context.hasIntent).toBe(false);
  });

  it('shares material when the user asks what she is doing', async () => {
    const { service } = setup();
    await service.refreshBilibili({ force: true });

    const context = await service.contextForText('你在干嘛呀');

    expect(context.hasIntent).toBe(true);
    expect(context.block).toContain('关羽对线教程');
  });

  it('does not hit the network for ordinary chat', async () => {
    const { service, calls } = setup();

    await service.contextForText('今天有点累');

    expect(calls).toEqual([]);
    expect(service.block(5)).toBe('');
  });

  it('reports a disabled plugin without invoking it', async () => {
    const { service, calls, setBilibiliEnabled } = setup();
    setBilibiliEnabled(false);

    const outcome = await service.refreshBilibili();
    expect(outcome).toEqual({ status: 'disabled' });
    expect(calls).toEqual([]);

    const context = await service.contextForText('b 站有什么好看的视频');
    expect(context.block).toContain('这次没有翻到新内容');
  });

  it('respects the Bilibili cooldown until forced', async () => {
    const { service, calls } = setup();

    await service.refreshBilibili();
    await service.refreshBilibili();
    expect(calls).toHaveLength(1);

    await service.refreshBilibili({ force: true });
    expect(calls).toHaveLength(2);
  });

  it('filters unsafe recommendation titles', () => {
    const { repos, service } = setup('2026-10-24T08:00:00.000Z');

    repos.observations.insert({
      id: 'obs-unsafe',
      platform: 'bilibili',
      conversationId: 'bilibili:feed:2026-10-24',
      conversationKind: 'public',
      kind: 'video_watch',
      content: '推荐：某视频被爆头',
      occurredAt: '2026-10-24T08:00:00.000Z',
      receivedAt: '2026-10-24T08:00:00.000Z',
      provenance: 'agent',
      audience: 'private',
      raw: { bvid: 'BVbad', title: '某视频被爆头' },
      dedupeKey: 'bilibili:bad',
    });

    expect(service.block(5)).toBe('');
  });

  it('prefers the requested source when both video and music material exist', async () => {
    const { service } = setup();

    await service.refreshBilibili({ force: true });
    await service.refreshNetease({ force: true });

    const music = await service.contextForText('推荐首歌');
    expect(music.block).toContain('音乐：时过境迁');
    expect(music.block).not.toContain('视频：关羽对线教程');

    const video = await service.contextForText('b 站有什么好玩的');
    expect(video.block).toContain('视频：关羽对线教程');
  });

  it('adds weather to the material block on a weather question', async () => {
    const { service, setWeatherEnabled } = setup();
    setWeatherEnabled(true);

    const context = await service.contextForText('今天下雨了吗');

    expect(context.hasIntent).toBe(true);
    expect(context.block).toContain('天气：杭州小雨，19°C');
  });

  it('limits how old material can be', async () => {
    const { repos, service } = setup('2026-10-24T08:00:00.000Z');
    const old = '2026-10-20T08:00:00.000Z';

    repos.observations.insert({
      id: 'obs-old',
      platform: 'bilibili',
      conversationId: 'bilibili:feed:2026-10-20',
      conversationKind: 'public',
      kind: 'video_watch',
      content: '推荐：旧视频',
      occurredAt: old,
      receivedAt: old,
      provenance: 'agent',
      audience: 'private',
      raw: { bvid: 'BVold', title: '旧视频' },
      dedupeKey: 'bilibili:old',
    });

    expect(service.hasFresh()).toBe(false);
    expect(service.block(5)).toBe('');
  });

  it('never invokes disabled plugins through the auto refresh', async () => {
    const { service, calls, setNeteaseEnabled } = setup();
    setNeteaseEnabled(false);

    await service.refreshAll();

    expect(calls).toEqual([
      expect.objectContaining({ pluginId: 'bilibili', action: 'scan' }),
    ]);
  });

  it('runs an automatic refresh after warmup and stops cleanly', async () => {
    vi.useFakeTimers();
    const { service, calls } = setup();

    try {
      service.startAutoRefresh({ warmupMs: 10, intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(10);

      expect(calls.map(call => call.pluginId).sort()).toEqual(['bilibili', 'netease']);

      service.stopAutoRefresh();
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls.length).toBe(before);
    } finally {
      service.stopAutoRefresh();
      vi.useRealTimers();
    }
  });
});

describe('pickMaterialForReply', () => {
  const video: MaterialItem = {
    id: 'obs-1',
    source: 'bilibili',
    kind: 'video',
    title: '关羽对线教程',
    creator: '某UP',
    url: 'https://www.bilibili.com/video/BV1xx',
    coverUrl: 'https://example.test/cover.jpg',
    discoveredAt: '2026-10-25T06:00:00.000Z',
  };
  const song: MaterialItem = {
    id: 'obs-2',
    source: 'netease',
    kind: 'song',
    title: '夜曲',
    creator: '周杰伦',
    url: 'https://music.163.com/song?id=1',
    coverUrl: null,
    discoveredAt: '2026-10-25T06:00:00.000Z',
  };

  it('attaches the entry whose title the reply repeated', () => {
    expect(pickMaterialForReply([video, song], '看到一个关羽对线教程。')).toEqual(video);
  });

  it('matches short song titles', () => {
    expect(pickMaterialForReply([song], '听这首夜曲吧。')).toEqual(song);
  });

  it('returns null when the reply does not mention any title', () => {
    expect(pickMaterialForReply([video, song], '嗯，我在。')).toBeNull();
    expect(pickMaterialForReply([], '关羽对线教程')).toBeNull();
  });

  it('ignores entries without a shareable url', () => {
    const noUrl = { ...video, url: null };
    expect(pickMaterialForReply([noUrl], '关羽对线教程')).toBeNull();
  });

  it('stays case and whitespace insensitive', () => {
    const spaced = { ...video, title: 'Guan Yu Guide' };
    expect(pickMaterialForReply([spaced], '这个guanyuguide不错')).toEqual(spaced);
  });

  it('attaches when the reply quotes the BV id instead of the title', () => {
    expect(pickMaterialForReply([video], '给你：BV1xx，自己去看')).toEqual(video);
  });
});
