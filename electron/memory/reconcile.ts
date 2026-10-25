import type { MemoryItem, MemoryKind } from '../data/memoryStore';
import type {
  PreparedOp,
  RawMemoryOp,
  RawMemoryOutput,
  ReconcileContext,
  ReconcileResult,
  RejectedOp,
} from './types';

const OPS = new Set(['assert', 'revise', 'supersede', 'merge', 'retire']);
const KINDS = new Set<MemoryKind>(['state', 'trait', 'preference', 'boundary', 'event', 'commitment']);
const AUDIENCES = new Set(['private', 'group', 'public']);
const SENSITIVITIES = new Set(['normal', 'sensitive', 'secret']);
const MAX_OPS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

export function normalizeContent(content: string) {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function inferSubject(kind: MemoryKind) {
  return kind === 'event' || kind === 'commitment' ? 'relationship' : 'user';
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function validSubject(value: string) {
  return value === 'user' || value === 'self' || value === 'relationship' || value === 'world' || value.startsWith('person:');
}

function validKind(value: string): value is MemoryKind {
  return KINDS.has(value as MemoryKind);
}

function reject(index: number, op: RawMemoryOp, reason: string): RejectedOp {
  return { index, op: text(op.op) || 'unknown', reason };
}

function itemFromRaw(raw: RawMemoryOp, base?: MemoryItem): PreparedOp['item'] | null {
  const kindText = text(raw.kind) || base?.kind || '';
  const kind = validKind(kindText) ? kindText : null;

  if (!kind) {
    return null;
  }

  const content = text(raw.content) || base?.content || '';

  if (!content) {
    return null;
  }

  const subjectText = text(raw.subject) || base?.subject || inferSubject(kind);
  const subject = validSubject(subjectText) ? subjectText : inferSubject(kind);
  const predicateText = text(raw.predicate);
  const predicate = predicateText || base?.predicate || null;
  const audienceText = text(raw.audience);
  const audience = AUDIENCES.has(audienceText) ? audienceText as 'private' | 'group' | 'public' : base?.audience ?? 'private';
  const sensitivityText = text(raw.sensitivity);
  const sensitivity = SENSITIVITIES.has(sensitivityText)
    ? sensitivityText as 'normal' | 'sensitive' | 'secret'
    : base?.sensitivity ?? 'normal';

  return {
    subject,
    kind,
    predicate,
    content,
    attributes: isRecord(raw.attributes) ? raw.attributes : base?.attributes ?? {},
    validFrom: text(raw.validFrom) || null,
    validTo: text(raw.validTo) || null,
    audience,
    sensitivity,
    importance: Math.round(clamp(raw.importance, 1, 10, base?.importance ?? 5)),
    confidence: clamp(raw.confidence, 0, 0.95, base?.confidence ?? 0.6),
    evidence: stringArray(raw.evidence),
    provenance: 'agent',
  };
}

function evidenceAllowed(
  evidence: string[],
  subject: string,
  kind: MemoryKind,
  context: ReconcileContext,
): string | null {
  if (evidence.length === 0) {
    return 'evidence is required';
  }

  for (const id of evidence) {
    if (!context.messageRoles.has(id)) {
      return `unknown evidence id: ${id}`;
    }
  }

  if (kind !== 'commitment' && (subject === 'user' || subject === 'relationship' || subject.startsWith('person:'))) {
    const hasUser = evidence.some(id => context.messageRoles.get(id) === 'user');

    if (!hasUser) {
      return 'evidence for user/relationship facts must come from the user side';
    }
  }

  return null;
}

function findDuplicate(item: PreparedOp['item'], known: MemoryItem[]) {
  if (!item) {
    return null;
  }

  const normalized = normalizeContent(item.content);

  return known.find(existing => (
    existing.status === 'active'
    && existing.subject === item.subject
    && existing.kind === item.kind
    && normalizeContent(existing.content) === normalized
  )) ?? null;
}

function findConflict(item: PreparedOp['item'], known: MemoryItem[], now: string) {
  if (!item?.predicate) {
    return null;
  }

  return known.find(existing => (
    existing.status === 'active'
    && existing.subject === item.subject
    && existing.predicate === item.predicate
    && (existing.validTo === null || existing.validTo > now)
    && normalizeContent(existing.content) !== normalizeContent(item.content)
  )) ?? null;
}

export function parseMemoryOutput(raw: string): RawMemoryOutput | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;

  try {
    const parsed = JSON.parse(withoutFence) as unknown;
    return isRecord(parsed) ? parsed as RawMemoryOutput : null;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');

    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
        return isRecord(parsed) ? parsed as RawMemoryOutput : null;
      } catch {
        return null;
      }
    }

    return null;
  }
}

