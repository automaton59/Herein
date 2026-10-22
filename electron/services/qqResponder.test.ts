/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { createQQResponder } from './qqResponder';

const dirs: string[] = [];
const databases: Phase2Database[] = [];

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-qqresp-'));
  dirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  const repos = createPhase2Repositories(db);
  repos.characters.upsert({
    id: 'char-1',
    name: '海拾香',
    description: '嘴硬心软。',
    personalityCore: '聪明、嘴硬',
    speakingStyle: '短句',
    valuesText: '尊重边界',
    boundaries: '不展示思维过程',
  });
  repos.timelines.ensurePrimaryForCharacter('char-1', '聊天');
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

describe('qq responder', () => {
  it('builds a group prompt, includes history, and strips assistant tags', async () => {
    const { repos } = setup();
    const character = repos.characters.get('char-1')!;
    const timeline = repos.timelines.getPrimaryForCharacter('char-1')!;
    repos.observations.insert({
      id: 'obs-1',
      platform: 'qq',
      conversationId: 'group-1',
      conversationKind: 'group',
      actorId: 'member-1',
      actorName: '群友',
      kind: 'message',
      content: '今天好累。',
      occurredAt: '2026-10-21T12:00:00.000Z',
      receivedAt: '2026-10-21T12:00:01.000Z',
      provenance: 'untrusted',
      audience: 'group',
      trust: 0.5,
      dedupeKey: 'qq:group:obs-1',
    });

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[0].content).toContain('你是海拾香');
      expect(body.messages[0].content).toContain('刚被 @');
      expect(body.messages.some(message => message.content.includes('群友：今天好累'))).toBe(true);
      expect(body.messages[body.messages.length - 1].content).toBe('@蓝蓝 在吗');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '在。[emotion: neutral][voice: 用自然语气说]' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const responder = createQQResponder({
      repos,
      characterId: character.id,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test' },
      fetchImpl,
    });

    const reply = await responder({ t: 'GROUP_AT_MESSAGE_CREATE' }, {
      id: 'obs-2',
      platform: 'qq',
      conversationId: 'group-1',
      conversationKind: 'group',
      actorId: 'member-1',
      actorName: '群友',
      isSelf: false,
      isBot: false,
      kind: 'message',
      content: '@蓝蓝 在吗',
      occurredAt: '2026-10-21T12:01:00.000Z',
      receivedAt: '2026-10-21T12:01:01.000Z',
      provenance: 'untrusted',
      audience: 'group',
      trust: 0.5,
      dedupeKey: 'qq:group:obs-2',
      raw: {},
    });

    expect(reply).toBe('在。');
    expect(timeline.id).toBeTruthy();
  });
});
