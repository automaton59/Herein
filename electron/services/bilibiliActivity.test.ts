/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from '../data/database';
import { createPhase2Repositories } from '../data/repositories';
import { scanBilibiliFeed } from './bilibiliActivity';

const tempDirs: string[] = [];
const databases: Phase2Database[] = [];

function createRepos() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-bili-'));
  tempDirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  databases.push(db);
  return createPhase2Repositories(db);
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    closePhase2Database(db);
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const fixedNow = () => new Date('2026-10-21T12:00:00.000Z');

describe('bilibili feed activity', () => {
  it('writes observations and a completed activity session', async () => {
    const repos = createRepos();
    const source = {
      getRcmd: vi.fn().mockResolvedValue({
        item: [
          {
            bvid: 'BV1xx411c7mD',
            title: '视频一',
            cover: 'https://example.test/1.jpg',
            pubdate: 1700000000,
            owner: { mid: 1, name: 'UP一' },
          },
          {
            bvid: 'BV1yy411c7mE',
            title: '视频二',
            owner: { mid: 2, name: 'UP二' },
          },
        ],
      }),
    };

    const result = await scanBilibiliFeed({ repos, source, now: fixedNow });
    expect(result).toEqual({ sessionId: expect.any(String), fetched: 2, inserted: 2 });

    const sessions = repos.activitySessions.listRecent(5);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(expect.objectContaining({
      kind: 'bilibili_feed',
      status: 'completed',
      stats: { fetched: 2, inserted: 2, skipped: 0 },
    }));

    const observations = repos.observations.listRecent({ platform: 'bilibili' });
    expect(observations).toHaveLength(2);
    expect(observations[0].content).toContain('推荐：');
    expect(observations[0].audience).toBe('private');
  });

  it('dedupes the same day on a second scan', async () => {
    const repos = createRepos();
    const source = {
      getRcmd: vi.fn().mockResolvedValue({
        item: [{ bvid: 'BV1xx411c7mD', title: '视频一' }],
      }),
    };

    await scanBilibiliFeed({ repos, source, now: fixedNow });
    const second = await scanBilibiliFeed({ repos, source, now: fixedNow });

    expect(second.inserted).toBe(0);
    expect(repos.observations.listRecent({ platform: 'bilibili' })).toHaveLength(1);
    expect(repos.activitySessions.listRecent(5)).toHaveLength(2);
  });

  it('marks the session failed when the source throws', async () => {
    const repos = createRepos();
    const source = { getRcmd: vi.fn().mockRejectedValue(new Error('risk control')) };

    await expect(scanBilibiliFeed({ repos, source, now: fixedNow })).rejects.toThrow('risk control');
    expect(repos.activitySessions.listRecent(1)[0]).toEqual(expect.objectContaining({
      status: 'failed',
    }));
  });
});
