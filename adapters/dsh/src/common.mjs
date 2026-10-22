import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { mkdir, lstat, readdir, readFile, realpath, open, rename } from 'node:fs/promises';

export const fail = code => Object.assign(new Error(code), { code });
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  throw fail('INVALID_JSON');
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'));
}
export async function assertOwnedPath(root, path) {
  if (!within(root, path)) throw fail('PATH_OUTSIDE_ROOT');
  const rootReal = await realpath(root);
  let candidate = resolve(path);
  while (true) {
    try { if (!within(rootReal, await realpath(candidate))) throw fail('PATH_SYMLINK_ESCAPE'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; candidate = dirname(candidate); }
  }
}
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.new';
  const fd = await open(temp, 'w', 0o600);
  try { await fd.writeFile(canonical(value) + '\n'); await fd.sync(); } finally { await fd.close(); }
  await rename(temp, path);
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function fileTreeDigest(root) {
  const rows = [];
  let total = 0;
  async function walk(dir) {
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      const path = join(dir, name), stat = await lstat(path);
      if (stat.isSymbolicLink()) throw fail('ARTIFACT_SYMLINK');
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) {
        total += stat.size;
        if (total > 256 * 1024 * 1024 || rows.length > 20000) throw fail('ARTIFACT_TOO_LARGE');
        rows.push([relative(root, path).replaceAll('\\', '/'), digest(await readFile(path))]);
      } else throw fail('ARTIFACT_SPECIAL_FILE');
    }
  }
  await walk(root);
  return { hash: digest(rows), files: rows.length, bytes: total };
}

// Public output is an allowlist. DSH diagnostics, configs, source URLs, logs and
// tool arguments/results never enter the audit journal or provider inventory.
export function safeChange(raw) {
  return Object.fromEntries(Object.entries({
    changed: !!raw.changed, application: raw.application, stage: raw.stage,
    restartReason: raw.restartReason, errorCode: raw.error?.code,
    failureKind: raw.packageResult?.kind, exitCode: raw.packageResult?.exitCode,
    pendingBuilds: raw.pendingBuilds, approvedBuilds: raw.approvedBuilds,
    bundle: raw.bundle, version: raw.version
  }).filter(([, value]) => value !== undefined));
}
export function safeInventory(raw) {
  const meta = value => value ? Object.fromEntries(['title', 'description'].filter(key => value[key] !== undefined).map(key => [key, value[key]])) : undefined;
  return {
    plugins: raw.plugins.map(row => Object.fromEntries(['entryId', 'patchId', 'moduleName', 'enabled', 'fiberPhase', 'readOnlyReason', 'meta'].filter(key => row[key] !== undefined).map(key => [key, key === 'meta' ? meta(row[key]) : row[key]]))),
    bundles: raw.bundles.map(row => Object.fromEntries(['name', 'version', 'enabled', 'installed', 'availability', 'removable', 'meta', 'error'].filter(key => row[key] !== undefined).map(key => [key, key === 'error' ? { code: row.error?.code || 'BUNDLE_UNAVAILABLE' } : key === 'meta' ? meta(row[key]) : row[key]]))),
    capabilities: raw.capabilities.map(row => ({ name: row.name, description: row.description, parameters: row.parameters, ...(row.output === undefined ? {} : { output: row.output }), ...(row.parallelSafe === undefined ? {} : { parallelSafe: row.parallelSafe }) }))
  };
}
