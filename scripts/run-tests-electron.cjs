const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// better-sqlite3 in this repository is normally built for Electron. Run Vitest
// through Electron's Node runtime so tests do not require an ABI swap. Some
// Windows profiles do not allow the default temp directory under Electron, so
// keep test scratch inside the workspace.
const tempDir = path.join(process.cwd(), 'tmp', 'vitest-temp');
fs.mkdirSync(tempDir, { recursive: true });

const electron = require('electron');
const result = spawnSync(
  electron,
  ['node_modules/vitest/vitest.mjs', 'run', '--passWithNoTests', ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TMP: tempDir,
      TEMP: tempDir,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
