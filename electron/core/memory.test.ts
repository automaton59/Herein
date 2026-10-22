/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPhase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { CoreMemoryRunner } from './memory';

const tempDirs: string[] = [];

function createHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-memory-'));
  tempDirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  const repos = createPhase2Repositories(db);

  repos.characters.upsert({
    id: 'char-1',
    name: '蓝蓝',
    description: '测试角色',
    scenario: '私聊',
    firstMessage: '我在。',
    systemPrompt: '保持角色。',
    personalityCore: '温柔。',
    speakingStyle: '短句。',
    valuesText: '尊重。',
    boundaries: '不伤害。',
  });
  const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', '蓝蓝');

  return { db, repos, timeline };
}

function appendMessages(repos: ReturnType<typeof createPhase2Repositories>, timelineId: string, count: number, offset = 0) {
  for (let index = 0; index < count; index += 1) {
    const number = offset + index + 1;
    repos.messages.append({
      id: `msg-${number}`,
      timelineId,
      role: number % 2 === 0 ? 'assistant' : 'user',
      content: number % 2 === 0 ? `回复 ${number}` : `消息 ${number}`,
      timestamp: `2026-10-22T12:${String(number).padStart(2, '0')}:00.000Z`,
      status: 'sent',
    });
  }
}

function memoryResponse(summary: string, content: string, sourceMessageId: string) {
  return new Response(JSON.stringify({
    model: 'fake-model',
    choices: [{
      message: {
        role: 'assistant',
        content: JSON.stringify({
          conversationSummary: summary,
          memoryItems: [{
            kind: 'preference',
            scope: 'character',
            content,
            currentValue: null,
            previousValue: null,
            historicalNote: null,
            confidence: 0.8,
            sourceMessageIds: [sourceMessageId],
          }],
        }),
      },
    }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('CoreMemoryRunner', () => {
  it('creates a summary and structured memories from new messages', async () => {
    const { db, repos, timeline } = createHarness();
    appendMessages(repos, timeline.id, 20);
    const fetchImpl = vi.fn(async () => memoryResponse(
      '用户最近在忙项目，情绪平稳。',
      '用户喜欢短句回复。',
      'msg-1',
    )) as typeof fetch;

    const runner = new CoreMemoryRunner({
      repos,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'fake-model' },
      fetchImpl,
      triggerMessageCount: 20,
    });

    const result = await runner.run({ characterId: 'char-1', timelineId: timeline.id });
    expect(result).toEqual(expect.objectContaining({
      status: 'updated',
      memoryCount: 1,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(repos.summaries.getByTimeline(timeline.id)).toEqual(expect.objectContaining({
      content: '用户最近在忙项目，情绪平稳。',
      messageCount: 20,
    }));
    expect(repos.memories.listActive({ characterId: 'char-1', timelineId: timeline.id }))
      .toEqual([expect.objectContaining({
        content: '用户喜欢短句回复。',
        origin: 'summary',
        provenance: 'agent',
        audience: 'private',
      })]);

    await runner.close();
    db.close();
  });

  it('skips until the trigger count is reached', async () => {
    const { db, repos, timeline } = createHarness();
    appendMessages(repos, timeline.id, 5);
    const fetchImpl = vi.fn(async () => memoryResponse('summary', 'memory', 'msg-1')) as typeof fetch;
    const runner = new CoreMemoryRunner({
      repos,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'fake-model' },
      fetchImpl,
      triggerMessageCount: 20,
    });

    await expect(runner.run({ characterId: 'char-1', timelineId: timeline.id }))
      .resolves.toEqual(expect.objectContaining({ status: 'skipped' }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repos.summaries.getByTimeline(timeline.id)).toBeNull();

    await runner.close();
    db.close();
  });

  it('increments the summary window and keeps the previous summary on failure', async () => {
    const { db, repos, timeline } = createHarness();
    appendMessages(repos, timeline.id, 20);

    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;

      if (call === 1) {
        return memoryResponse('第一版总结', '用户喜欢短句。', 'msg-1');
      }

      return new Response(JSON.stringify({
        model: 'fake-model',
        choices: [{ message: { role: 'assistant', content: 'not json' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const runner = new CoreMemoryRunner({
      repos,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'fake-model' },
      fetchImpl,
      triggerMessageCount: 20,
    });

    await runner.run({ characterId: 'char-1', timelineId: timeline.id });
    appendMessages(repos, timeline.id, 20, 20);
    const failed = await runner.run({ characterId: 'char-1', timelineId: timeline.id });

    expect(failed).toEqual(expect.objectContaining({ status: 'failed' }));
    expect(repos.summaries.getByTimeline(timeline.id)?.content).toBe('第一版总结');
    expect(repos.summaries.getByTimeline(timeline.id)?.messageCount).toBe(20);

    await runner.close();
    db.close();
  });
});
