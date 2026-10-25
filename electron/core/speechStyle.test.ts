/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { splitSpeechParts, toSpeechStyle } from './speechStyle';

describe('speech style', () => {
  it('turns written text into short spoken clauses', () => {
    const text = toSpeechStyle('总的来说，我觉得你可以先休息一下；明天再处理。');

    expect(text).not.toContain('总的来说');
    expect(text).not.toContain('；');
  });

  it('splits a long reply into at most three parts', () => {
    const parts = splitSpeechParts('今天有点累。你先睡吧。明天再说。我这边也没什么事。', 3);

    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.join('')).toContain('今天有点累');
  });

  it('splits an overlong sentence at a comma', () => {
    const parts = splitSpeechParts('我今天在楼下看到一只特别胖的橘猫，它蹲在电动车上面一动不动，旁边还有人给它拍照，我看了好久才走。', 3, 20);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(part => part.length <= 22)).toBe(true);
  });

  it('returns an empty list for empty text', () => {
    expect(splitSpeechParts('   ')).toEqual([]);
  });
});
