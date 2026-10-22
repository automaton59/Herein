/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { buildCoreChatPrompt } from './chatContext';

const dirs: string[] = [];
const databases: Phase2Database[] = [];

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-chatctx-'));
  dirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  const repos = createPhase2Repositories(db);

  repos.characters.upsert({
    id: 'char-1',
    name: '海拾香',
    description: '一个嘴硬心软的陪伴者。',
    personalityCore: '聪明、嘴硬',
    speakingStyle: '短句',
    valuesText: '尊重边界',
    boundaries: '不展示思维过程',
  });
  const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', '聊天');
  repos.relationships.upsert({
    characterId: 'char-1',
    tone: '松弛',
    closeness: 6,
    sharedHabits: '睡前说晚安',
    privateLanguage: '叫我蓝蓝',
    importantExperiences: '一起看过海',
    unresolvedContext: '下周搬家',
  });
  repos.memories.create({
    id: 'mem-1',
    characterId: 'char-1',
    timelineId: timeline.id,
    scope: 'character',
    kind: 'state',
    content: '用户下周搬去上海。',
    audience: 'private',
    importance: 9,
  });
  repos.memories.create({
    id: 'mem-2',
    characterId: 'char-1',
    timelineId: timeline.id,
    scope: 'character',
    kind: 'preference',
    content: '群里才知道的事。',
    audience: 'group',
  });
  repos.summaries.upsert({
    id: 'summary-1',
    timelineId: timeline.id,
    content: '最近在聊搬家。',
    messageCount: 10,
    sourceMessageIds: ['m1'],
  });

  return { repos, timeline };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    closePhase2Database(db);
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('core chat context', () => {
  it('includes character, relationship, summary and private memories', () => {
    const { repos, timeline } = setup();
    const character = repos.characters.get('char-1')!;
    const prompt = buildCoreChatPrompt({ repos, character, timeline });

    expect(prompt).toContain('你是海拾香');
    expect(prompt).toContain('睡前说晚安');
    expect(prompt).toContain('最近在聊搬家');
    expect(prompt).toContain('用户下周搬去上海');
    expect(prompt).toContain('不要心理咨询/客服腔');
  });

  it('keeps private memories out of group context', () => {
    const { repos, timeline } = setup();
    const character = repos.characters.get('char-1')!;
    const prompt = buildCoreChatPrompt({ repos, character, timeline, audience: 'group' });

    expect(prompt).not.toContain('用户下周搬去上海');
    expect(prompt).toContain('群里才知道的事');
  });
});
