import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthority, approvePlan, validateApproval } from '../src/approval.mjs';
import { AuditJournal } from '../src/audit.mjs';
import { digest, canonical, safeChange, safeInventory, within, assertOwnedPath } from '../src/common.mjs';
import { stageArtifact, verifyArtifact } from '../src/artifact.mjs';

test('signed approval binds exact action, content and profile; rejects forged, expired and replayed grants', async () => {
  const keys = createAuthority(), stranger = createAuthority();
  const plan = { id: randomUUID(), profileId: randomUUID(), action: 'install', artifact: { hash: 'reviewed-content' } };
  const audit = new AuditJournal(join(await mkdtemp(join(tmpdir(), 'herein-approval-')), 'audit.jsonl'));
  const grant = approvePlan(plan, keys.privateKey, 'test human');
  assert.equal(validateApproval(plan, grant, keys.publicKey, audit).actor, 'test human');
  assert.throws(() => validateApproval(plan, undefined, keys.publicKey, audit), { code: 'APPROVAL_INVALID' });
  assert.throws(() => validateApproval(plan, approvePlan(plan, stranger.privateKey, 'attacker'), keys.publicKey, audit), { code: 'APPROVAL_INVALID' });
  assert.throws(() => validateApproval({ ...plan, profileId: randomUUID() }, grant, keys.publicKey, audit), { code: 'APPROVAL_MISMATCH' });
  assert.throws(() => validateApproval({ ...plan, action: 'remove' }, grant, keys.publicKey, audit), { code: 'APPROVAL_MISMATCH' });
  assert.throws(() => validateApproval(plan, grant, keys.publicKey, audit, grant.payload.expiresAt), { code: 'APPROVAL_EXPIRED' });
  await audit.append('approval.consumed', { nonce: grant.payload.nonce });
  assert.throws(() => validateApproval(plan, grant, keys.publicKey, audit), { code: 'APPROVAL_REPLAY' });
  const reopened = new AuditJournal(audit.path); await reopened.load();
  assert.throws(() => validateApproval(plan, grant, keys.publicKey, reopened), { code: 'APPROVAL_REPLAY' });
});

test('audit survives reopen and refuses truncated or altered records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'herein-audit-'));
  const audit = new AuditJournal(join(dir, 'audit.jsonl'));
  await Promise.all([audit.append('first'), audit.append('second')]);
  const reopened = new AuditJournal(audit.path); await reopened.load(); assert.equal(reopened.records.length, 2);
  await writeFile(audit.path, (await readFile(audit.path, 'utf8')).replace('first', 'forged'));
  await assert.rejects(new AuditJournal(audit.path).load(), { code: 'AUDIT_TAMPERED' });
  await writeFile(audit.path, '{"partial":');
  await assert.rejects(new AuditJournal(audit.path).load(), { code: 'AUDIT_TRUNCATED' });
});

test('audit DTOs omit DSH diagnostics, source URLs, config, and raw package output', () => {
  const sentinel = 'FAKE_SECRET_DO_NOT_LOG_91';
  const safe = safeChange({ changed: true, application: 'failed', error: { code: 'operation-error', diagnostic: sentinel }, packageResult: { exitCode: 1, output: sentinel, logPath: sentinel } });
  const inv = safeInventory({ plugins: [{ entryId: 'x', config: { token: sentinel } }], bundles: [{ name: 'x', source: `https://host/?token=${sentinel}`, error: { diagnostic: sentinel }, meta: { icon: sentinel, title: 'X' } }], capabilities: [] });
  assert.ok(!JSON.stringify({ safe, inv }).includes(sentinel));
});

test('staging rejects junctions and detects changes after the package was reviewed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'herein-stage-'));
  const source = join(root, 'source');
  const { mkdir } = await import('node:fs/promises'); await mkdir(source);
  await writeFile(join(source, 'package.json'), '{"name":"@local/check","version":"1.0.0"}');
  await writeFile(join(source, 'index.js'), 'export function apply() {}');
  const artifact = await stageArtifact(source, root);
  await verifyArtifact(root, artifact);
  await appendFile(join(root, 'artifacts', artifact.id, 'index.js'), '\nchanged');
  await assert.rejects(verifyArtifact(root, artifact), { code: 'ARTIFACT_CHANGED' });
  await symlink(join(root, 'artifacts'), join(source, 'escape'), 'junction');
  await assert.rejects(stageArtifact(source, root), { code: 'ARTIFACT_SYMLINK' });
  assert.equal(within(root, join(root, '..', 'outside')), false);
  await assert.rejects(assertOwnedPath(source, join(source, 'escape')), { code: 'PATH_SYMLINK_ESCAPE' });
});
