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
});
