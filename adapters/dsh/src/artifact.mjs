import { mkdir, cp, lstat, readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileTreeDigest, readJson, fail, digest, within } from './common.mjs';
import { packReviewedDirectory } from './pack.mjs';

export async function stageArtifact(source, stateRoot) {
  if (!isAbsolute(source) || !(await lstat(source)).isDirectory()) throw fail('LOCAL_ARTIFACT_DIRECTORY_REQUIRED');
  if (within(source, stateRoot)) throw fail('ARTIFACT_CONTAINS_BRIDGE_STATE');
  const before = await fileTreeDigest(source);
  const hex = before.hash.slice(0, 32);
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const path = join(stateRoot, 'artifacts', id);
  await mkdir(path, { recursive: true });
  let existing;
  try { existing = await readJson(join(path, 'package.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!existing) await cp(source, path, { recursive: true });
  const after = await fileTreeDigest(path);
  if (after.hash !== before.hash) throw fail('ARTIFACT_CHANGED_DURING_STAGE');
  const manifest = await readJson(join(path, 'package.json'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw fail('ARTIFACT_MANIFEST_INVALID');
  // Dependency retrieval belongs to a reviewed, pinned artifact preparation
  // workflow. This bridge never silently downloads unreviewed transitive code.
  const dependencyNames = [...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.optionalDependencies || {})];
  const bundled = manifest.bundledDependencies || manifest.bundleDependencies || [];
  if (dependencyNames.some(name => !Array.isArray(bundled) || !bundled.includes(name))) throw fail('DEPENDENCY_CLOSURE_REQUIRED');
  for (const name of dependencyNames) {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw fail('ARTIFACT_MANIFEST_INVALID');
    try { await readJson(join(path, 'node_modules', name, 'package.json')); } catch { throw fail('DEPENDENCY_CLOSURE_REQUIRED'); }
  }
  if (Object.keys(manifest.peerDependencies || {}).some(name => !name.startsWith('@deepseek-ai/dsh') && name !== '@deepseek-ai/cordis')) throw fail('UNSUPPORTED_EXTERNAL_PEER');
  const archive = path + '.tgz'; await packReviewedDirectory(path, archive);
  return { id: path.split(/[\\/]/).at(-1), hash: after.hash, archiveHash: digest(await readFile(archive)), name: manifest.name, version: manifest.version, files: after.files, bytes: after.bytes, hasBundle: !!manifest.dsh?.bundle, scripts: Object.keys(manifest.scripts || {}), dependencies: manifest.dependencies || {}, engines: manifest.engines || {}, peerDependencies: manifest.peerDependencies || {} };
}
export async function verifyArtifact(stateRoot, artifact) {
  if (!/^[a-f0-9-]{36}$/.test(artifact.id)) throw fail('INVALID_ARTIFACT');
  const path = join(stateRoot, 'artifacts', artifact.id);
  if ((await fileTreeDigest(path)).hash !== artifact.hash) throw fail('ARTIFACT_CHANGED');
  if (digest(await readFile(path + '.tgz')) !== artifact.archiveHash) throw fail('ARTIFACT_ARCHIVE_CHANGED');
  return path + '.tgz';
}
