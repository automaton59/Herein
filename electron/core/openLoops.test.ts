/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { extractOpenLoops } from './openLoops';

describe('open loops', () => {
  it('extracts a promise to come back later', () => {
    expect(extractOpenLoops('嗯，白天我再来看看情况。')).toEqual([
      expect.stringContaining('白天我再来看看情况'),
    ]);
  });

  it('extracts a request to report bugs later', () => {
    expect(extractOpenLoops('要是碰上 bug 了，记得说。')).toEqual([
      expect.stringContaining('记得说'),
    ]);
  });

  it('ignores ordinary statements', () => {
    expect(extractOpenLoops('今天有点累。')).toEqual([]);
    expect(extractOpenLoops('晚安。')).toEqual([]);
  });
});
