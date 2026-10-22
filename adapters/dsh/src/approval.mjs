import { generateKeyPairSync, sign, verify, randomUUID } from 'node:crypto';
import { canonical, digest, fail } from './common.mjs';

export function createAuthority() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: publicKey.export({ type: 'spki', format: 'pem' }) };
}
export function approvePlan(plan, privateKey, actor, lifetimeMs = 300000) {
  if (!actor || typeof actor !== 'string' || actor.length > 120) throw fail('APPROVER_REQUIRED');
  const payload = { protocol: 1, planHash: digest(plan), profileId: plan.profileId, issuedAt: Date.now(), expiresAt: Date.now() + lifetimeMs, nonce: randomUUID(), actor };
  return { payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
}
export function validateApproval(plan, grant, publicKey, audit, now = Date.now()) {
  try {
    if (!grant || !verify(null, Buffer.from(canonical(grant.payload)), publicKey, Buffer.from(grant.signature, 'base64'))) throw fail('APPROVAL_INVALID');
  } catch { throw fail('APPROVAL_INVALID'); }
  const p = grant.payload;
  if (p.protocol !== 1 || p.planHash !== digest(plan) || p.profileId !== plan.profileId) throw fail('APPROVAL_MISMATCH');
  if (!p.actor || !p.nonce || p.issuedAt > now + 30000 || p.expiresAt <= now || p.expiresAt - p.issuedAt > 3600000) throw fail('APPROVAL_EXPIRED');
  if (audit.usedNonce(p.nonce)) throw fail('APPROVAL_REPLAY');
  return p;
}
