import { describe, expect, it } from 'vitest';
import { buildSongProfile, extractLyricHook, uniqueProfiles } from './content';

describe('content profile', () => {
  it('extracts a lyric hook and skips credits', () => {
    const lyric = '[00:00.00] 作词 : 某人\n[00:01.00] 作曲 : 某人\n[00:12.00] 海风把夏天吹远\n[00:16.00] 我还站在原地';
    expect(extractLyricHook(lyric)).toBe('海风把夏天吹远');
    expect(extractLyricHook(undefined)).toBe('');
  });

  it('builds a song profile from metadata and lyrics', () => {
    const profile = buildSongProfile({
      id: 1,
      name: '测试歌曲',
      artists: [{ name: '歌手A' }, { name: '歌手B' }],
      album: { name: '专辑' },
      durationMs: 200000,
    }, '[00:00.00] 作词 : 某人\n[00:12.00] 海风把夏天吹远');

    expect(profile).toEqual(expect.objectContaining({
      type: 'song',
      itemId: '1',
      title: '测试歌曲',
      creator: '歌手A / 歌手B',
      genre: '专辑',
      hook: '海风把夏天吹远',
      source: 'netease',
    }));
  });

  it('dedupes profiles by type and item id', () => {
    const a = buildSongProfile({ id: 1, name: 'A' });
    const b = buildSongProfile({ id: 1, name: 'A again' });
    const c = buildSongProfile({ id: 2, name: 'C' });

    expect(uniqueProfiles([a, b, c]).map(profile => profile.itemId)).toEqual(['1', '2']);
  });
});
