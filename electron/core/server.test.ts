/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCoreServer, type CoreServerHandle } from './server';

const tempDirs: string[] = [];
const handles: CoreServerHandle[] = [];

function createDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-core-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function start() {
  const handle = await startCoreServer({
    host: '127.0.0.1',
    port: 0,
    dataDir: createDataDir(),
  });
  handles.push(handle);
  return handle;
}

function url(handle: CoreServerHandle, pathname: string) {
  return `http://127.0.0.1:${handle.port}${pathname}`;
}

async function getJson(handle: CoreServerHandle, pathname: string, init?: RequestInit) {
  const response = await fetch(url(handle, pathname), init);
  return { status: response.status, body: await response.json() };
}

async function postJson(handle: CoreServerHandle, pathname: string, body: unknown, init?: RequestInit) {
  const response = await fetch(url(handle, pathname), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
  return { status: response.status, body: await response.json() };
}

async function patchJson(handle: CoreServerHandle, pathname: string, body: unknown) {
  const response = await fetch(url(handle, pathname), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('core server', () => {
  it('serves health and syncs a timeline through HTTP', async () => {
    const handle = await start();

    const health = await getJson(handle, '/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual(expect.objectContaining({
      ok: true,
      name: 'herein-core',
      version: '0.1.0',
    }));

    const characters = await getJson(handle, '/v1/characters');
    expect(characters.body.characters).toEqual([
      expect.objectContaining({ id: 'herein-default' }),
    ]);

    const before = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(before.status).toBe(200);
    const timeline = before.body.timeline;
    expect(before.body.messages).toEqual([]);

    const sync = await postJson(handle, '/v1/timeline/herein-default/sync', {
      title: '测试聊天',
      messages: [
        {
          id: 'msg-1',
          timelineId: timeline.id,
          role: 'user',
          content: '在吗',
          timestamp: '2026-10-21T12:00:00.000Z',
        },
        {
          id: 'msg-2',
          timelineId: timeline.id,
          role: 'assistant',
          content: '在。',
          timestamp: '2026-10-21T12:00:01.000Z',
        },
      ],
    });

    expect(sync.status).toBe(200);
    expect(sync.body.result).toEqual({ inserted: 2, updated: 0, deleted: 0 });
    expect(sync.body.timeline.title).toBe('测试聊天');

    const after = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(after.body.messages.map((message: { id: string }) => message.id)).toEqual(['msg-1', 'msg-2']);
    expect(after.body.timeline.title).toBe('测试聊天');
  });

  it('only prunes later messages when the client explicitly asks for it', async () => {
    const handle = await start();
    const before = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    const timeline = before.body.timeline;
    const messages = [
      {
        id: 'prune-1',
        timelineId: timeline.id,
        role: 'user',
        content: '一',
        timestamp: '2026-10-22T12:00:00.000Z',
      },
      {
        id: 'prune-2',
        timelineId: timeline.id,
        role: 'assistant',
        content: '二',
        timestamp: '2026-10-22T12:00:01.000Z',
      },
    ];

    await postJson(handle, '/v1/timeline/herein-default/sync', { messages });

    const safeSnapshot = await postJson(handle, '/v1/timeline/herein-default/sync', {
      messages: [messages[0]],
    });
    expect(safeSnapshot.body.result).toEqual({ inserted: 0, updated: 0, deleted: 0 });

    const afterSafe = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(afterSafe.body.messages.map((message: { id: string }) => message.id)).toEqual([
      'prune-1',
      'prune-2',
    ]);

    const pruned = await postJson(handle, '/v1/timeline/herein-default/sync', {
      messages: [messages[0]],
      prune: true,
    });
    expect(pruned.body.result).toEqual({ inserted: 0, updated: 0, deleted: 1 });
  });

  it('applies incremental upserts and explicit deletes without pruning other messages', async () => {
    const handle = await start();
    const before = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    const timeline = before.body.timeline;
    const messages = [
      { id: 'apply-1', timelineId: timeline.id, role: 'user', content: '一', timestamp: '2026-10-22T12:00:00.000Z' },
      { id: 'apply-2', timelineId: timeline.id, role: 'assistant', content: '二', timestamp: '2026-10-22T12:00:01.000Z' },
      { id: 'apply-3', timelineId: timeline.id, role: 'user', content: '三', timestamp: '2026-10-22T12:00:02.000Z' },
    ];
    await postJson(handle, '/v1/timeline/herein-default/sync', { messages });

    const applied = await postJson(handle, '/v1/timeline/herein-default/apply', {
      upserts: [{ ...messages[0], content: '一改' }],
      deletes: ['apply-2'],
      title: '增量',
    });
    expect(applied.status).toBe(200);
    expect(applied.body.result).toEqual({ inserted: 0, updated: 1, deleted: 1 });

    const after = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(after.body.messages.map((message: { id: string; content: string }) => [message.id, message.content]))
      .toEqual([
        ['apply-1', '一改'],
        ['apply-3', '三'],
      ]);
    expect(after.body.timeline.title).toBe('增量');
  });

  it('chats through the LLM gateway and persists the turn', async () => {
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: '在。' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      llmConfig: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'fake-model',
      },
      llmFetch,
    });
    handles.push(handle);

    const chat = await postJson(handle, '/v1/chat', {
      characterId: 'herein-default',
      messages: [{ role: 'user', content: '在吗' }],
    });

    expect(chat.status).toBe(200);
    expect(chat.body.message).toEqual({ role: 'assistant', content: '在。' });
    expect(chat.body.model).toBe('fake-model');
    expect(chat.body.persisted).toBe(true);
    expect(llmFetch).toHaveBeenCalledTimes(1);

    const messages = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(messages.body.messages.map((message: { content: string }) => message.content)).toEqual([
      '在吗',
      '在。',
    ]);
  });

  it('tracks read state per character', async () => {
    const handle = await start();

    const initial = await getJson(handle, '/v1/read-state/herein-default');
    expect(initial.status).toBe(200);
    expect(initial.body.readState).toEqual(expect.objectContaining({
      characterId: 'herein-default',
      lastReadMessageId: null,
    }));

    const updated = await postJson(handle, '/v1/read-state/herein-default', {
      lastReadMessageId: 'msg-1',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.readState).toEqual(expect.objectContaining({
      characterId: 'herein-default',
      lastReadMessageId: 'msg-1',
      lastReadAt: expect.any(String),
    }));

    const read = await getJson(handle, '/v1/read-state/herein-default');
    expect(read.body.readState.lastReadMessageId).toBe('msg-1');
  });

  it('deduplicates a retried chat by clientMessageId', async () => {
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: '在。' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      llmConfig: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'fake-model',
      },
      llmFetch,
      memory: { enabled: false },
    });
    handles.push(handle);

    const body = {
      characterId: 'herein-default',
      clientMessageId: 'offline-1',
      messages: [{ role: 'user', content: '在吗' }],
    };
    const first = await postJson(handle, '/v1/chat', body);
    const second = await postJson(handle, '/v1/chat', body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.message).toEqual(first.body.message);
    expect(llmFetch).toHaveBeenCalledTimes(1);

    const messages = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(messages.body.messages).toHaveLength(2);
  });

  it('runs the initiative engine through Core HTTP', async () => {
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            shouldSpeak: true,
            reason: '有具体内容',
            message: '刚看到个东西，想起你。',
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      llmConfig: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'fake-model',
      },
      llmFetch,
      memory: { enabled: false },
      initiative: {
        quietHours: { start: '00:00', end: '00:00' },
        minIdleMs: 0,
      },
    });
    handles.push(handle);

    const before = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    const timeline = before.body.timeline;
    await postJson(handle, '/v1/timeline/herein-default/sync', {
      messages: [{
        id: 'initiative-user-1',
        timelineId: timeline.id,
        role: 'user',
        content: '今天有点累。',
        timestamp: '2026-10-22T10:00:00.000Z',
      }],
    });

    const run = await postJson(handle, '/v1/initiative/run', {
      characterId: 'herein-default',
    });
    expect(run.status).toBe(200);
    expect(run.body).toEqual(expect.objectContaining({
      status: 'spoke',
      message: '刚看到个东西，想起你。',
    }));

    const after = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(after.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: '刚看到个东西，想起你。',
        sourceConversationId: 'initiative',
      }),
    ]));
  });

  it('runs the memory pipeline in Core after a timeline sync', async () => {
    const memoryJson = JSON.stringify({
      conversationSummary: '用户最近在忙项目。',
      memoryItems: [{
        kind: 'preference',
        scope: 'character',
        content: '用户喜欢短句回复。',
        confidence: 0.8,
        sourceMessageIds: ['sync-1'],
      }],
    });
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: memoryJson } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      llmConfig: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'fake-model',
      },
      llmFetch,
      memory: { enabled: true, triggerMessageCount: 20 },
    });
    handles.push(handle);

    const before = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    const timeline = before.body.timeline;
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `sync-${index + 1}`,
      timelineId: timeline.id,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `消息 ${index + 1}`,
      timestamp: `2026-10-22T12:00:${String(index).padStart(2, '0')}.000Z`,
    }));

    const synced = await postJson(handle, '/v1/timeline/herein-default/sync', {
      title: '记忆测试',
      messages,
    });
    expect(synced.status).toBe(200);

    let memories: Array<{ content: string; origin: string }> = [];

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const listed = await getJson(handle, '/v1/memory?characterId=herein-default');
      memories = listed.body.memories;
      if (memories.length > 0) {
        break;
      }
    }

    expect(llmFetch).toHaveBeenCalled();
    expect(memories).toEqual([
      expect.objectContaining({
        content: '用户喜欢短句回复。',
        origin: 'summary',
      }),
    ]);
  });

  it('stores and lists observations with audience/provenance', async () => {
    const handle = await start();

    const created = await postJson(handle, '/v1/observations', {
      id: 'obs-1',
      platform: 'qq',
      conversationId: 'group-1',
      conversationKind: 'group',
      actorId: 'member-1',
      actorName: '蓝蓝',
      kind: 'message',
      content: '今天好累。',
      occurredAt: '2026-10-21T12:00:00.000Z',
      receivedAt: '2026-10-21T12:00:01.000Z',
      provenance: 'owner',
      audience: 'group',
      trust: 0.9,
      dedupeKey: 'qq:group-1:obs-1',
    });

    expect(created.status).toBe(201);
    expect(created.body.inserted).toBe(true);

    const listed = await getJson(handle, '/v1/observations?platform=qq&conversationId=group-1');
    expect(listed.body.observations).toEqual([
      expect.objectContaining({
        id: 'obs-1',
        actorName: '蓝蓝',
        audience: 'group',
        provenance: 'owner',
      }),
    ]);
  });

  it('returns NetEase song candidates as content profiles', async () => {
    const neteaseSource = {
      search: vi.fn().mockResolvedValue({
        songs: [{ id: 1, name: '夜曲', ar: [{ name: '周杰伦' }] }],
      }),
      toplists: vi.fn().mockResolvedValue([]),
      playlist: vi.fn().mockResolvedValue(null),
    };
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      neteaseSource,
    });
    handles.push(handle);

    const response = await postJson(handle, '/v1/netease/candidates', {
      query: '周杰伦',
      limit: 3,
    });

    expect(response.status).toBe(200);
    expect(response.body.candidates).toEqual([
      expect.objectContaining({
        type: 'song',
        itemId: '1',
        title: '夜曲',
        creator: '周杰伦',
      }),
    ]);
  });

  it('returns a content recommendation through the Core LLM gateway', async () => {
    const dataDir = createDataDir();
    const promptPath = path.join(dataDir, 'recommend.md');
    writeFileSync(promptPath, 'ctx={{context}} cand={{candidates_json}} taste={{taste}}');
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"shouldRecommend":true,"type":"song","itemId":"song-1","reason":"适合现在","confidence":0.8}',
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test-model' },
      llmFetch,
      contentPromptPath: promptPath,
    });
    handles.push(handle);

    const response = await postJson(handle, '/v1/recommend', {
      context: '想听点安静的',
      candidates: [{ id: 'song-1' }],
      taste: { night: true },
      gate: {
        now: '2026-10-21T12:00:00.000Z',
        itemId: 'song-1',
        turnsSinceLast: 20,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.decision).toEqual({
      shouldRecommend: true,
      type: 'song',
      itemId: 'song-1',
      reason: '适合现在',
      confidence: 0.8,
    });
    expect(llmFetch).toHaveBeenCalledTimes(1);

    const blocked = await postJson(handle, '/v1/recommend', {
      context: '再推荐一首',
      candidates: [{ itemId: 'song-1', title: '歌' }],
    });
    expect(blocked.status).toBe(200);
    expect(blocked.body.decision).toEqual({ shouldRecommend: false });
    expect(blocked.body.blockedByGate).toContain('cooldown');
    expect(llmFetch).toHaveBeenCalledTimes(1);

    const feedback = await postJson(handle, '/v1/recommend/feedback', {
      itemId: 'song-1',
      feedback: 'like',
    });
    expect(feedback.status).toBe(200);
    expect(feedback.body.updated).toBe(true);

    const events = await getJson(handle, '/v1/recommendations?limit=5');
    expect(events.body.events).toEqual([
      expect.objectContaining({
        itemId: 'song-1',
        itemType: 'song',
        feedback: 'like',
      }),
    ]);
  });

  it('runs a proactive share through the Core scheduler', async () => {
    const dataDir = createDataDir();
    const promptPath = path.join(dataDir, 'share.md');
    writeFileSync(promptPath, 'ctx={{context}} cand={{candidates_json}}');
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"shouldRecommend":true,"type":"song","itemId":"1","reason":"这个好听。","confidence":0.8}',
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const neteaseSource = {
      search: vi.fn().mockResolvedValue({ songs: [{ id: 1, name: '夜曲', ar: [{ name: '周杰伦' }] }] }),
      toplists: vi.fn().mockResolvedValue([]),
      playlist: vi.fn().mockResolvedValue(null),
    };
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test-model' },
      llmFetch,
      neteaseSource,
      contentPromptPath: promptPath,
      proactiveShare: { enabled: true, intervalMs: 90 * 60 * 1000 },
    });
    handles.push(handle);

    const response = await postJson(handle, '/v1/proactive/share/run', {});
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      status: 'shared',
      song: expect.objectContaining({ itemId: '1', title: '夜曲', shareLine: '这个好听。' }),
    }));

    const events = await getJson(handle, '/v1/recommendations?limit=5');
    expect(events.body.events).toHaveLength(1);
  });

  it('scans a Bilibili feed into observations and an activity session', async () => {
    const source = {
      getRcmd: vi.fn().mockResolvedValue({
        item: [{ bvid: 'BV1xx411c7mD', title: '测试视频', owner: { mid: 1, name: 'UP' } }],
      }),
    };
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      bilibiliSource: source,
    });
    handles.push(handle);

    const scan = await postJson(handle, '/v1/bilibili/scan', { limit: 5 });
    expect(scan.status).toBe(200);
    expect(scan.body).toEqual(expect.objectContaining({ fetched: 1, inserted: 1 }));

    const activity = await getJson(handle, '/v1/activity?limit=5');
    expect(activity.body.sessions[0]).toEqual(expect.objectContaining({
      kind: 'bilibili_feed',
      status: 'completed',
      stats: { fetched: 1, inserted: 1, skipped: 0 },
    }));

    const observations = await getJson(handle, '/v1/observations?platform=bilibili');
    expect(observations.body.observations).toHaveLength(1);
    expect(observations.body.observations[0].content).toContain('测试视频');
  });

  it('serves Live2D assets without an authorization header', async () => {
    const dataDir = createDataDir();
    const assetsDir = path.join(dataDir, 'assets');
    mkdirSync(path.join(assetsDir, 'live2d'), { recursive: true });
    writeFileSync(path.join(assetsDir, 'live2d', 'model.json'), JSON.stringify({ ok: true }));
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      assetsDir,
      token: 'secret-token',
    });
    handles.push(handle);

    const asset = await fetch(url(handle, '/assets/live2d/model.json'));
    expect(asset.status).toBe(200);
    expect(await asset.json()).toEqual({ ok: true });
  });

  it('proxies TTS audio from the local service', async () => {
    const ttsFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    })) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      ttsUrl: 'http://tts.test',
      ttsFetch,
    });
    handles.push(handle);

    const response = await fetch(url(handle, '/v1/tts'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '在吗', emotion: 'neutral' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(ttsFetch).toHaveBeenCalledTimes(1);
  });

  it('requires a bearer token when configured', async () => {
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      token: 'secret-token',
    });
    handles.push(handle);

    const unauthorized = await getJson(handle, '/health');
    expect(unauthorized.status).toBe(401);

    const authorized = await getJson(handle, '/health', {
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(authorized.status).toBe(200);
  });

  it('reports the relay health when configured', async () => {
    const relayFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer relay-token',
      }));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      relayUrl: 'http://relay.test/herein',
      relayToken: 'relay-token',
      relayFetch,
    });
    handles.push(handle);

    const status = await getJson(handle, '/v1/status');
    expect(status.body.components.relay).toEqual(expect.objectContaining({
      status: 'ok',
      latencyMs: expect.any(Number),
    }));
    expect(relayFetch).toHaveBeenCalledTimes(1);
  });

  it('exposes agent providers and delegates lifecycle operations', async () => {
    const provider = {
      id: 'dsh',
      name: 'DSH',
      async listCapabilities() {
        return [{
          providerId: 'dsh',
          id: 'hello',
          name: 'Hello',
          version: '1.0.0',
          permissions: [],
          health: { status: 'ok' as const, checkedAt: '2026-10-22T12:00:00.000Z' },
        }];
      },
      async install(capabilityId: string) {
        return { providerId: 'dsh', capabilityId, status: 'applied' as const };
      },
      async enable(capabilityId: string) {
        return { providerId: 'dsh', capabilityId, status: 'applied' as const };
      },
      async disable(capabilityId: string) {
        return { providerId: 'dsh', capabilityId, status: 'applied' as const };
      },
      async remove(capabilityId: string) {
        return { providerId: 'dsh', capabilityId, status: 'applied' as const };
      },
      async health() {
        return { status: 'ok' as const, checkedAt: '2026-10-22T12:00:00.000Z' };
      },
      async invoke(capabilityId: string, action: string, input: unknown) {
        return { capabilityId, action, input };
      },
    };
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      agentProviders: [provider],
    });
    handles.push(handle);

    const listed = await getJson(handle, '/v1/agents');
    expect(listed.status).toBe(200);
    expect(listed.body.providers[0]).toEqual(expect.objectContaining({ id: 'dsh' }));
    expect(listed.body.capabilities[0]).toEqual(expect.objectContaining({ id: 'hello' }));

    const installed = await postJson(handle, '/v1/agents/dsh/hello/install', {});
    expect(installed.body).toEqual(expect.objectContaining({ status: 'applied', capabilityId: 'hello' }));

    const invoked = await postJson(handle, '/v1/agents/dsh/hello/invoke', {
      action: 'ping',
      input: { n: 1 },
    });
    expect(invoked.body.result).toEqual({
      capabilityId: 'hello',
      action: 'ping',
      input: { n: 1 },
    });

    const status = await getJson(handle, '/v1/status');
    expect(status.body.components.agents).toEqual(expect.objectContaining({
      status: 'ok',
      detail: expect.objectContaining({ providers: 1, capabilities: 1 }),
    }));
  });

  it('exposes status and manages the weather plugin end to end', async () => {
    const pluginFetch = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = String(input);

      if (requestUrl.startsWith('https://geocoding-api.open-meteo.com/')) {
        return new Response(JSON.stringify({
          results: [{ name: '杭州', country: '中国', latitude: 30.2741, longitude: 120.1551 }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (requestUrl.startsWith('https://api.open-meteo.com/')) {
        return new Response(JSON.stringify({
          current: {
            temperature_2m: 22.3,
            apparent_temperature: 21.1,
            relative_humidity_2m: 70,
            wind_speed_10m: 8.2,
            weather_code: 61,
            time: '2026-10-22T20:00',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const ttsFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      pluginsDir: path.resolve(process.cwd(), 'plugins'),
      pluginFetch,
      ttsUrl: 'http://tts.test',
      ttsFetch,
      llmConfig: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'fake-model',
      },
    });
    handles.push(handle);

    const status = await getJson(handle, '/v1/status');
    expect(status.status).toBe(200);
    expect(status.body.components).toEqual(expect.objectContaining({
      core: expect.objectContaining({ status: 'ok' }),
      db: expect.objectContaining({ status: 'ok' }),
      llm: expect.objectContaining({ status: 'ok' }),
      tts: expect.objectContaining({ status: 'ok' }),
      plugins: expect.objectContaining({ status: 'ok' }),
    }));

    const listed = await getJson(handle, '/v1/plugins');
    expect(listed.body.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'weather', kind: 'tool' }),
        installed: false,
      }),
    ]));

    const installed = await postJson(handle, '/v1/plugins/install', { id: 'weather' });
    expect(installed.status).toBe(200);
    expect(installed.body.plugin).toEqual(expect.objectContaining({ installed: true }));

    const configured = await patchJson(handle, '/v1/plugins/weather/config', {
      config: { city: '杭州' },
    });
    expect(configured.status).toBe(200);
    expect(configured.body.plugin.config).toEqual(expect.objectContaining({ city: '杭州' }));

    const enabled = await postJson(handle, '/v1/plugins/weather/enable', {});
    expect(enabled.status).toBe(200);
    expect(enabled.body.plugin.enabled).toBe(true);

    const invoked = await postJson(handle, '/v1/plugins/weather/invoke', {
      action: 'current',
    });
    expect(invoked.status).toBe(200);
    expect(invoked.body.result).toEqual(expect.objectContaining({
      current: expect.objectContaining({
        weather: '小雨',
        temperatureC: 22.3,
      }),
    }));

    const audit = await getJson(handle, '/v1/plugins/audit?limit=20');
    expect(audit.body.audit.map((entry: { action: string }) => entry.action))
      .toEqual(expect.arrayContaining(['install', 'config', 'enable', 'invoke:current']));

    const disabled = await postJson(handle, '/v1/plugins/weather/disable', {});
    expect(disabled.body.plugin.enabled).toBe(false);

    const removed = await fetch(url(handle, '/v1/plugins/weather'), { method: 'DELETE' });
    expect(removed.status).toBe(200);

    const after = await getJson(handle, '/v1/plugins');
    expect(after.body.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'weather' }),
        installed: false,
      }),
    ]));
  });
});
