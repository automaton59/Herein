import { describe, expect, it, vi } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createMemoryStore } from '../data/memoryStore';
import { createPhase2Repositories } from '../data/repositories';
import { commitMemoryUpdate } from './commit';
import { extractExperiences } from './experience';
import { recallMemory } from './recall';
import { reconcileMemoryOutput } from './reconcile';
import { MemoryRunner } from './runner';

function setup() {
  const db = openPhase2Database(':memory:');
  const repos = createPhase2Repositories(db);
  repos.characters.upsert({
    id: 'c1',
    name: '测试角色',
    description: '',
  });
  const timeline = repos.timelines.ensurePrimaryForCharacter('c1', '测试角色');
  const store = createMemoryStore(db);
  return { db, repos, timeline, store };
}

function appendMessage(
  repos: ReturnType<typeof setup>['repos'],
  timelineId: string,
  id: string,
  role: 'user' | 'assistant',
  content: string,
  index = 0,
) {
  repos.messages.append({
    id,
    timelineId,
    role,
    content,
    timestamp: `2026-10-23T12:00:${String(index).padStart(2, '0')}.000Z`,
    status: 'sent',
  });
}

const llmConfig = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'sk-test',
  model: 'fake-model',
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify({
    model: 'fake-model',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('memory reconcile and commit', () => {
  it('commits an asserted item, narrative and run ledger', () => {
    const { db, repos, timeline, store } = setup();
    appendMessage(repos, timeline.id, 'm1', 'user', '我搬到上海了');

    const reconciled = reconcileMemoryOutput({
      summary: '用户搬到上海，正在找房子。',
      openLoops: ['找房子'],
      ops: [{
        op: 'assert',
        subject: 'user',
        kind: 'state',
        predicate: 'location',
        content: '现居上海',
        importance: 6,
        confidence: 0.9,
        evidence: ['m1'],
      }],
    }, {
      characterId: 'c1',
      timelineId: timeline.id,
      knownItems: [],
      messageRoles: new Map([['m1', 'user']]),
      now: '2026-10-23T12:00:30.000Z',
    });

    expect(reconciled.accepted).toHaveLength(1);
    expect(reconciled.rejected).toHaveLength(0);

    const committed = commitMemoryUpdate({
      store,
      repos,
      characterId: 'c1',
      timelineId: timeline.id,
      runId: 'run-test',
      accepted: reconciled.accepted,
      narrative: reconciled.narrative,
      watermarkMessageId: 'm1',
      messageCount: 1,
      sourceMessageIds: ['m1'],
    });

    expect(committed.applied).toBe(1);
    expect(store.items.listActive({ characterId: 'c1' })[0].content).toBe('现居上海');
    expect(store.narratives.latest(timeline.id)?.version).toBe(1);
    expect(store.events.listRecent({ characterId: 'c1' }).length).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it('turns a state change into supersede and keeps the old interval', () => {
    const { db, repos, timeline, store } = setup();
    appendMessage(repos, timeline.id, 'm1', 'user', '我搬去上海了');
    const previous = store.items.create({
      characterId: 'c1',
      timelineId: timeline.id,
      subject: 'user',
      kind: 'state',
      predicate: 'location',
      content: '现居杭州',
      importance: 6,
      confidence: 0.9,
      validFrom: '2026-01-01T00:00:00.000Z',
    });

    const reconciled = reconcileMemoryOutput({
      ops: [{
        op: 'assert',
        subject: 'user',
        kind: 'state',
        predicate: 'location',
        content: '现居上海',
        evidence: ['m1'],
      }],
    }, {
      characterId: 'c1',
      timelineId: timeline.id,
      knownItems: [previous],
      messageRoles: new Map([['m1', 'user']]),
      now: '2026-10-23T12:00:30.000Z',
    });

    expect(reconciled.accepted[0]).toMatchObject({ op: 'supersede', targetId: previous.id });

    commitMemoryUpdate({
      store,
      repos,
      characterId: 'c1',
      timelineId: timeline.id,
      runId: 'run-test',
      accepted: reconciled.accepted,
      narrative: null,
      watermarkMessageId: 'm1',
      messageCount: 1,
      sourceMessageIds: ['m1'],
    });

    const old = store.items.get(previous.id);
    const active = store.items.listActive({ characterId: 'c1' });

    expect(old?.status).toBe('superseded');
    expect(old?.validTo).toBeTruthy();
    expect(active.map(item => item.content)).toContain('现居上海');
    expect(active.map(item => item.content)).not.toContain('现居杭州');
    db.close();
  });

  it('never lets extraction overwrite a manual memory', () => {
    const { db, timeline, store } = setup();
    const manual = store.items.create({
      characterId: 'c1',
      timelineId: timeline.id,
      subject: 'user',
      kind: 'preference',
      predicate: 'address_style',
      content: '不喜欢被叫宝宝',
      manual: true,
      provenance: 'owner',
      origin: 'manual',
    });

    const reconciled = reconcileMemoryOutput({
      ops: [
        { op: 'revise', targetId: manual.id, content: '喜欢被叫宝宝' },
        { op: 'supersede', targetId: manual.id, subject: 'user', kind: 'preference', content: '喜欢被叫宝宝', evidence: ['m1'] },
      ],
    }, {
      characterId: 'c1',
      timelineId: timeline.id,
      knownItems: [manual],
      messageRoles: new Map([['m1', 'user']]),
      now: '2026-10-23T12:00:30.000Z',
    });

    expect(reconciled.accepted).toHaveLength(0);
    expect(reconciled.rejected).toHaveLength(2);
    expect(reconciled.rejected.every(item => item.reason.includes('manual'))).toBe(true);
    db.close();
  });

  it('rejects user facts backed only by the character reply', () => {
    const { db, timeline, store } = setup();
    const reconciled = reconcileMemoryOutput({
      ops: [{
        op: 'assert',
        subject: 'user',
        kind: 'state',
        content: '用户很难过',
        evidence: ['m2'],
      }],
    }, {
      characterId: 'c1',
      timelineId: timeline.id,
      knownItems: [],
      messageRoles: new Map([['m2', 'assistant']]),
      now: '2026-10-23T12:00:30.000Z',
    });

    expect(reconciled.accepted).toHaveLength(0);
    expect(reconciled.rejected[0].reason).toContain('user side');
    expect(store.items.listActive({ characterId: 'c1' })).toHaveLength(0);
    db.close();
  });

  it('allows a character commitment backed by assistant text', () => {
    const { db, timeline, store } = setup();
    const reconciled = reconcileMemoryOutput({
      ops: [{
        op: 'assert',
        subject: 'relationship',
        kind: 'commitment',
        content: '答应周日陪她看电影',
        evidence: ['m2'],
      }],
    }, {
      characterId: 'c1',
      timelineId: timeline.id,
      knownItems: [],
      messageRoles: new Map([['m2', 'assistant']]),
      now: '2026-10-23T12:00:30.000Z',
    });

    expect(reconciled.accepted).toHaveLength(1);
    expect(reconciled.accepted[0].item?.kind).toBe('commitment');
    expect(store.items.listActive({ characterId: 'c1' })).toHaveLength(0);
    db.close();
  });
});

describe('memory recall', () => {
  it('packs private sections and excludes them from group context', () => {
    const { db, timeline, store } = setup();
    store.items.create({
      characterId: null,
      timelineId: timeline.id,
      subject: 'user',
      kind: 'state',
      predicate: 'location',
      content: '现居上海',
      importance: 8,
    });
    store.items.create({
      characterId: 'c1',
      timelineId: timeline.id,
      subject: 'relationship',
      kind: 'event',
      content: '一起看过海',
      importance: 7,
      audience: 'private',
    });
    store.narratives.append({
      characterId: 'c1',
      timelineId: timeline.id,
      content: '最近在聊搬家。',
      openLoops: ['找房子'],
      messageCount: 4,
    });
    store.experiences.create({
      characterId: 'c1',
      kind: 'watched_video',
      title: '测试视频',
      summary: '一个关于测试的视频',
      reaction: '有点意思',
      happenedAt: '2026-10-23T12:00:00.000Z',
    });

    const privateRecall = recallMemory({
      store,
      brief: { characterId: 'c1', timelineId: timeline.id, audience: 'private', situation: '搬家' },
    });
    expect(privateRecall.text).toContain('现居上海');
    expect(privateRecall.text).toContain('最近在聊搬家');
    expect(privateRecall.text).toContain('找房子');
    expect(privateRecall.text).toContain('测试视频：有点意思');

    const groupRecall = recallMemory({
      store,
      brief: { characterId: 'c1', timelineId: timeline.id, audience: 'group', situation: '搬家' },
    });
    expect(groupRecall.text).not.toContain('现居上海');
    expect(groupRecall.text).not.toContain('最近在聊搬家');
    expect(groupRecall.text).not.toContain('测试视频');
    db.close();
  });
});

describe('experience extraction', () => {
  it('turns observations into experiences and indexes them', async () => {
    const { db, repos, store } = setup();
    repos.observations.insert({
      id: 'obs1',
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

    const fetchImpl = vi.fn(async () => jsonResponse({
      experiences: [{
        kind: 'watched_video',
        title: '测试视频',
        summary: '一个关于测试的视频',
        reaction: '有点意思',
        importance: 6,
        sourceObservationIds: ['obs1'],
      }],
    })) as unknown as typeof fetch;

    const result = await extractExperiences({
      repos,
      store,
      characterId: 'c1',
      llmConfig,
      fetchImpl,
    });

    expect(result).toMatchObject({ status: 'updated', created: 1 });
    const experiences = store.experiences.listRecent({ characterId: 'c1' });
    expect(experiences[0].title).toBe('测试视频');
    expect(store.experiences.search('测试', { characterId: 'c1' })).toHaveLength(1);
    db.close();
  });
});

describe('memory runner', () => {
  it('runs ops end to end and advances the narrative watermark', async () => {
    const { db, repos, timeline, store } = setup();

    for (let index = 0; index < 20; index += 1) {
      appendMessage(
        repos,
        timeline.id,
        `m${index + 1}`,
        index % 2 === 0 ? 'user' : 'assistant',
        index === 0 ? '我喜欢简短回复' : `消息 ${index + 1}`,
        index,
      );
    }

    const fetchImpl = vi.fn(async () => jsonResponse({
      summary: '用户喜欢简短回复。',
      openLoops: [],
      ops: [{
        op: 'assert',
        subject: 'user',
        kind: 'preference',
        predicate: 'reply_style',
        content: '用户喜欢简短回复',
        confidence: 0.8,
        evidence: ['m1'],
      }],
    })) as unknown as typeof fetch;

    const runner = new MemoryRunner({
      repos,
      store,
      llmConfig,
      fetchImpl,
      triggerMessageCount: 20,
    });

    const result = await runner.run({ characterId: 'c1', timelineId: timeline.id });
    expect(result.status).toBe('updated');
    expect(store.items.listActive({ characterId: 'c1' })[0].content).toBe('用户喜欢简短回复');
    expect(store.narratives.latest(timeline.id)?.messageCount).toBe(20);
    expect(store.runs.listRecent(1)[0].status).toBe('updated');

    const again = await runner.run({ characterId: 'c1', timelineId: timeline.id });
    expect(again.status).toBe('skipped');
    db.close();
  });
});
