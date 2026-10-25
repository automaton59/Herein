/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { CoreEventBus } from './eventBus';
import {
  InitiativeEngine,
  InitiativeScheduler,
  evaluateInitiativeGate,
  isQuietHours,
  DEFAULT_INITIATIVE_POLICY,
} from './initiative';

const tempDirs: string[] = [];
const databases: Array<ReturnType<typeof openPhase2Database>> = [];

function createHarness(now = '2026-10-22T12:00:00.000Z') {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-initiative-'));
  tempDirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  const repos = createPhase2Repositories(db);

  repos.characters.upsert({
    id: 'char-1',
    name: '小蓝',
    description: '',
    scenario: '',
    firstMessage: '',
    systemPrompt: '',
    personalityCore: '',
    speakingStyle: '',
    valuesText: '',
    boundaries: '',
  });
  const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', '小蓝');
  const events = new CoreEventBus();

  function engine(overrides: {
    fetchImpl?: typeof fetch;
    policy?: Partial<typeof DEFAULT_INITIATIVE_POLICY>;
    materials?: {
      hasFresh: (maxAgeMs?: number) => boolean;
      block: (limit?: number, maxAgeMs?: number) => string;
    };
    notify?: (message: string) => Promise<void> | void;
    onSpoken?: (message: string) => Promise<void> | void;
    personaFor?: ConstructorParameters<typeof InitiativeEngine>[0]['personaFor'];
  } = {}) {
    return new InitiativeEngine({
      repos,
      events,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'fake-model' },
      fetchImpl: overrides.fetchImpl ?? (async () => new Response('{}')) as typeof fetch,
      now: () => new Date(now),
      materials: overrides.materials,
      personaFor: overrides.personaFor,
      notify: overrides.notify,
      onSpoken: overrides.onSpoken,
      policy: {
        quietHours: { start: '00:00', end: '00:00' },
        ...overrides.policy,
      },
    });
  }

  return { db, repos, timeline, events, engine };
}

function appendUserMessage(repos: ReturnType<typeof createPhase2Repositories>, timelineId: string, timestamp: string) {
  repos.messages.append({
    id: `user-${timestamp}`,
    timelineId,
    role: 'user',
    content: '今天有点累。',
    timestamp,
    status: 'sent',
  });
}

