/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { createPluginEventSink } from './pluginEvents';

const dirs: string[] = [];
const databases: Phase2Database[] = [];

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-plugin-events-'));
  dirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  const repos = createPhase2Repositories(db);
  return { repos };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    closePhase2Database(db);
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function bilibiliPayload() {
  return {
    platform: 'bilibili',
    conversationId: 'bilibili:feed:2026-10-25',
    conversationKind: 'public',
    actorId: '42',
    actorName: '某UP',
    isSelf: false,
    kind: 'video_watch',
    content: '推荐：测试视频',
    media: [{ kind: 'image', url: 'https://example.test/cover.jpg' }],
    occurredAt: '2026-10-25T04:00:00.000Z',
    receivedAt: '2026-10-25T05:00:00.000Z',
    provenance: 'agent',
    audience: 'private',
    trust: 0.5,
    retention: 'normal',
    raw: { bvid: 'BV1' },
    dedupeKey: 'bilibili:rcmd:BV1:2026-10-25',
  };
}

describe('plugin event sink', () => {
  it('persists an observation reported by a plugin', async () => {
    const { repos } = setup();
    const sink = createPluginEventSink({ repos });

    await sink('bilibili', { type: 'observation', payload: bilibiliPayload() });

    const observations = repos.observations.listRecent({ platform: 'bilibili', limit: 5 });
    expect(observations).toHaveLength(1);
    expect(observations[0].content).toBe('推荐：测试视频');
    expect(observations[0].dedupeKey).toBe('bilibili:rcmd:BV1:2026-10-25');
  });

  it('dedupes repeated observations by dedupeKey', async () => {
    const { repos } = setup();
    const sink = createPluginEventSink({ repos });
    const payload = bilibiliPayload();

    await sink('bilibili', { type: 'observation', payload });
    const second = await sink('bilibili', { type: 'observation', payload });

    // insert() returns false when the dedupeKey was seen before.
    expect(second).toBeUndefined();
    expect(repos.observations.listRecent({ platform: 'bilibili', limit: 5 })).toHaveLength(1);
  });

  it('generates a reply for a replyable channel message and sends it back', async () => {
    const { repos } = setup();
    const onChannelMessage = vi.fn().mockResolvedValue('在。');
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const sink = createPluginEventSink({ repos, onChannelMessage, sendReply });

    await sink('qq', {
      type: 'channel.message',
      payload: {
        ...bilibiliPayload(),
        platform: 'qq',
        conversationId: 'group-openid',
        conversationKind: 'group',
        kind: 'message',
        audience: 'group',
        provenance: 'untrusted',
        msgId: 'msg-1',
        shouldReply: true,
      },
    });

    expect(onChannelMessage).toHaveBeenCalledWith('qq', expect.objectContaining({
      conversationId: 'group-openid',
      conversationKind: 'group',
      msgId: 'msg-1',
      content: '推荐：测试视频',
    }));
    expect(sendReply).toHaveBeenCalledWith('qq', expect.objectContaining({ msgId: 'msg-1' }), '在。');
    expect(repos.observations.listRecent({ platform: 'qq', limit: 5 })).toHaveLength(1);
  });

  it('stays silent when the plugin marks the message as not replyable', async () => {
    const { repos } = setup();
    const onChannelMessage = vi.fn().mockResolvedValue('在。');
    const sink = createPluginEventSink({ repos, onChannelMessage });

    await sink('qq', {
      type: 'channel.message',
      payload: {
        ...bilibiliPayload(),
        platform: 'qq',
        conversationId: 'group-openid',
        conversationKind: 'group',
        kind: 'message',
        audience: 'group',
        provenance: 'untrusted',
        msgId: 'msg-2',
        shouldReply: false,
      },
    });

    expect(onChannelMessage).not.toHaveBeenCalled();
  });

  it('rejects an observation payload missing required fields', async () => {
    const { repos } = setup();
    const sink = createPluginEventSink({ repos });

    await expect(sink('bilibili', { type: 'observation', payload: { platform: 'bilibili' } }))
      .rejects.toThrow(/conversation/);
    expect(repos.observations.listRecent({ platform: 'bilibili', limit: 5 })).toHaveLength(0);
  });

  it('rejects unknown event types', async () => {
    const { repos } = setup();
    const sink = createPluginEventSink({ repos });

    await expect(sink('qq', { type: 'channel.message' as never, payload: {} as Record<string, unknown> }))
      .rejects.toThrow();
  });
});
