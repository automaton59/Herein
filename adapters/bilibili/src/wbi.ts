import { createHash } from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const;

export function extractWbiKey(url: string | undefined): string {
  if (!url) {
    return '';
  }

  const file = url.split('/').pop() ?? '';
  return file.split('.')[0] ?? '';
}

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`;
  return MIXIN_KEY_ENC_TAB.map(index => raw[index] ?? '').join('').slice(0, 32);
}

export function signWbiParams(
  params: Record<string, string | number | boolean | undefined | null>,
  key: string,
  nowSeconds: number,
) {
  const values: Record<string, string> = {};

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    values[name] = String(value).replace(/[!'()*]/g, '');
  }

  values.wts = String(nowSeconds);

  const query = Object.keys(values)
    .sort()
    .map(name => `${encodeURIComponent(name)}=${encodeURIComponent(values[name])}`)
    .join('&');
  const wRid = createHash('md5').update(`${query}${key}`).digest('hex');

  return {
    query: `${query}&w_rid=${wRid}`,
    wts: values.wts,
    wRid,
  };
}