function decisionResponse(shouldSpeak: boolean, message = '刚看到一个东西，想起你。') {
  return new Response(JSON.stringify({
    model: 'fake-model',
    choices: [{
      message: {
        role: 'assistant',
        content: JSON.stringify({
          shouldSpeak,
          reason: shouldSpeak ? '有具体内容' : '现在不适合打扰',
          message: shouldSpeak ? message : '',
        }),
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      // Already closed by a test.
    }
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('initiative policy', () => {
  it('handles quiet hours across midnight', () => {
    expect(isQuietHours(new Date('2026-10-22T23:45:00'), { start: '23:30', end: '08:00' })).toBe(true);
    expect(isQuietHours(new Date('2026-10-22T07:59:00'), { start: '23:30', end: '08:00' })).toBe(true);
    expect(isQuietHours(new Date('2026-10-22T08:00:00'), { start: '23:30', end: '08:00' })).toBe(false);
    expect(isQuietHours(new Date('2026-10-22T12:00:00'), { start: '23:30', end: '08:00' })).toBe(false);
  });

  it('skips while the user is active and respects cooldown/daily limit', () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    const activeUser = [{
      id: 'u1',
      timelineId: 't1',
      role: 'user' as const,
      content: '在吗',
      timestamp: '2026-10-22T11:55:00.000Z',
    }];

    expect(evaluateInitiativeGate({
      now,
      messages: activeUser,
      policy: { ...DEFAULT_INITIATIVE_POLICY, quietHours: { start: '00:00', end: '00:00' } },
      hasMaterial: true,
    })).toEqual(expect.objectContaining({ allowed: false, reason: 'user is active' }));

    const proactive = [{
      id: 'i1',
      timelineId: 't1',
      role: 'assistant' as const,
      content: '刚看到...',
      timestamp: '2026-10-22T11:00:00.000Z',
      sourceConversationId: 'initiative',
    }];
    expect(evaluateInitiativeGate({
      now,
      messages: proactive,
      policy: { ...DEFAULT_INITIATIVE_POLICY, quietHours: { start: '00:00', end: '00:00' } },
      hasMaterial: true,
    })).toEqual(expect.objectContaining({ allowed: false, reason: 'cooldown' }));

    const daily = Array.from({ length: 3 }, (_, index) => ({
      id: `i${index}`,
      timelineId: 't1',
      role: 'assistant' as const,
      content: '主动消息',
      timestamp: `2026-10-22T0${index}:00:00.000Z`,
      sourceConversationId: 'initiative',
    }));
    expect(evaluateInitiativeGate({
      now,
      messages: daily,
      policy: { ...DEFAULT_INITIATIVE_POLICY, quietHours: { start: '00:00', end: '00:00' } },
      hasMaterial: true,
    })).toEqual(expect.objectContaining({ allowed: false, reason: 'daily limit reached' }));

    expect(evaluateInitiativeGate({
      now,
      messages: [],
      policy: { ...DEFAULT_INITIATIVE_POLICY, quietHours: { start: '00:00', end: '00:00' } },
      hasMaterial: true,
      attentionSpent: 10,
    })).toEqual(expect.objectContaining({ allowed: false, reason: 'attention budget reached' }));
  });
});

describe('InitiativeEngine', () => {
  it('speaks, appends a timeline message and publishes an event', async () => {
    const { repos, timeline, events, engine } = createHarness();
    appendUserMessage(repos, timeline.id, '2026-10-22T10:00:00.000Z');
    const fetchImpl = vi.fn(async () => decisionResponse(true, '刚看到一个东西，想起你。')) as typeof fetch;
    const notify = vi.fn();
    const onSpoken = vi.fn();
    const emitted: string[] = [];
    events.subscribe(event => {
      if (event.type === 'assistant.proactive') {
        emitted.push(event.type);
      }
    });

    const result = await engine({ fetchImpl, notify, onSpoken }).run({ characterId: 'char-1' });
    expect(result).toEqual(expect.objectContaining({
      status: 'spoke',
      message: '刚看到一个东西，想起你。',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('刚看到一个东西，想起你。');
    expect(onSpoken).toHaveBeenCalledWith('刚看到一个东西，想起你。');
    expect(emitted).toEqual(['assistant.proactive']);
    expect(repos.messages.listRecent(timeline.id, 10)).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        content: '刚看到一个东西，想起你。',
        sourceConversationId: 'initiative',
      }),
    ]);
    expect(repos.initiativeBids.listRecent('char-1', 5)).toEqual([
      expect.objectContaining({
        status: 'sent',
        channel: 'text',
        kind: 'idle_thought',
      }),
    ]);
  });

  it('skips during quiet hours without calling the model', async () => {
    const { repos, timeline, engine } = createHarness('2026-10-22T23:45:00.000Z');
    appendUserMessage(repos, timeline.id, '2026-10-22T20:00:00.000Z');
    const fetchImpl = vi.fn(async () => decisionResponse(true)) as typeof fetch;

    const result = await engine({
      fetchImpl,
      policy: { quietHours: { start: '23:30', end: '08:00' } },
    }).run({ characterId: 'char-1' });

    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'quiet hours' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a fenced JSON decision from the model', async () => {
    const { repos, timeline, engine } = createHarness();
    appendUserMessage(repos, timeline.id, '2026-10-22T10:00:00.000Z');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{
        message: {
          role: 'assistant',
          content: '```json\n{"shouldSpeak":true,"reason":"有材料","message":"刚看到一个视频。"}\n```',
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const result = await engine({ fetchImpl }).run({ characterId: 'char-1' });

    expect(result).toEqual(expect.objectContaining({
      status: 'spoke',
      message: '刚看到一个视频。',
    }));
  });

  it('includes fresh plugin material in the initiative prompt', async () => {
    const { repos, timeline, engine } = createHarness();
    appendUserMessage(repos, timeline.id, '2026-10-22T10:00:00.000Z');
    let requestBody = '';
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return decisionResponse(true, '刷到一个关羽对线教程，想起你。');
    }) as typeof fetch;

    const result = await engine({
      fetchImpl,
      materials: {
        hasFresh: () => true,
        block: () => '【她刚翻到的】\n- 视频：关羽对线教程（UP：某UP）',
      },
    }).run({ characterId: 'char-1' });

    expect(result.status).toBe('spoke');
    expect(requestBody).toContain('她最近看到的');
    expect(requestBody).toContain('关羽对线教程');
  });

  it('puts the fixed persona voice and relationship into the initiative prompt', async () => {
    const { repos, timeline, engine } = createHarness();
    appendUserMessage(repos, timeline.id, '2026-10-22T10:00:00.000Z');
    let requestBody = '';
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return decisionResponse(true, '刚吃完，突然想问问你吃没。');
    }) as typeof fetch;

    const result = await engine({
      fetchImpl,
      personaFor: () => ({
        packId: 'haishixiang',
        packVersion: '1.0.0',
        identity: '你是海拾香。嘴硬心软，不拿冷淡让人内疚。',
        relationship: '关系：女友，刚开始',
        behavior: '私聊时的回复规则',
        layers: [],
      }),
    }).run({ characterId: 'char-1' });

    expect(result.status).toBe('spoke');
    expect(requestBody).toContain('嘴硬心软');
    expect(requestBody).toContain('关系：女友');
    expect(requestBody).toContain('单纯想说话');
  });

  it('includes open loops in the initiative prompt', async () => {
    const { repos, timeline, engine } = createHarness();
    appendUserMessage(repos, timeline.id, '2026-10-22T10:00:00.000Z');
    repos.openLoops.create({
      id: 'loop-1',
      characterId: 'char-1',
      timelineId: timeline.id,
      text: '白天我再来看看情况',
      status: 'open',
      createdAt: '2026-10-22T08:00:00.000Z',
      expiresAt: '2026-10-29T08:00:00.000Z',
    });
    let requestBody = '';
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return decisionResponse(true, '白天说的那个，后来看了吗。');
    }) as typeof fetch;

    const result = await engine({ fetchImpl }).run({ characterId: 'char-1' });

    expect(result.status).toBe('spoke');
    expect(requestBody).toContain('没接住的线头');
    expect(requestBody).toContain('白天我再来看看情况');
  });

  it('skips before the first conversation even when material exists', async () => {
    const { engine } = createHarness();
    const fetchImpl = vi.fn(async () => decisionResponse(true)) as typeof fetch;

    const result = await engine({
      fetchImpl,
      materials: {
        hasFresh: () => true,
        block: () => '【她刚翻到的】\n- 视频：某视频',
      },
    }).run({ characterId: 'char-1' });

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'no conversation yet',
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips when the model declines', async () => {
    const { repos, timeline, engine } = createHarness();
    appendUserMessage(repos, timeline.id, '2026-10-22T10:00:00.000Z');
    const fetchImpl = vi.fn(async () => decisionResponse(false)) as typeof fetch;

    const result = await engine({ fetchImpl }).run({ characterId: 'char-1' });
    expect(result).toEqual(expect.objectContaining({ status: 'skipped' }));
    expect(repos.messages.listRecent(timeline.id, 10).filter(message => message.role === 'assistant'))
      .toHaveLength(0);
  });

  it('schedules a tick for the active character', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'skipped', reason: 'quiet hours' });
    const scheduler = new InitiativeScheduler({
      engine: { run },
      getCharacterId: () => 'char-1',
    });

    await expect(scheduler.tick()).resolves.toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'quiet hours',
    }));
    expect(run).toHaveBeenCalledWith({ characterId: 'char-1' });

    const empty = new InitiativeScheduler({
      engine: { run },
      getCharacterId: () => null,
    });
    await expect(empty.tick()).resolves.toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'no character available',
    }));
  });
});
