#!/usr/bin/env node

const pairs = [
  { name: 'ink on canvas', fg: '#1c2333', bg: '#f7f6fb', min: 12 },
  { name: 'slate-700 on white', fg: '#41495c', bg: '#ffffff', min: 7 },
  { name: 'muted on white', fg: '#69718a', bg: '#ffffff', min: 4.5 },
  { name: 'deep blue on white', fg: '#3b4474', bg: '#ffffff', min: 4.5 },
  { name: 'white on deep blue', fg: '#ffffff', bg: '#3b4474', min: 4.5 },
  { name: 'white on deeper navy', fg: '#ffffff', bg: '#323962', min: 7 },
  { name: 'sky-200 on night', fg: '#d8dcf0', bg: '#0b1020', min: 7 },
  { name: 'slate-400 on night', fg: '#9ba3b7', bg: '#0b1020', min: 4.5 },
];

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

let failed = false;

for (const pair of pairs) {
  const ratio = contrast(pair.fg, pair.bg);
  const pass = ratio >= pair.min;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${pair.name}: ${ratio.toFixed(2)} (min ${pair.min})`);

  if (!pass) {
    failed = true;
  }
}

if (failed) {
  console.error('contrast check failed');
  process.exit(1);
}

console.log('contrast check ok');
