import { mkdir, open, readFile, unlink, readdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DshHost } from './host.mjs';
import { AuditJournal } from './audit.mjs';
import { validateApproval } from './approval.mjs';
import { initProfile, profileHash, profileTreeHash, snapshotProfile, restoreProfile } from './profile.mjs';
import { stageArtifact, verifyArtifact } from './artifact.mjs';
import { atomicJson, readJson, canonical, digest, fail, assertOwnedPath, safeChange, safeInventory, within } from './common.mjs';

const ACTIONS = new Set(['install', 'update', 'setPlugin', 'setBundle', 'remove', 'rollback', 'restart']);
const UUID = /^[a-f0-9-]{36}$/;
export class DshBridge {
  static async open(options) {
    const bridge = new DshBridge(options);
    try { await bridge.initialize(); return bridge; } catch (e) { await bridge.close(); throw e; }
  }
  constructor({ root, install, publicKey }) {
    if (!root || !install || !publicKey) throw fail('BRIDGE_CONFIGURATION_REQUIRED');
    this.root = resolve(root); this.install = resolve(install); this.publicKey = publicKey;
    const userHome = process.env.USERPROFILE || process.env.HOME;
    if (userHome && within(resolve(userHome, '.dsh'), this.root) || within(this.install, this.root)) throw fail('PROTECTED_DSH_LOCATION');
    this.home = join(this.root, 'home'); this.state = join(this.root, 'state');
    this.profile = 'herein-b-test'; this.dir = join(this.home, 'profiles', this.profile);
    this.tail = Promise.resolve(); this.controllers = new Map(); this.inFlight = new Map();
  }
  async initialize() {
    await mkdir(this.root, { recursive: true });
    const rootReal = await realpath(this.root), userHome = process.env.USERPROFILE || process.env.HOME;
    if (userHome && within(resolve(userHome, '.dsh'), rootReal) || within(await realpath(this.install), rootReal)) throw fail('PROTECTED_DSH_LOCATION');
    await assertOwnedPath(this.root, this.root);
    await mkdir(this.state, { recursive: true });
    await assertOwnedPath(this.root, this.state);
    this.lockPath = join(this.root, 'bridge.lock');
    try { this.lock = await open(this.lockPath, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const lock = await readJson(this.lockPath);
      try { process.kill(lock.pid, 0); throw fail('BRIDGE_LOCKED'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (lock.hostPid) {
        const deadline = Date.now() + 10000;
        let gone = false;
        while (Date.now() < deadline) {
          try { process.kill(lock.hostPid, 0); } catch (error) { if (error.code === 'ESRCH') { gone = true; break; } throw error; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!gone) throw fail('PREVIOUS_HOST_STILL_RUNNING');
      }
      await unlink(this.lockPath); this.lock = await open(this.lockPath, 'wx', 0o600);
    }
    await this.lock.writeFile(canonical({ pid: process.pid })); await this.lock.sync();
    this.audit = new AuditJournal(join(this.state, 'audit.jsonl')); await this.audit.load();
    const configPath = join(this.root, 'bridge.json');
    let config;
    try { config = await readJson(configPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!config) {
      if ((await readdir(this.root)).some(name => !['bridge.lock', 'state'].includes(name))) throw fail('DEDICATED_EMPTY_ROOT_REQUIRED');
      await initProfile(this.home, this.profile);
      config = { protocol: 1, profileId: randomUUID(), publicKey: this.publicKey, install: this.install };
      await atomicJson(configPath, config);
      await this.audit.append('profile.created', { profileId: config.profileId });
    }
    if (config.publicKey !== this.publicKey || config.install !== this.install) throw fail('BRIDGE_CONFIGURATION_MISMATCH');
    this.profileId = config.profileId;
    await assertOwnedPath(this.root, this.dir);
    await mkdir(join(this.state, 'plans'), { recursive: true });
    await mkdir(join(this.state, 'transactions'), { recursive: true });
    await this.recoverInterrupted();
    await this.verifyInstalledArtifacts();
    await this.verifyCheckpoint();
    await this.startHost();
    await this.saveCheckpoint();
  }
  async startHost() {
    await assertOwnedPath(this.root, this.dir);
    await this.verifyInstalledArtifacts();
    this.host = new DshHost({ install: this.install, home: this.home, profile: this.profile, cwd: this.root, onExit: info => { if (!this.host.stopping && !this.closing) this.audit.append('host.exited', { code: info.code, signal: info.signal }).catch(() => {}); } });
    const ready = await this.host.start();
    await this.lock.truncate(0);
    await this.lock.write(canonical({ pid: process.pid, hostPid: this.host.child.pid }), 0, 'utf8');
    await this.lock.sync();
    this.runtimeVersion = ready.version;
    await this.audit.append('host.started', { runtimeVersion: ready.version });
  }
  serialize(fn) { const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result; }
  async inventory() { return this.serialize(() => this.readInventory()); }
  async readInventory() {
    const inventory = safeInventory(await this.host.request('inventory'));
    await this.audit.append('inventory.read', { pluginCount: inventory.plugins.length, bundleCount: inventory.bundles.length, capabilityCount: inventory.capabilities.length });
    return inventory;
  }
  async stateHash() { return profileHash(this.dir); }
  async verifyCheckpoint() {
    let checkpoint;
    try { checkpoint = await readJson(join(this.state, 'checkpoint.json')); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (checkpoint.treeHash !== await profileTreeHash(this.dir)) throw fail('PROFILE_CHANGED_OUTSIDE_BRIDGE');
  }
  async saveCheckpoint() { await atomicJson(join(this.state, 'checkpoint.json'), { treeHash: await profileTreeHash(this.dir) }); }
  async verifyInstalledArtifacts() {
    const dependencies = (await readJson(join(this.dir, 'package.json'))).dependencies || {};
    for (const spec of Object.values(dependencies)) {
      if (typeof spec !== 'string' || !spec.startsWith('file:')) throw fail('UNMANAGED_DEPENDENCY');
      const path = resolve(this.dir, spec.slice(5));
      await assertOwnedPath(join(this.state, 'artifacts'), path);
      const id = path.split(/[\\/]/).at(-1).replace(/\.tgz$/, '');
      const artifact = await readJson(join(this.state, 'artifact-manifests', id + '.json'));
      await verifyArtifact(this.state, artifact);
    }
  }
  async prepare(request) {
    return this.serialize(async () => {
      if (!request || typeof request !== 'object') throw fail('INVALID_REQUEST');
      if (!ACTIONS.has(request.action)) throw fail('UNKNOWN_ACTION');
      await assertOwnedPath(this.root, this.dir);
      await this.verifyCheckpoint();
      const plan = { protocol: 1, id: randomUUID(), profileId: this.profileId, runtimeVersion: this.runtimeVersion, stateHash: await this.stateHash(), action: request.action, createdAt: Date.now(), expiresAt: Date.now() + 600000 };
      if (['install', 'update'].includes(request.action)) {
        plan.artifact = await stageArtifact(request.target, this.state);
        await atomicJson(join(this.state, 'artifact-manifests', plan.artifact.id + '.json'), plan.artifact);
        // Query through DSH too; inspection is evidence, never authorization.
        const inspected = await this.host.request('inspect', { target: join(this.state, 'artifacts', plan.artifact.id) });
        plan.inspection = { status: inspected.status, problem: inspected.problem || null };
        plan.enabled = request.enabled === true;
        plan.approvedBuilds = request.approvedBuilds || [];
        if (!Array.isArray(plan.approvedBuilds) || plan.approvedBuilds.some(name => typeof name !== 'string')) throw fail('BUILD_APPROVAL_INVALID');
        if (request.action === 'update') plan.target = plan.artifact.name;
      } else if (['setPlugin', 'setBundle', 'remove'].includes(request.action)) {
        const inventory = await this.readInventory();
        const row = request.action === 'setPlugin' ? inventory.plugins.find(row => row.entryId === request.target) : inventory.bundles.find(row => row.name === request.target);
        if (!row) throw fail('TARGET_NOT_FOUND');
        if (row.readOnlyReason || request.action === 'remove' && !row.removable) throw fail('MANAGEMENT_PROTECTED');
        if (row.moduleName === '@deepseek-ai/dsh-system-prompt') throw fail('MANAGEMENT_PROTECTED');
        plan.target = request.target;
        if (request.action !== 'remove') { if (typeof request.enabled !== 'boolean') throw fail('ENABLED_REQUIRED'); plan.enabled = request.enabled; }
      } else if (request.action === 'rollback') {
        if (!UUID.test(request.snapshotId)) throw fail('INVALID_SNAPSHOT');
        const snapshot = await readJson(join(this.state, 'snapshots', request.snapshotId, 'meta.json'));
        plan.snapshotId = request.snapshotId;
        plan.snapshotTreeHash = snapshot.treeHash;
      }
      // The approval also names what recovery is allowed to do on failure.
      plan.recovery = 'restore-before-operation-and-restart';
      await atomicJson(join(this.state, 'plans', plan.id + '.json'), plan);
      await this.audit.append('plan.created', { planId: plan.id, planHash: digest(plan), action: plan.action, artifactHash: plan.artifact?.hash || null });
      return plan;
    });
  }
  execute(planId, grant, operationId = randomUUID()) {
    if (!UUID.test(planId) || !UUID.test(operationId)) return Promise.reject(fail('INVALID_ID'));
    if (this.inFlight.has(operationId)) {
      const active = this.inFlight.get(operationId);
      return active.planId === planId ? active.task : Promise.reject(fail('OPERATION_ID_CONFLICT'));
    }
    const task = this.serialize(() => this.executeOnce(planId, grant, operationId));
    this.inFlight.set(operationId, { planId, task });
    return task.finally(() => this.inFlight.delete(operationId));
  }
  async executeOnce(planId, grant, operationId) {
    const plan = await readJson(join(this.state, 'plans', planId + '.json'));
    const previous = this.audit.operation(operationId);
    if (previous) { if (previous.planId !== planId) throw fail('OPERATION_ID_CONFLICT'); return previous; }
    let approval;
    try {
      approval = validateApproval(plan, grant, this.publicKey, this.audit);
      if (plan.expiresAt <= Date.now()) throw fail('PLAN_EXPIRED');
      if (plan.runtimeVersion !== this.runtimeVersion || plan.profileId !== this.profileId || plan.stateHash !== await this.stateHash()) throw fail('STALE_PLAN');
      await this.verifyInstalledArtifacts();
      await this.verifyCheckpoint();
      if (plan.artifact) await verifyArtifact(this.state, plan.artifact);
      if (plan.snapshotId && (await readJson(join(this.state, 'snapshots', plan.snapshotId, 'meta.json'))).treeHash !== plan.snapshotTreeHash) throw fail('SNAPSHOT_CHANGED');
    } catch (error) {
      await this.audit.append('approval.denied', { operationId, planId, code: error.code || 'INVALID_APPROVAL' });
      throw error;
    }
    await this.audit.append('approval.consumed', { operationId, planId, planHash: digest(plan), nonce: approval.nonce, approverId: digest(approval.actor) });
    let snapshotId;
    try { snapshotId = await snapshotProfile(this.dir, this.state, operationId); }
    catch (error) {
      const result = { operationId, planId, application: 'failed', changed: false, errorCode: error.code || 'SNAPSHOT_FAILED' };
      await this.audit.append('operation.finished', { operationId, planId, result });
      return result;
    }
    const txPath = join(this.state, 'transactions', operationId + '.json');
    await atomicJson(txPath, { operationId, planId, snapshotId, phase: 'pending' });
    await this.audit.append('operation.started', { operationId, planId, action: plan.action, snapshotId });
    const controller = new AbortController(); this.controllers.set(operationId, controller);
    let result;
    try {
      let raw;
      if (plan.action === 'restart') { await this.host.stop(); await this.startHost(); raw = { changed: false, application: 'applied', stage: 'restart' }; }
      else if (plan.action === 'rollback') {
        await this.host.stop(); await restoreProfile(this.dir, this.state, plan.snapshotId); await this.startHost();
        raw = { changed: true, application: 'applied', stage: 'rollback' };
      } else if (plan.action === 'update') {
        raw = await this.host.request('remove', { target: plan.target }, { signal: controller.signal });
        if (raw.application === 'applied') raw = await this.host.request('install', { target: await verifyArtifact(this.state, plan.artifact), enabled: plan.enabled, approvedBuilds: plan.approvedBuilds, requestId: operationId }, { signal: controller.signal });
      } else {
        raw = await this.host.request(plan.action, { target: plan.artifact ? await verifyArtifact(this.state, plan.artifact) : plan.target, enabled: plan.enabled, approvedBuilds: plan.approvedBuilds, requestId: operationId }, { signal: controller.signal });
      }
      result = { operationId, planId, snapshotId, ...safeChange(raw) };
      if (raw.application !== 'applied') {
        // Keep only a new, denied-by-default pending build decision. Previously
        // granted script policy is always restored to the before snapshot.
        const pendingPolicy = raw.packageResult?.kind === 'build-blocked' && !plan.approvedBuilds?.length ? await readFile(join(this.dir, 'pnpm-workspace.yaml'), 'utf8') : null;
        await this.host.stop(); await restoreProfile(this.dir, this.state, snapshotId);
        if (pendingPolicy) {
          await atomicJson(join(this.state, 'pending-build-policy.json'), { text: pendingPolicy });
          const { writeFile } = await import('node:fs/promises');
          await writeFile(join(this.dir, 'pnpm-workspace.yaml'), pendingPolicy, { mode: 0o600 });
        }
        await this.startHost();
        result.recovery = { status: 'restored', stateHash: await this.stateHash() };
        if (pendingPolicy) result.recovery.pendingBuildDecisionRetained = true;
      } else {
        await this.verifyInstalledArtifacts();
        result.inventory = await this.readInventory();
      }
    } catch (error) {
      result = { operationId, planId, snapshotId, changed: null, application: 'failed', errorCode: error.code || 'BRIDGE_OPERATION_FAILED' };
      try { await this.host.stop(); await restoreProfile(this.dir, this.state, snapshotId); await this.startHost(); result.recovery = { status: 'restored', stateHash: await this.stateHash() }; }
      catch (recoveryError) { result.recovery = { status: 'failed', errorCode: recoveryError.code || 'RECOVERY_FAILED' }; }
    } finally { this.controllers.delete(operationId); }
    const { inventory: _inventory, ...durableResult } = result;
    await this.audit.append('operation.finished', { operationId, planId, result: durableResult });
    await this.saveCheckpoint();
    await atomicJson(txPath, { operationId, planId, snapshotId, phase: 'finished' });
    return result;
  }
  async cancel(operationId) {
    const controller = this.controllers.get(operationId);
    if (!controller) return { status: 'not-running' };
    controller.abort();
    const response = await this.host.request('cancelInstall', { requestId: operationId }).catch(() => ({ status: 'host-unavailable' }));
    await this.audit.append('operation.cancel-requested', { operationId, status: response.status });
    return response;
  }
  async call(name, args, { signal, timeoutMs = 30000 } = {}) {
    // Calls and management serialize so unload/update cannot race invocation.
    return this.serialize(async () => {
      if (typeof name !== 'string' || !name || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw fail('INVALID_CALL');
      const callId = randomUUID();
      await this.verifyInstalledArtifacts();
      await this.verifyCheckpoint();
      await this.audit.append('capability.started', { callId, nameHash: digest(name) });
      try {
        const value = await this.host.request('call', { name, arguments: args, requestId: callId }, { signal, timeoutMs });
        await this.audit.append('capability.finished', { callId, errorCode: value.error?.info?.code || (value.isError ? 'TOOL_FAILED' : null) });
        return value;
      } catch (error) { await this.audit.append('capability.finished', { callId, errorCode: error.code || 'CALL_FAILED' }); throw error; }
    });
  }
  async snapshots() {
    let names; try { names = await readdir(join(this.state, 'snapshots')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return Promise.all(names.filter(name => UUID.test(name)).map(name => readJson(join(this.state, 'snapshots', name, 'meta.json'))));
  }
  async recoverInterrupted() {
    for (const name of await readdir(join(this.state, 'transactions'))) {
      if (!name.endsWith('.json')) continue;
      const tx = await readJson(join(this.state, 'transactions', name));
      if (tx.phase === 'finished') continue;
      if (this.audit.operation(tx.operationId)) { await this.saveCheckpoint(); await atomicJson(join(this.state, 'transactions', name), { ...tx, phase: 'finished' }); continue; }
      await this.audit.append('recovery.started', { operationId: tx.operationId, snapshotId: tx.snapshotId });
      await restoreProfile(this.dir, this.state, tx.snapshotId);
      await this.saveCheckpoint();
      await this.audit.append('operation.finished', { operationId: tx.operationId, planId: tx.planId, result: { operationId: tx.operationId, planId: tx.planId, snapshotId: tx.snapshotId, application: 'failed', errorCode: 'BRIDGE_INTERRUPTED', recovery: { status: 'restored', stateHash: await this.stateHash() } } });
      await atomicJson(join(this.state, 'transactions', name), { ...tx, phase: 'finished' });
    }
  }
  async close() {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort();
    await this.tail;
    await this.host?.stop();
    if (this.audit) await this.audit.tail;
    if (this.lock) { await this.lock.close(); await unlink(this.lockPath).catch(() => {}); this.lock = undefined; }
  }
}
