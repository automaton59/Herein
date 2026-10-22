/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { getNeteaseCandidates, type NeteaseCandidateSource } from './neteaseCandidates';

function source(overrides: Partial<NeteaseCandidateSource> = {}): NeteaseCandidateSource {
  return {
    search: vi.fn().mockResolvedValue({ songs: [] }),
    toplists: vi.fn().mockResolvedValue([]),
    playlist: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('netease candidates', () => {
  it('builds profiles from a keyword search', async () => {
    const fake = source({
      search: vi.fn().mockResolvedValue({
        songs: [
          { id: 1, name: '夜曲', ar: [{ name: '周杰伦' }], al: { name: '十一月的萧邦' }, dt: 226000 },
          { id: 2, name: '晴天', ar: [{ name: '周杰伦' }] },
        ],
      }),
    });

    const candidates = await getNeteaseCandidates({ query: '周杰伦', limit: 2, source: fake }) as Array<{
      itemId: string;
      title: string;
      creator?: string;
    }>;

    expect(candidates).toEqual([
      expect.objectContaining({ itemId: '1', title: '夜曲', creator: '周杰伦' }),
      expect.objectContaining({ itemId: '2', title: '晴天' }),
    ]);
  });

  it('uses the first toplist playlist when there is no query', async () => {
    const fake = source({
      toplists: vi.fn().mockResolvedValue([{ id: 19723756, name: '飙升榜' }]),
      playlist: vi.fn().mockResolvedValue({
        tracks: [{ id: 3, name: '榜单歌', ar: [{ name: '歌手' }] }],
      }),
    });

    const candidates = await getNeteaseCandidates({ limit: 5, source: fake }) as Array<{ title: string }>;
    expect(candidates[0].title).toBe('榜单歌');
    expect(fake.search).not.toHaveBeenCalled();
  });

  it('falls back to a search when the toplist has no tracks', async () => {
    const fake = source({
      toplists: vi.fn().mockResolvedValue([{ id: 1, name: '空榜' }]),
      playlist: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue({ songs: [{ id: 4, name: '兜底歌' }] }),
    });

    const candidates = await getNeteaseCandidates({ limit: 5, source: fake }) as Array<{ title: string }>;
    expect(candidates[0].title).toBe('兜底歌');
  });
});
