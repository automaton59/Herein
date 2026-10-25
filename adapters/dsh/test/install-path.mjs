import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * These tests drive a real DeepSeek Harness install, so the location has to come
 * from the environment or the platform default. A developer machine path must
 * never be hard-coded here.
 *
 * When no install is found the tests skip rather than fail: the bridge logic is
 * still exercised by the fixtures, and a contributor without DSH is not greeted
 * by a wall of red.
 */
const candidate = process.env.HEREIN_DSH_INSTALL
  ?? (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness')
    : null);

export const DSH_INSTALL = candidate && existsSync(candidate) ? candidate : null;

export const DSH_SKIP = DSH_INSTALL
  ? false
  : 'DeepSeek Harness not installed; set HEREIN_DSH_INSTALL to run this test';
