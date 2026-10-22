#!/usr/bin/env node

const pairs = [
  { name: 'slate-950 on white', fg: '#020617', bg: '#ffffff', min: 12 },
  { name: 'slate-700 on white', fg: '#334155', bg: '#ffffff', min: 7 },
  { name: 'slate-500 on canvas', fg: '#64748b', bg: '#f6fbff', min: 4.5 },
  { name: 'sky-700 on canvas', fg: '#0369a1', bg: '#f6fbff', min: 4.5 },
  { name: 'white on sky-700', fg: '#ffffff', bg: '#0369a1', min: 4.5 },
  { name: 'white on sky-800', fg: '#ffffff', bg: '#075985', min: 4.5 },
  { name: 'sky-200 on night', fg: '#bae6fd', bg: '#04101a', min: 7 },
  { name: 'slate-400 on night', fg: '#94a3b8', bg: '#04101a', min: 4.5 },
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
