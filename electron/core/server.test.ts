/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonaPack } from '../persona/loader';
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

  it('clears a timeline, its summary and its open loops on request', async () => {
    const handle = await start();
    const before = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    const timeline = before.body.timeline;

    await postJson(handle, '/v1/timeline/herein-default/sync', {
      messages: [
        { id: 'clear-1', timelineId: timeline.id, role: 'user', content: '一', timestamp: '2026-10-22T12:00:00.000Z' },
        { id: 'clear-2', timelineId: timeline.id, role: 'assistant', content: '二', timestamp: '2026-10-22T12:00:01.000Z' },
      ],
    });

    const cleared = await fetch(url(handle, '/v1/timeline/herein-default/messages'), {
      method: 'DELETE',
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual(expect.objectContaining({ ok: true, deleted: 2 }));

    const after = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(after.body.messages).toEqual([]);
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
    expect(chat.body.message).toEqual(expect.objectContaining({
      role: 'assistant',
      content: '在',
      bubbles: [expect.objectContaining({ text: '在' })],
    }));
    expect(chat.body.model).toBe('fake-model');
    expect(chat.body.persisted).toBe(true);
    expect(llmFetch).toHaveBeenCalledTimes(1);

    const messages = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(messages.body.messages.map((message: { content: string }) => message.content)).toEqual([
      '在吗',
      '在',
    ]);
  });

  it('compiles a persona pack into the core chat prompt', async () => {
    const prompts: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const llmFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      prompts.push(JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> });
      return new Response(JSON.stringify({
        model: 'fake-model',
        choices: [{ message: { role: 'assistant', content: '在。' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const pack: PersonaPack = {
      manifest: {
        schemaVersion: 1,
        id: 'herein-default',
        version: '1.0.0',
        engine: '>=0.1.0',
        character: 'character.json',
        templates: [],
      },
      character: {
        schemaVersion: 1,
        id: 'herein-default',
        name: '测试角色',
        nickname: '小测',
        relationshipFrame: '朋友',
        personality: { core: ['稳定'] },
        speakingStyle: { defaultAddress: '你' },
      },
      templates: new Map([
        ['safety_identity', { ref: { id: 'safety_identity', layer: 'L0_safety_identity', file: 'safety.md' }, text: '【身份】{{character_name}}' }],
        ['character_core', { ref: { id: 'character_core', layer: 'L1_character_core', file: 'core.md' }, text: '【人格】{{nickname}}' }],
        ['chat_behavior', { ref: { id: 'chat_behavior', layer: 'L5_task', file: 'chat.md' }, text: '【行为】{{character_name}}' }],
      ]),
      root: 'test',
    };
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
      personaPacks: new Map([['herein-default', pack]]),
      memory: { enabled: false },
    });
    handles.push(handle);

    const chat = await postJson(handle, '/v1/chat', {
      characterId: 'herein-default',
      messages: [{ role: 'user', content: '在吗' }],
    });

    expect(chat.status).toBe(200);
    expect(chat.body.message).toEqual(expect.objectContaining({
      role: 'assistant',
      content: '在',
      bubbles: [expect.objectContaining({ text: '在' })],
    }));

    const system = prompts[0].messages[0].content;
    expect(system).toContain('【身份】测试角色');
    expect(system).toContain('【人格】小测');
    expect(system).toContain('【行为】测试角色');
    expect(system).not.toContain('【回复形态】');
  });

  it('stays silent without calling the model when the user asks for quiet', async () => {
    const llmFetch = vi.fn(async () => new Response('{}')) as typeof fetch;
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

    const chat = await postJson(handle, '/v1/chat', {
      characterId: 'herein-default',
      messages: [{ role: 'user', content: '别说话了，让我静静。' }],
    });

    expect(chat.status).toBe(200);
    expect(chat.body).toEqual(expect.objectContaining({
      silent: true,
      presence: expect.objectContaining({ notice: '在听' }),
      persisted: true,
    }));
    expect(llmFetch).not.toHaveBeenCalled();

    const timeline = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(timeline.body.messages).toEqual([
      expect.objectContaining({ role: 'user', content: '别说话了，让我静静。' }),
    ]);
  });

  it('shapes a model reply into two bubbles and filters AI-isms', async () => {
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{
        message: {
          role: 'assistant',
          content: '作为一个AI，我希望能帮到你。诶？|今天几点睡的？',
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
    });
    handles.push(handle);

    const chat = await postJson(handle, '/v1/chat', {
      characterId: 'herein-default',
      messages: [{ role: 'user', content: '在吗' }],
    });

    expect(chat.status).toBe(200);
    expect(chat.body.message.content).toBe('诶？\n今天几点睡的？');
    expect(chat.body.message.bubbles).toEqual([
      expect.objectContaining({ text: '诶？' }),
      expect.objectContaining({ text: '今天几点睡的？' }),
    ]);
    expect(chat.body.message.content).not.toContain('AI');
  });

  it('honors a model-chosen silent marker', async () => {
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: '<silent/>' } }],
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

    const chat = await postJson(handle, '/v1/chat', {
      characterId: 'herein-default',
      messages: [{ role: 'user', content: '今天有点累。' }],
    });

    expect(chat.body).toEqual(expect.objectContaining({ silent: true }));
    const timeline = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(timeline.body.messages.filter((message: { role: string }) => message.role === 'assistant'))
      .toHaveLength(0);
  });

  it('feeds fresh Bilibili material into chat when the user asks', async () => {
    const prompts: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const llmFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      prompts.push(JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> });
      return new Response(JSON.stringify({
        model: 'fake-model',
        choices: [{ message: { role: 'assistant', content: '看到一个关羽对线教程。' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const getRcmd = vi.fn(async () => ({
      item: [{
        bvid: 'BV1xx',
        title: '关羽对线教程',
        owner: { mid: 1, name: '某UP' },
        cover: 'https://example.test/cover.jpg',
      }],
    }));
    const bilibiliModule = {
      BilibiliClient: class {
        getRcmd = getRcmd;
      },
    };
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
      appRoot: '/unused',
      bundledModules: { 'adapters/bilibili/dist/index.js': bilibiliModule },
      materialsAuto: { enabled: false },
      memory: { enabled: false },
    });
    handles.push(handle);

    expect((await postJson(handle, '/v1/plugins/install', { id: 'bilibili' })).status).toBe(200);
    expect((await postJson(handle, '/v1/plugins/bilibili/enable', {})).status).toBe(200);

    const chat = await postJson(handle, '/v1/chat', {
      characterId: 'herein-default',
      messages: [{ role: 'user', content: 'b 站有什么好玩的' }],
    });

    expect(chat.status).toBe(200);
    expect(getRcmd).toHaveBeenCalled();
    const system = prompts[0].messages[0].content;
    expect(system).toContain('【她刚翻到的】');
    expect(system).toContain('关羽对线教程');
    // Her reply repeated the title the block fed her, so the card rides along.
    expect(chat.body.message.material).toEqual(expect.objectContaining({
      kind: 'video',
      source: 'bilibili',
      title: '关羽对线教程',
      creator: '某UP',
      url: 'https://www.bilibili.com/video/BV1xx',
    }));
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
      summary: '用户最近在忙项目。',
      openLoops: [],
      ops: [{
        op: 'assert',
        subject: 'user',
        kind: 'preference',
        predicate: 'reply_style',
        content: '用户喜欢短句回复。',
        confidence: 0.8,
        importance: 6,
        evidence: ['sync-1'],
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
        origin: 'agent',
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
      actorName: '小蓝',
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
        actorName: '小蓝',
        audience: 'group',
        provenance: 'owner',
      }),
    ]);
  });

  it('returns NetEase song candidates as content profiles', async () => {
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      appRoot: '/unused',
      bundledModules: {
        'adapters/netease/dist/index.js': {
          NeteaseClient: class {
            async search() {
              return { songs: [{ id: 1, name: '夜曲', ar: [{ name: '周杰伦' }] }] };
            }

            async toplists() {
              return [];
            }

            async playlist() {
              return null;
            }
          },
        },
        'packages/core/dist/index.js': {
          buildSongProfile: (song: { id: number; name: string; artists?: Array<{ name: string }> }) => ({
            type: 'song',
            itemId: String(song.id),
            title: song.name,
            creator: song.artists?.[0]?.name,
          }),
          uniqueProfiles: (profiles: unknown[]) => profiles,
        },
      },
    });
    handles.push(handle);

    expect((await postJson(handle, '/v1/plugins/install', { id: 'netease' })).status).toBe(200);
    expect((await postJson(handle, '/v1/plugins/netease/enable', {})).status).toBe(200);

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
    const neteaseModule = {
      NeteaseClient: class {
        async search() {
          return { songs: [{ id: 1, name: '夜曲', ar: [{ name: '周杰伦' }] }] };
        }

        async toplists() {
          return [];
        }

        async playlist() {
          return null;
        }
      },
    };
    const coreModule = {
      buildSongProfile: (song: { id: number; name: string; artists?: Array<{ name: string }> }) => ({
        type: 'song',
        itemId: String(song.id),
        title: song.name,
        creator: song.artists?.[0]?.name,
      }),
      uniqueProfiles: (profiles: unknown[]) => profiles,
    };
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test-model' },
      llmFetch,
      appRoot: '/unused',
      bundledModules: {
        'adapters/netease/dist/index.js': neteaseModule,
        'packages/core/dist/index.js': coreModule,
      },
      contentPromptPath: promptPath,
      proactiveShare: { enabled: true, intervalMs: 90 * 60 * 1000 },
    });
    handles.push(handle);

    expect((await postJson(handle, '/v1/plugins/install', { id: 'netease' })).status).toBe(200);
    expect((await postJson(handle, '/v1/plugins/netease/enable', {})).status).toBe(200);

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
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      appRoot: '/unused',
      bundledModules: {
        'adapters/bilibili/dist/index.js': {
          BilibiliClient: class {
            async getRcmd() {
              return { item: [{ bvid: 'BV1xx411c7mD', title: '测试视频', owner: { mid: 1, name: 'UP' } }] };
            }
          },
        },
      },
    });
    handles.push(handle);

    expect((await postJson(handle, '/v1/plugins/install', { id: 'bilibili' })).status).toBe(200);
    expect((await postJson(handle, '/v1/plugins/bilibili/enable', {})).status).toBe(200);

    const scan = await postJson(handle, '/v1/bilibili/scan', { limit: 5 });
    expect(scan.status).toBe(200);
    expect(scan.body).toEqual(expect.objectContaining({ fetched: 1, emitted: 1 }));

    const activity = await getJson(handle, '/v1/activity?limit=5');
    expect(activity.body.sessions[0]).toEqual(expect.objectContaining({
      kind: 'bilibili_feed',
      status: 'completed',
      stats: { fetched: 1, inserted: 1 },
    }));

    const observations = await getJson(handle, '/v1/observations?platform=bilibili');
    expect(observations.body.observations).toHaveLength(1);
    expect(observations.body.observations[0].content).toContain('测试视频');
  });

  it('extracts experiences from observations through HTTP', async () => {
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            experiences: [{
              kind: 'watched_video',
              title: '测试视频',
              summary: '一个关于测试的视频',
              reaction: '有点意思',
              importance: 6,
              sourceObservationIds: ['obs-experience'],
            }],
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
    });
    handles.push(handle);

    await postJson(handle, '/v1/observations', {
      id: 'obs-experience',
      platform: 'bilibili',
      conversationId: 'feed',
      conversationKind: 'public',
      kind: 'video_watch',
      content: '推荐：测试视频',
      occurredAt: '2026-10-23T12:00:00.000Z',
      receivedAt: '2026-10-23T12:00:00.000Z',
      provenance: 'agent',
      audience: 'private',
    });

    const extracted = await postJson(handle, '/v1/experiences/extract', {
      characterId: 'herein-default',
    });
    expect(extracted.status).toBe(200);
    expect(extracted.body).toEqual(expect.objectContaining({ status: 'updated', created: 1 }));

    const experiences = await getJson(handle, '/v1/experiences?limit=5');
    expect(experiences.body.experiences[0]).toEqual(expect.objectContaining({
      title: '测试视频',
      reaction: '有点意思',
      characterId: 'herein-default',
    }));
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

  it('runs a synthetic voice turn from A SSE to A speech', async () => {
    const endpointDir = mkdtempSync(path.join(tmpdir(), 'herein-a-endpoint-'));
    tempDirs.push(endpointDir);
    const endpointFile = path.join(endpointDir, 'endpoint.local.json');
    writeFileSync(endpointFile, JSON.stringify({
      url: 'http://a.test',
      token: 'a-token',
    }), 'utf8');

    let speechBody: { text?: string; turnId?: string } | null = null;
    const encoder = new TextEncoder();
    const aFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/v1/events')) {
        const signal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              'data: {"type":"transcript","text":"你好","final":true,"turnId":"turn-v"}\n\n',
            ));
            signal?.addEventListener('abort', () => {
              try {
                controller.error(new Error('aborted'));
              } catch {
                // Stream may already be closed.
              }
            });
          },
        }), { status: 200 });
      }

      if (url.endsWith('/v1/speech')) {
        speechBody = JSON.parse(String(init?.body)) as { text?: string; turnId?: string };
        return new Response('{}', { status: 200 });
      }

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ready: true,
          asr: true,
          tts: true,
        }), { status: 200 });
      }

      throw new Error(`unexpected A fetch: ${url}`);
    }) as typeof fetch;
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: '在。' } }],
    }), { status: 200 })) as typeof fetch;
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
      interaction: {
        endpointFile,
        fetchImpl: aFetch,
      },
      voice: {
        enabled: true,
        characterId: 'herein-default',
      },
      memory: { enabled: false },
    });
    handles.push(handle);

    await vi.waitFor(() => {
      expect(speechBody).not.toBeNull();
    }, { timeout: 5000 });

    expect(speechBody).toEqual(expect.objectContaining({
      text: '在。',
      turnId: 'turn-v:0',
    }));

    const voiceMessages = await getJson(handle, '/v1/voice/messages?characterId=herein-default');
    expect(voiceMessages.body.messages.slice(-2)).toEqual([
      expect.objectContaining({ role: 'user', content: '你好' }),
      expect.objectContaining({ role: 'assistant', content: '在。' }),
    ]);

    const chatMessages = await getJson(handle, '/v1/timeline/herein-default/messages?limit=10');
    expect(chatMessages.body.messages).toEqual([]);
  });

  it('reports the interaction port health when configured', async () => {
    const interactionFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://interaction.test/health');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      interaction: {
        url: 'http://interaction.test',
        fetchImpl: interactionFetch,
      },
    });
    handles.push(handle);

    const status = await getJson(handle, '/v1/status');
    expect(status.body.components.interaction).toEqual(expect.objectContaining({
      status: 'ok',
      latencyMs: expect.any(Number),
    }));
  });

  it('ships DSH as an installable agent plugin', async () => {
    const dshFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ host: 'running', runtimeVersion: '0.2.1-rc.2' }), { status: 200 });
      }

      if (url.endsWith('/v1/call')) {
        return new Response(JSON.stringify({ value: 'hello Herein' }), { status: 200 });
      }

      throw new Error(`unexpected DSH fetch: ${url}`);
    }) as typeof fetch;
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: createDataDir(),
      pluginFetch: dshFetch,
    });
    handles.push(handle);

    const listed = await getJson(handle, '/v1/plugins');
    expect(listed.body.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'dsh', kind: 'agent' }),
        installed: false,
      }),
    ]));

    const installed = await postJson(handle, '/v1/plugins/install', { id: 'dsh' });
    expect(installed.body.plugin).toEqual(expect.objectContaining({ installed: true, enabled: false }));

    const enabled = await postJson(handle, '/v1/plugins/dsh/enable', {});
    expect(enabled.body.plugin).toEqual(expect.objectContaining({ installed: true, enabled: true }));

    const configured = await patchJson(handle, '/v1/plugins/dsh/config', {
      config: { url: 'http://127.0.0.1:8791', token: 'bridge-token' },
    });
    expect(configured.body.plugin.config).toEqual(expect.objectContaining({ token: 'bridge-token' }));

    const invoked = await postJson(handle, '/v1/plugins/dsh/invoke', {
      action: 'call',
      input: { name: 'herein_hello', arguments: { name: 'Herein' } },
    });
    expect(invoked.body.result).toEqual({ value: 'hello Herein' });

    const status = await getJson(handle, '/v1/status');
    expect(status.body.components.agents).toEqual(expect.objectContaining({
      status: 'ok',
      detail: expect.objectContaining({ plugins: 1 }),
    }));

    const removed = await getJson(handle, '/v1/plugins/dsh', { method: 'DELETE' });
    expect(removed.status).toBe(200);
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
