import { describe, expect, it } from 'vitest';
import { canRecommend, parseRecommendationDecision } from './recommendation';

const now = new Date('2026-10-21T12:00:00.000Z');

describe('recommendation gate', () => {
  it('allows a recommendation after cooldown and turn spacing', () => {
    expect(canRecommend({
      now,
      itemId: 'song-1',
      lastRecommendedAt: '2026-10-21T10:00:00.000Z',
      turnsSinceLast: 12,
      recentItemIds: [],
    })).toEqual({ allowed: true, reason: 'ok' });
  });

  it('blocks when the user is upset, cooldown is active, or item is recent', () => {
    expect(canRecommend({ now, itemId: 'song-1', userMood: 'sad' }).allowed).toBe(false);
    expect(canRecommend({
      now,
      itemId: 'song-1',
      lastRecommendedAt: '2026-10-21T11:30:00.000Z',
      turnsSinceLast: 20,
    })).toEqual({ allowed: false, reason: 'cooldown is still active' });
    expect(canRecommend({
      now,
      itemId: 'song-1',
      turnsSinceLast: 20,
      recentItemIds: ['song-1'],
    })).toEqual({ allowed: false, reason: 'item was recommended recently' });
  });
});

describe('recommendation decision parsing', () => {
  it('accepts no-recommendation and a valid recommendation', () => {
    expect(parseRecommendationDecision({ shouldRecommend: false })).toEqual({ shouldRecommend: false });
    expect(parseRecommendationDecision({
      shouldRecommend: true,
      type: 'song',
      itemId: 'song-1',
      reason: '这个适合你现在。',
      moodTag: '深夜',
      confidence: 0.8,
    })).toEqual({
      shouldRecommend: true,
      type: 'song',
      itemId: 'song-1',
      reason: '这个适合你现在。',
      moodTag: '深夜',
      confidence: 0.8,
    });
  });

  it('rejects malformed decisions', () => {
    expect(() => parseRecommendationDecision({ shouldRecommend: true, type: 'book', itemId: 'x', reason: 'r' })).toThrow('type');
    expect(() => parseRecommendationDecision({ shouldRecommend: true, type: 'song', itemId: '', reason: 'r' })).toThrow('itemId');
    expect(() => parseRecommendationDecision({ shouldRecommend: true, type: 'song', itemId: 'x', reason: 'r', confidence: 2 })).toThrow('confidence');
  });
});
