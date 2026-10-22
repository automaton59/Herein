import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DshBridge } from '../src/bridge.mjs';
import { createAuthority, approvePlan } from '../src/approval.mjs';
import { serveBridge } from '../src/server.mjs';
import { DshBridgeClient } from '../src/client.mjs';
import { digest } from '../src/common.mjs';

const install = process.env.HEREIN_DSH_INSTALL || 'C:/Users/wzy_8/AppData/Local/Programs/DeepSeek Harness';
const root = await mkdtemp(join(tmpdir(), 'herein-dsh-demo-'));
const keys = createAuthority(), token = randomBytes(32).toString('base64url');
const desktop = join(process.env.USERPROFILE, '.dsh/profiles/desktop');
const fileNames = ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml'];
const hashes = async () => Object.fromEntries(await Promise.all(fileNames.map(async name => [name, digest(await readFile(join(desktop, name)))])));
const before = await hashes(), steps = [];
let bridge, server, client;
const open = async () => {
  bridge = await DshBridge.open({ root, install, publicKey: keys.publicKey });
  server = await serveBridge(bridge, { token });
  client = new DshBridgeClient({ url: server.url, token });
};
const close = async () => { await server?.close(); server = undefined; await bridge?.close(); bridge = undefined; };
const change = async request => {
  const plan = await client.prepare(request);
  // Demo authorization is limited to repository-authored hello and a generated
  // throwing fixture. No arbitrary package or external code enters this path.
  const result = await client.execute(plan.id, approvePlan(plan, keys.privateKey, 'local demo operator: repository fixtures only'), randomUUID());
  const { inventory: _inventory, ...evidence } = result;
  steps.push({ action: request.action, ...evidence });
  console.log(`${request.action}: ${result.application}${result.recovery ? ', recovery=' + result.recovery.status : ''}`);
  return result;
};
const call = async expected => { const value = await client.call('herein_hello', { name: 'Herein' }); assert.equal(value.value, expected); steps.push({ action: 'call', value: value.value }); console.log(value.value); };
try {
  await open();
  const health = await client.health(); steps.push({ action: 'health', ...health });
  assert.equal((await change({ action: 'install', target: resolve(import.meta.dirname, '../fixtures/hello-v1'), enabled: false })).application, 'applied');
  assert.equal((await client.inventory()).capabilities.length, 0);
  assert.equal((await change({ action: 'setBundle', target: '@herein/dsh-hello', enabled: true })).application, 'applied');
  await call('hello Herein (v1)');
  const plugin = (await client.inventory()).plugins.find(row => row.moduleName === '@herein/dsh-hello');
  const disabled = await change({ action: 'setPlugin', target: plugin.entryId, enabled: false });
  assert.equal((await client.call('herein_hello', { name: 'Herein' })).error.info.code, 'UNKNOWN_TOOL');
  await change({ action: 'rollback', snapshotId: disabled.snapshotId }); await call('hello Herein (v1)');
  const updated = await change({ action: 'update', target: resolve(import.meta.dirname, '../fixtures/hello-v2'), enabled: true });
  await call('hello Herein (v2)');
  await change({ action: 'rollback', snapshotId: updated.snapshotId }); await call('hello Herein (v1)');
  const bad = join(root, 'throwing-fixture'); await mkdir(bad);
  await writeFile(join(bad, 'package.json'), JSON.stringify({ name: '@herein/demo-broken', version: '1.0.0', private: true, type: 'module', exports: { '.': './index.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(bad, 'cordis.patch.yml'), '- insert:\n    - id: herein-demo-broken\n      name: "@herein/demo-broken"\n');
  await writeFile(join(bad, 'index.js'), 'export function apply() { throw new Error("FAKE_DEMO_SECRET_73"); }');
  const failed = await change({ action: 'install', target: bad, enabled: true });
  assert.equal(failed.application, 'failed'); assert.equal(failed.recovery.status, 'restored');
  await call('hello Herein (v1)');
  await close(); await open(); await call('hello Herein (v1)');
  const records = (await client.audit()).records;
  assert.ok(!JSON.stringify(records).includes('FAKE_DEMO_SECRET_73'));
  const after = await hashes(); assert.deepEqual(after, before);
  const report = { date: new Date().toISOString(), runtimeVersion: health.runtimeVersion, profileId: health.profileId, steps, auditRecords: records.length, auditHead: records.at(-1).hash, desktopHashesBefore: before, desktopHashesAfter: after, desktopUnchanged: true, root, profile: bridge.dir, audit: bridge.audit.path };
  const reportPath = process.env.HEREIN_DSH_REPORT || join(root, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, report: reportPath, audit: bridge.audit.path, profile: bridge.dir, desktopUnchanged: true }));
} finally { await close(); }
