import { mkdir, readFile, writeFile, readdir, lstat, readlink, rename, symlink, copyFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, digest, fail, within, readJson } from './common.mjs';

const TRACKED = ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'compatibility.json'];
export async function initProfile(home, profile) {
  const dir = join(home, 'profiles', profile);
  await mkdir(dir, { recursive: true });
  await atomicJson(join(dir, 'package.json'), { name: `dsh-profile-${profile}`, private: true, dependencies: {}, dsh: { profile: { bundles: [] } } });
  await writeFile(join(dir, 'cordis.yml'), '[]\n');
  await atomicJson(join(dir, 'cordis.patch.yml'), [{ insert: [
    { id: 'timer', name: '@deepseek-ai/cordis-plugin-timer' },
    { id: 'hmr', name: '@deepseek-ai/dsh-hmr', config: { root: [] } },
    { id: 'plugin-manager', name: '@deepseek-ai/dsh-plugin-manager', config: { registry: 'https://registry.npmjs.org/', fallbackRegistries: [], inspectTimeoutMs: 5000, idleTimeoutMs: 15000 } },
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
    { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } }
  ] }]);
  await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  return dir;
}
export async function profileHash(dir) {
  const files = [];
  for (const name of TRACKED) {
    let hash = null;
    try { hash = digest(await readFile(join(dir, name))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    files.push([name, hash]);
  }
  return digest(files);
}
async function validateLinks(dir, allowed) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = resolve(dir, await readlink(path));
      if (!allowed.some(root => within(root, target))) throw fail('PROFILE_LINK_OUTSIDE_MANAGED_ROOT');
    } else if (stat.isDirectory()) await validateLinks(path, allowed);
  }
}
async function copyProfile(source, dest, sourceRoot = source, destRoot = dest) {
  await mkdir(dest, { recursive: true });
  for (const name of await readdir(source)) {
    if (name === '.plugin-manager') continue;
    const from = join(source, name), to = join(dest, name), stat = await lstat(from);
    if (stat.isSymbolicLink()) {
      // pnpm's Windows local-directory links are junctions. fs.cp attempts a
      // privileged symbolic link instead, so preserve directory junctions.
      const target = resolve(source, await readlink(from));
      // Rebase links internal to node_modules onto the copied tree.
      await symlink(within(sourceRoot, target) ? resolve(destRoot, relative(sourceRoot, target)) : target, to, 'junction');
    } else if (stat.isDirectory()) await copyProfile(from, to, sourceRoot, destRoot);
    else if (stat.isFile()) await copyFile(from, to);
    else throw fail('PROFILE_SPECIAL_FILE');
  }
}
export async function profileTreeHash(dir) {
  const rows = [];
  async function walk(path, prefix = '') {
    for (const name of (await readdir(path)).sort()) {
      if (name === '.plugin-manager') continue;
      const file = join(path, name), key = prefix + name, stat = await lstat(file);
      if (stat.isSymbolicLink()) { const target = resolve(path, await readlink(file)); rows.push([key, 'link', within(dir, target) ? relative(dir, target) : target]); }
      else if (stat.isDirectory()) await walk(file, key + '/');
      else if (stat.isFile()) rows.push([key, digest(await readFile(file))]);
      else throw fail('PROFILE_SPECIAL_FILE');
    }
  }
  await walk(dir);
  return digest(rows);
}
export async function snapshotProfile(dir, stateRoot, label) {
  await validateLinks(dir, [dir, join(stateRoot, 'artifacts')]);
  const id = randomUUID(), dest = join(stateRoot, 'snapshots', id);
  await mkdir(dest, { recursive: true });
  await copyProfile(dir, join(dest, 'profile'));
  await atomicJson(join(dest, 'meta.json'), { id, label, profileHash: await profileHash(dir), treeHash: await profileTreeHash(join(dest, 'profile')), time: new Date().toISOString() });
  return id;
}
export async function restoreProfile(dir, stateRoot, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw fail('INVALID_SNAPSHOT');
  const source = join(stateRoot, 'snapshots', id);
  const meta = await readJson(join(source, 'meta.json'));
  if (await profileHash(join(source, 'profile')) !== meta.profileHash || await profileTreeHash(join(source, 'profile')) !== meta.treeHash) throw fail('SNAPSHOT_CORRUPT');
  await validateLinks(join(source, 'profile'), [join(source, 'profile'), join(stateRoot, 'artifacts')]);
  const staging = dir + '.restore-' + randomUUID(), old = join(stateRoot, 'quarantine', randomUUID());
  await copyProfile(join(source, 'profile'), staging);
  await mkdir(join(stateRoot, 'quarantine'), { recursive: true });
  await rename(dir, old);
  try { await rename(staging, dir); } catch (e) { await rename(old, dir); throw e; }
  // Quarantine retains diagnostics for local operator investigation. It is not
  // exposed in API results and is outside every running DSH profile.
  return meta;
}
