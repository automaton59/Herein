/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { loadQQBotConfig, startQQListener, type QQListenerHandlers } from './qqListener';

const dirs: string[] = [];
const databases: Phase2Database[] = [];

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-qq-'));
  dirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  return { dir, repos: createPhase2Repositories(db) };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    closePhase2Database(db);
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('qq listener', () => {
  it('loads and validates the private qqbot.json', async () => {
    const { dir } = setup();
    const file = path.join(dir, 'qqbot.json');
    writeFileSync(file, JSON.stringify({
      appId: 'app-1',
      appSecret: 'secret-1',
      mode: 'websocket',
    }));

    await expect(loadQQBotConfig(file)).resolves.toEqual({
      appId: 'app-1',
      appSecret: 'secret-1',
      mode: 'websocket',
      devTestUsers: undefined,
    });
  });

  it('connects a gateway and writes normalized group messages to observations', async () => {
    const { repos } = setup();
    let handlers: QQListenerHandlers | null = null;
    const gateway = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const client = {
      sendGroupMessage: vi.fn().mockResolvedValue({ id: 'sent-1' }),
      sendC2CMessage: vi.fn().mockResolvedValue({ id: 'sent-2' }),
    };

    const listener = await startQQListener({
      repos,
      config: { appId: 'app-1', appSecret: 'secret-1' },
      client,
      responder: async () => '在。',
      gatewayFactory: input => {
        handlers = input;
        return gateway;
      },
    });

    expect(gateway.connect).toHaveBeenCalledTimes(1);
    handlers!.onEvent({
      id: 'event-1',
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'msg-1',
        group_openid: 'group-1',
        content: '今天好累。',
        timestamp: '2026-10-21T12:00:00.000Z',
        author: { id: 'member-1', username: '蓝蓝' },
      },
    });

    const observations = repos.observations.listRecent({ platform: 'qq' });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual(expect.objectContaining({
      conversationId: 'group-1',
      conversationKind: 'group',
      content: '今天好累。',
      audience: 'group',
      provenance: 'untrusted',
    }));

    handlers!.onEvent({
      id: 'event-2',
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'msg-2',
        group_openid: 'group-1',
        content: '@蓝蓝 在吗',
        author: { id: 'member-1', username: '蓝蓝' },
      },
    });

    await vi.waitFor(() => {
      expect(client.sendGroupMessage).toHaveBeenCalledWith('group-1', '在。', 'msg-2');
    });

    listener.stop();
    expect(gateway.close).toHaveBeenCalledTimes(1);
  });
});
