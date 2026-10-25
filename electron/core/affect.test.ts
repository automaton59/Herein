/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { affectPrompt, computeAffect } from './affect';

describe('affect state', () => {
  it('is more energetic at noon than at 3am', () => {
    const noon = computeAffect({
      characterId: 'char-1',
      now: new Date('2026-10-24T12:00:00'),
      recent: [],
    });
    const night = computeAffect({
      characterId: 'char-1',
      now: new Date('2026-10-24T03:00:00'),
      recent: [],
    });

    expect(noon.energy).toBeGreaterThan(night.energy);
  });

  it('lowers mood after negative messages and raises it after positive ones', () => {
    const negative = computeAffect({
      characterId: 'char-1',
      now: new Date('2026-10-24T12:00:00'),
      recent: [
        { role: 'user', content: '今天累死了，烦死了' },
        { role: 'user', content: '压力好大，想哭' },
      ],
    });
    const positive = computeAffect({
      characterId: 'char-1',
      now: new Date('2026-10-24T12:00:00'),
      recent: [
        { role: 'user', content: '今天很开心，事情都搞定了' },
        { role: 'user', content: '好棒，哈哈' },
      ],
    });

    expect(negative.mood).toBeLessThan(0);
    expect(positive.mood).toBeGreaterThan(0);
  });

  it('renders a compact prompt block', () => {
    const state = computeAffect({
      characterId: 'char-1',
      now: new Date('2026-10-24T03:00:00'),
      recent: [{ role: 'user', content: '好累' }],
    });
    const prompt = affectPrompt(state);

    expect(prompt).toContain('【现在的你】');
    expect(prompt).toContain('精力：');
    expect(prompt).toContain('心情：');
  });
});
