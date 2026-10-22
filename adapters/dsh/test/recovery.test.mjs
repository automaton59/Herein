import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, access } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DshBridge } from '../src/bridge.mjs';
import { createAuthority, approvePlan } from '../src/approval.mjs';
import { snapshotProfile } from '../src/profile.mjs';
import { atomicJson } from '../src/common.mjs';

const install = process.env.HEREIN_DSH_INSTALL || 'C:/Users/wzy_8/AppData/Local/Programs/DeepSeek Harness';
async function execute(bridge, keys, request) {
  const plan = await bridge.prepare(request);
  return bridge.execute(plan.id, approvePlan(plan, keys.privateKey, 'reviewed local test fixture'));
}
async function scriptFixture(root, name, body) {
  const dir = join(root, name); await mkdir(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@herein/' + name, version: '1.0.0', private: true, type: 'module', scripts: { postinstall: 'node build.cjs' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(dir, 'cordis.patch.yml'), '[]\n');
  await writeFile(join(dir, 'build.cjs'), body);
  return dir;
}
test('unapproved dependency scripts are blocked; explicit signed approval runs only the reviewed script', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'herein-build-')), keys = createAuthority();
  const bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey }); t.after(() => bridge.close());
  const marker = join(root, 'reviewed-build-ran');
  const fixture = await scriptFixture(root, 'safe-build', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'trusted test fixture');`);
  const blocked = await execute(bridge, keys, { action: 'install', target: fixture });
  assert.equal(blocked.application, 'failed'); assert.equal(blocked.failureKind, 'build-blocked');
  assert.equal(blocked.pendingBuilds.length, 1); assert.ok(blocked.pendingBuilds[0].startsWith('@herein/safe-build@file:'));
  await assert.rejects(access(marker), { code: 'ENOENT' });
  assert.ok((await readFile(join(bridge.dir, 'pnpm-workspace.yaml'), 'utf8')).includes('set this to true or false'));
  const approved = await execute(bridge, keys, { action: 'install', target: fixture, approvedBuilds: blocked.pendingBuilds });
  assert.equal(approved.application, 'applied');
  assert.equal(await readFile(marker, 'utf8'), 'trusted test fixture');
  console.log(JSON.stringify({ blocked: { application: blocked.application, failureKind: blocked.failureKind, pendingBuilds: blocked.pendingBuilds }, approved: { application: approved.application, approvedBuilds: approved.approvedBuilds } }));
});

test('Host crash and interrupted bridge journal restore snapshots without restarting an incomplete install', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'herein-crash-')), keys = createAuthority();
  let bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey }); t.after(() => bridge.close());
  const started = join(root, 'build-process.json');
  const fixture = await scriptFixture(root, 'crash-build', `require('node:fs').writeFileSync(${JSON.stringify(started)}, JSON.stringify({pid:process.pid})); setInterval(() => {}, 1000);`);
  const blocked = await execute(bridge, keys, { action: 'install', target: fixture }); assert.equal(blocked.failureKind, 'build-blocked');
  const plan = await bridge.prepare({ action: 'install', target: fixture, approvedBuilds: blocked.pendingBuilds });
  const originalHash = await bridge.stateHash();
  const pending = bridge.execute(plan.id, approvePlan(plan, keys.privateKey, 'reviewed local hanging fixture'));
  const deadline = Date.now() + 15000;
  let buildPid;
  while (Date.now() < deadline) {
    try { buildPid = JSON.parse(await readFile(started, 'utf8')).pid; break; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(buildPid, 'the approved hanging build actually started');
  const exited = new Promise(resolve => bridge.host.child.once('exit', resolve)); bridge.host.child.kill(); await exited;
  const crashed = await pending;
  assert.equal(crashed.errorCode, 'HOST_EXITED'); assert.equal(crashed.recovery.status, 'restored');
  assert.throws(() => process.kill(buildPid, 0), { code: 'ESRCH' });
  assert.equal(await bridge.stateHash(), originalHash);
  const snapshotId = await snapshotProfile(bridge.dir, bridge.state, 'interruption-test');
  const operationId = randomUUID(), planId = randomUUID();
  await atomicJson(join(bridge.state, 'transactions', operationId + '.json'), { operationId, planId, snapshotId, phase: 'pending' });
  await bridge.audit.append('operation.started', { operationId, planId, action: 'install', snapshotId });
  await appendFile(join(bridge.dir, 'cordis.patch.yml'), '\n# partially saved operation\n');
  await bridge.close();
  bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey });
  assert.equal(bridge.audit.operation(operationId).errorCode, 'BRIDGE_INTERRUPTED');
  assert.equal(await bridge.stateHash(), originalHash);
  console.log(JSON.stringify({ crashed: { errorCode: crashed.errorCode, recovery: crashed.recovery }, interrupted: bridge.audit.operation(operationId) }));
});

test('cancel waits for the approved build to stop and restores profile and build permissions', { timeout: 90000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'herein-cancel-')), keys = createAuthority();
  const bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey }); t.after(() => bridge.close());
  const started = join(root, 'build-started');
  const fixture = await scriptFixture(root, 'cancel-build', `require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started'); setInterval(() => {}, 1000);`);
  const blocked = await execute(bridge, keys, { action: 'install', target: fixture }); assert.equal(blocked.failureKind, 'build-blocked');
  const before = await bridge.stateHash();
  const plan = await bridge.prepare({ action: 'install', target: fixture, approvedBuilds: blocked.pendingBuilds });
  const id = randomUUID(), pending = bridge.execute(plan.id, approvePlan(plan, keys.privateKey, 'cancel fixture operator'), id);
  const deadline = Date.now() + 15000;
  let running = false;
  while (Date.now() < deadline) { try { await access(started); running = true; break; } catch {} await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.ok(running);
  const cancel = await bridge.cancel(id);
  const result = await pending;
  assert.equal(cancel.status, 'cancelled'); assert.equal(result.application, 'cancelled');
  assert.equal(result.recovery.status, 'restored'); assert.equal(await bridge.stateHash(), before);
  console.log(JSON.stringify({ cancel: cancel.status, application: result.application, recovery: result.recovery.status }));
});

