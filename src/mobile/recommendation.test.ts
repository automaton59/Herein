import { describe, expect, it } from 'vitest';
import {
  canShowRecommendation,
  isUpsetText,
  pickSongQuery,
  shouldProactivelyShare,
  wantsRecommendation,
} from './recommendation';

describe('mobile recommendation intent', () => {
  it('detects song recommendation intents', () => {
    expect(wantsRecommendation('好无聊，想听歌')).toBe(true);
    expect(wantsRecommendation('推荐首歌')).toBe(true);
    expect(wantsRecommendation('今天吃什么')).toBe(false);
  });

  it('shares proactively only when the mood and cooldown allow it', () => {
    const now = new Date('2026-10-21T12:00:00.000Z');

    expect(shouldProactivelyShare({
      now,
      text: '今天天气不错',
      lastRecommendedAt: '2026-10-21T11:30:00.000Z',
      random: () => 0,
    })).toBe(false);

    expect(shouldProactivelyShare({
      now,
      text: '今天天气不错',
      lastRecommendedAt: '2026-10-21T09:00:00.000Z',
      random: () => 0.1,
    })).toBe(true);

    expect(shouldProactivelyShare({
      now,
      text: '今天好难受',
      lastRecommendedAt: null,
      random: () => 0,
    })).toBe(false);
  });

  it('picks a query from the mood and detects upset text', () => {
    expect(pickSongQuery('今天好累，想安静一下')).toBe('放松');
    expect(pickSongQuery('外面下雨了')).toBe('雨天');
    expect(pickSongQuery('晚安')).toBe('夜晚');
    expect(isUpsetText('烦死了')).toBe(true);
  });

  it('enforces cooldown and recent repeats', () => {
    const now = new Date('2026-10-21T12:00:00.000Z');

    expect(canShowRecommendation({
      now,
      itemId: 'song-1',
      lastRecommendedAt: '2026-10-21T11:30:00.000Z',
    })).toBe(false);

    expect(canShowRecommendation({
      now,
      itemId: 'song-1',
      recent: [{ itemId: 'song-1', at: '2026-10-20T12:00:00.000Z' }],
    })).toBe(false);

    expect(canShowRecommendation({
      now,
      itemId: 'song-1',
      lastRecommendedAt: '2026-10-21T09:00:00.000Z',
      recent: [{ itemId: 'song-1', at: '2026-10-01T12:00:00.000Z' }],
    })).toBe(true);
  });
});
