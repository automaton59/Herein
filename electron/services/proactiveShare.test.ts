/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { ProactiveShareScheduler } from './proactiveShare';

const tempDirs: string[] = [];
const databases: Phase2Database[] = [];

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-share-'));
  tempDirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  const repos = createPhase2Repositories(db);
  const promptPath = path.join(dir, 'prompt.md');
  writeFileSync(promptPath, 'ctx={{context}} cand={{candidates_json}}');
  return { dir, repos, promptPath };
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    closePhase2Database(db);
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('proactive song sharing', () => {
  it('shares once, records it and publishes an SSE-friendly payload', async () => {
    const { repos, promptPath } = setup();
    const published: unknown[] = [];
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"shouldRecommend":true,"type":"song","itemId":"song-1","reason":"这个好听。","confidence":0.8}',
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const scheduler = new ProactiveShareScheduler({
      repos,
      llmConfig: { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test-model' },
      fetchCandidates: vi.fn().mockResolvedValue([{
        itemId: '1',
        title: '夜曲',
        creator: '周杰伦',
        coverUrl: 'https://img.test/1.jpg',
      }]),
      promptPath,
      fetchImpl: llmFetch,
      publish: song => published.push(song),
      now: () => new Date('2026-10-21T12:00:00.000Z'),
      intervalMs: 90 * 60 * 1000,
    });

    const first = await scheduler.tick();
    expect(first.status).toBe('shared');
    expect(first.song).toEqual(expect.objectContaining({
      itemId: '1',
      title: '夜曲',
      shareLine: '这个好听。',
    }));
    expect(published).toEqual([first.song]);
    expect(repos.recommendationEvents.recent(5)).toEqual([
      expect.objectContaining({ itemId: '1', itemType: 'song' }),
    ]);

    const second = await scheduler.tick();
    expect(second).toEqual({ status: 'skipped', reason: 'interval not reached' });
    expect(llmFetch).toHaveBeenCalledTimes(1);
  });
});
