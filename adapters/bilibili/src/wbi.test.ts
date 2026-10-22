import { describe, expect, it } from 'vitest';
import { extractWbiKey, mixinKey, signWbiParams } from './wbi';

const IMG = '7cd084941338484aae1ad9425b84077c';
const SUB = '4932caff0ff746eab6f01bf08b70ac45';

describe('bilibili WBI signing', () => {
  it('extracts keys from wbi image URLs', () => {
    expect(extractWbiKey(`https://i0.hdslb.com/bfs/wbi/${IMG}.png`)).toBe(IMG);
    expect(extractWbiKey(undefined)).toBe('');
  });

  it('builds a 32-char mixin key', () => {
    expect(mixinKey(IMG, SUB)).toHaveLength(32);
    expect(mixinKey(IMG, SUB)).toBe(mixinKey(IMG, SUB));
  });

  it('signs params deterministically with wts and w_rid', () => {
    const signed = signWbiParams({ bvid: 'BV1xx411c7mD', foo: 'a!b' }, mixinKey(IMG, SUB), 1700000000);

    expect(signed.wts).toBe('1700000000');
    expect(signed.wRid).toMatch(/^[a-f0-9]{32}$/);
    expect(signed.query).toContain('bvid=BV1xx411c7mD');
    expect(signed.query).toContain('wts=1700000000');
    expect(signed.query).toContain(`w_rid=${signed.wRid}`);

    const changed = signWbiParams({ bvid: 'BV1xx411c7mD', foo: 'a!c' }, mixinKey(IMG, SUB), 1700000000);
    expect(changed.wRid).not.toBe(signed.wRid);
  });
});
