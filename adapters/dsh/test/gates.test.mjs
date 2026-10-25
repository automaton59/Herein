import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DshBridge } from '../src/bridge.mjs';
import { createAuthority, approvePlan } from '../src/approval.mjs';
import { stageArtifact } from '../src/artifact.mjs';
import { DSH_INSTALL as install, DSH_SKIP } from './install-path.mjs';
const hello = resolve(import.meta.dirname, '../fixtures/hello-v1');

test('invalid bundle and incompatible DSH version fail without damaging the profile; saved disablement survives restart', { timeout: 90000, skip: DSH_SKIP }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'herein-gates-')), keys = createAuthority();
  let bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey }); t.after(() => bridge.close());
  const execute = async request => { const plan = await bridge.prepare(request); return bridge.execute(plan.id, approvePlan(plan, keys.privateKey, 'gate fixture operator')); };
  const invalid = join(root, 'not-bundle'); await mkdir(invalid);
  await writeFile(join(invalid, 'package.json'), '{"name":"@herein/not-bundle","version":"1.0.0"}');
  let before = await bridge.stateHash();
  const rejected = await execute({ action: 'install', target: invalid });
  assert.equal(rejected.application, 'failed'); assert.equal(rejected.errorCode, 'not-bundle'); assert.equal(rejected.recovery.status, 'restored'); assert.equal(await bridge.stateHash(), before);
  const incompatible = join(root, 'incompatible'); await mkdir(incompatible);
  await writeFile(join(incompatible, 'package.json'), '{"name":"@herein/incompatible","version":"1.0.0","engines":{"dsh":">=999"},"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}');
  await writeFile(join(incompatible, 'cordis.patch.yml'), '[]\n');
  const refused = await execute({ action: 'install', target: incompatible });
  assert.equal(refused.errorCode, 'incompatible-version'); assert.equal(await bridge.stateHash(), before);
  await execute({ action: 'install', target: hello, enabled: true });
  const row = (await bridge.inventory()).plugins.find(row => row.moduleName === '@herein/dsh-hello');
  await execute({ action: 'setPlugin', target: row.entryId, enabled: false });
  await bridge.close(); bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey });
  const current = (await bridge.inventory()).plugins.find(row => row.moduleName === '@herein/dsh-hello');
  assert.equal(current.enabled, false); assert.equal(current.fiberPhase, null); assert.equal((await bridge.inventory()).capabilities.length, 0);
  await assert.rejects(bridge.prepare({ action: 'setPlugin', target: 'include:plugin-manager', enabled: false }), { code: 'MANAGEMENT_PROTECTED' });
  await assert.rejects(bridge.prepare({ action: 'setPlugin', target: 'include:system-prompt', enabled: false }), { code: 'MANAGEMENT_PROTECTED' });
  console.log(JSON.stringify({ invalid: rejected.errorCode, incompatible: refused.errorCode, disabledAfterRestart: current.enabled }));
});

test('state changes and post-review package edits invalidate approval; protected desktop paths are refused', { timeout: 60000, skip: DSH_SKIP }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'herein-integrity-')), keys = createAuthority();
  const bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey }); t.after(() => bridge.close());
  await assert.rejects(DshBridge.open({ root: join(process.env.USERPROFILE, '.dsh/profiles/desktop'), install, publicKey: keys.publicKey }), { code: 'PROTECTED_DSH_LOCATION' });
  const plan = await bridge.prepare({ action: 'install', target: hello });
  await appendFile(join(bridge.state, 'artifacts', plan.artifact.id, 'index.js'), '\n// edited after review');
  await assert.rejects(bridge.execute(plan.id, approvePlan(plan, keys.privateKey, 'review fixture operator')), { code: 'ARTIFACT_CHANGED' });
  const restart = await bridge.prepare({ action: 'restart' });
  await appendFile(join(bridge.dir, 'cordis.patch.yml'), '\n# outside bridge\n');
  await assert.rejects(bridge.execute(restart.id, approvePlan(restart, keys.privateKey, 'review fixture operator')), { code: 'STALE_PLAN' });
  await assert.rejects(bridge.prepare({ action: 'restart' }), { code: 'PROFILE_CHANGED_OUTSIDE_BRIDGE' });
});

test('unreviewed transitive dependency declarations never reach installation', { skip: DSH_SKIP }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'herein-deps-')), source = join(root, 'package'); await mkdir(source);
  await writeFile(join(source, 'package.json'), '{"name":"@herein/deps","version":"1.0.0","dependencies":{"unreviewed-code":"*"}}');
  await assert.rejects(stageArtifact(source, root), { code: 'DEPENDENCY_CLOSURE_REQUIRED' });
});