test('killing the actual bridge process terminates Host/build descendants; new bridge replays its recovery journal', { timeout: 90000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'herein-abrupt-')), keys = createAuthority();
  let bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey });
  t.after(async () => bridge?.close());
  const marker = join(root, 'live-build.json');
  const fixture = await scriptFixture(root, 'abrupt-build', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid})); setInterval(() => {}, 1000);`);
  const blocked = await execute(bridge, keys, { action: 'install', target: fixture });
  assert.equal(blocked.failureKind, 'build-blocked');
  const plan = await bridge.prepare({ action: 'install', target: fixture, approvedBuilds: blocked.pendingBuilds });
  const stateHash = await bridge.stateHash(); await bridge.close(); bridge = undefined;
  const keyPath = join(root, 'public.pem'); await writeFile(keyPath, keys.publicKey);
  const worker = fork(new URL('./bridge-worker.mjs', import.meta.url), [root, install, keyPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => worker.kill());
  const [ready] = await once(worker, 'message'); assert.equal(ready.type, 'ready');
  const operationId = randomUUID();
  worker.send({ planId: plan.id, operationId, approval: approvePlan(plan, keys.privateKey, 'abrupt crash fixture operator') });
  let buildPid;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { try { buildPid = JSON.parse(await readFile(marker, 'utf8')).pid; break; } catch {} await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.ok(buildPid);
  const exit = once(worker, 'exit'); worker.kill(); await exit;
  const goneDeadline = Date.now() + 10000;
  let gone = false;
  while (Date.now() < goneDeadline) {
    try { process.kill(buildPid, 0); } catch (e) { if (e.code === 'ESRCH') { gone = true; break; } throw e; }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.ok(gone, 'Job Object stopped the running approved build');
  assert.throws(() => process.kill(ready.hostPid, 0), { code: 'ESRCH' });
  bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey });
  const result = bridge.audit.operation(operationId);
  assert.equal(result.errorCode, 'BRIDGE_INTERRUPTED'); assert.equal(result.recovery.status, 'restored');
  assert.equal(await bridge.stateHash(), stateHash);
  console.log(JSON.stringify({ actualBridgeKilled: true, hostStopped: true, buildStopped: true, recovery: result.recovery.status }));
});