export function reconcileMemoryOutput(
  output: RawMemoryOutput,
  context: ReconcileContext,
): ReconcileResult {
  const knownById = new Map(context.knownItems.map(item => [item.id, item]));
  const rawOps = Array.isArray(output.ops) ? output.ops as RawMemoryOp[] : [];
  const accepted: PreparedOp[] = [];
  const rejected: RejectedOp[] = [];

  for (const [index, raw] of rawOps.entries()) {
    if (accepted.length >= MAX_OPS) {
      rejected.push(reject(index, raw, 'op limit reached'));
      continue;
    }

    const opName = text(raw.op) as PreparedOp['op'];

    if (!OPS.has(opName)) {
      rejected.push(reject(index, raw, 'unknown op'));
      continue;
    }

    if (opName === 'assert' || opName === 'supersede') {
      const item = itemFromRaw(raw);

      if (!item) {
        rejected.push(reject(index, raw, 'invalid item fields'));
        continue;
      }

      const evidenceError = evidenceAllowed(item.evidence, item.subject, item.kind, context);

      if (evidenceError) {
        rejected.push(reject(index, raw, evidenceError));
        continue;
      }

      if (opName === 'assert') {
        const duplicate = findDuplicate(item, context.knownItems);

        if (duplicate) {
          rejected.push(reject(index, raw, `duplicate of ${duplicate.id}`));
          continue;
        }

        const conflict = findConflict(item, context.knownItems, context.now);

        if (conflict) {
          accepted.push({
            op: 'supersede',
            targetId: conflict.id,
            item,
            reason: text(raw.reason) || 'state changed',
          });
          continue;
        }

        accepted.push({ op: 'assert', item, reason: text(raw.reason) || undefined });
        continue;
      }

      const targetId = text(raw.targetId);
      const target = knownById.get(targetId);

      if (!target) {
        rejected.push(reject(index, raw, 'supersede target not found in digest'));
        continue;
      }

      if (target.manual) {
        rejected.push(reject(index, raw, 'manual memory is authoritative'));
        continue;
      }

      accepted.push({
        op: 'supersede',
        targetId,
        item,
        reason: text(raw.reason) || 'superseded',
      });
      continue;
    }

    if (opName === 'revise') {
      const targetId = text(raw.targetId);
      const target = knownById.get(targetId);

      if (!target) {
        rejected.push(reject(index, raw, 'revise target not found in digest'));
        continue;
      }

      if (target.manual) {
        rejected.push(reject(index, raw, 'manual memory is authoritative'));
        continue;
      }

      const patch: Partial<MemoryItem> = {};

      if (typeof raw.content === 'string' && raw.content.trim()) {
        patch.content = raw.content.trim();
      }

      if (typeof raw.predicate === 'string' && raw.predicate.trim()) {
        patch.predicate = raw.predicate.trim();
      }

      if (isRecord(raw.attributes)) {
        patch.attributes = raw.attributes;
      }

      if (typeof raw.validFrom === 'string' && raw.validFrom.trim()) {
        patch.validFrom = raw.validFrom.trim();
      }

      if (typeof raw.validTo === 'string' && raw.validTo.trim()) {
        patch.validTo = raw.validTo.trim();
      }

      if (typeof raw.importance === 'number') {
        patch.importance = Math.round(clamp(raw.importance, 1, 10, target.importance));
      }

      if (typeof raw.confidence === 'number') {
        patch.confidence = clamp(raw.confidence, 0, 0.95, target.confidence ?? 0.6);
      }

      if (Object.keys(patch).length === 0) {
        rejected.push(reject(index, raw, 'revise has no fields'));
        continue;
      }

      accepted.push({ op: 'revise', targetId, patch, reason: text(raw.reason) || undefined });
      continue;
    }

    if (opName === 'merge') {
      const targetIds = stringArray(raw.targetIds);
      const targets = targetIds.map(id => knownById.get(id)).filter((item): item is MemoryItem => Boolean(item));

      if (targets.length < 2) {
        rejected.push(reject(index, raw, 'merge needs at least two known targets'));
        continue;
      }

      if (targets.some(item => item.manual)) {
        rejected.push(reject(index, raw, 'manual memory is authoritative'));
        continue;
      }

      const primary = targets[0];
      const item = itemFromRaw(raw, primary);

      if (!item) {
        rejected.push(reject(index, raw, 'invalid merge item'));
        continue;
      }

      accepted.push({ op: 'merge', targetIds: targets.map(item => item.id), item, reason: text(raw.reason) || undefined });
      continue;
    }

    if (opName === 'retire') {
      const targetId = text(raw.targetId);
      const target = knownById.get(targetId);

      if (!target) {
        rejected.push(reject(index, raw, 'retire target not found in digest'));
        continue;
      }

      if (target.manual) {
        rejected.push(reject(index, raw, 'manual memory is authoritative'));
        continue;
      }

      accepted.push({ op: 'retire', targetId, reason: text(raw.reason) || 'retired' });
    }
  }

  const summary = typeof output.summary === 'string' ? output.summary.trim() : '';
  const openLoops = stringArray(output.openLoops).slice(0, 8);

  return {
    accepted,
    rejected,
    narrative: summary ? { content: summary.slice(0, 2400), openLoops } : null,
  };
}
