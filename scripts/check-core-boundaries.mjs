import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const coreDir = path.join(root, 'packages', 'core', 'src');
const forbidden = [
  /^(?:src|apps|adapters|private|electron)\//,
  /^\.\.\/(?:\.\.\/)*(?:src|apps|adapters|private|electron)\//,
  /^@herein\/private/,
];

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }

      files.push(...await collect(full));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(full);
    }
  }

  return files;
}

let files;
try {
  files = await collect(coreDir);
} catch (error) {
  console.error(`core boundary check failed: cannot read ${coreDir}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

let failed = false;
const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const relative = path.relative(root, file);

  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];

    if (forbidden.some(pattern => pattern.test(specifier))) {
      console.error(`${relative}: forbidden import "${specifier}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('core boundary check failed');
  process.exit(1);
}

console.log(`core boundary ok (${files.length} files)`);
