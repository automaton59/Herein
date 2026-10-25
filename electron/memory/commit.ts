import type { createPhase2Repositories } from '../data/repositories';
import type { MemoryItem, MemoryStore, NewMemoryItem } from '../data/memoryStore';
import type { PreparedOp } from './types';

type Repositories = ReturnType<typeof createPhase2Repositories>;

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function itemFromOp(op: PreparedOp, characterId: string, timelineId: string): NewMemoryItem {
  const item = op.item!;

  return {
    characterId: item.subject === 'user' || item.subject === 'world' ? null : characterId,
    timelineId,
    subject: item.subject,
    kind: item.kind,
    predicate: item.predicate,
    content: item.content,
    attributes: item.attributes,
    validFrom: item.validFrom,
    validTo: item.validTo,
    audience: item.audience,
    sensitivity: item.sensitivity,
    importance: item.importance,
    confidence: item.confidence,
    provenance: item.provenance,
    manual: false,
    pinned: false,
    includeInContext: true,
    sourceMessageIds: unique(item.evidence),
    origin: 'agent',
  };
}

export interface CommitInput {
  store: MemoryStore;
  repos: Repositories;
  characterId: string;
  timelineId: string;
  runId: string;
  accepted: PreparedOp[];
  narrative: { content: string; openLoops: string[] } | null;
  watermarkMessageId: string | null;
  messageCount: number;
  sourceMessageIds: string[];
}

export interface CommitResult {
  applied: number;
  itemIds: string[];
  narrativeId: string | null;
}

export function commitMemoryUpdate(input: CommitInput): CommitResult {
  const { store, repos } = input;
  const itemIds: string[] = [];
  let applied = 0;
  let narrativeId: string | null = null;

  store.transaction(() => {
    for (const op of input.accepted) {
      const occurredAt = new Date().toISOString();

      if (op.op === 'assert' && op.item) {
        const created = store.items.create(itemFromOp(op, input.characterId, input.timelineId));
        itemIds.push(created.id);
        applied += 1;
        store.events.append({
          characterId: input.characterId,
          timelineId: input.timelineId,
          itemId: created.id,
          runId: input.runId,
          type: 'asserted',
          actor: 'agent',
          subject: created.subject,
          payload: { item: created },
        });
        continue;
      }

      if (op.op === 'supersede' && op.targetId && op.item) {
        const target = store.items.get(op.targetId);

        if (!target) {
          continue;
        }

        const newItem = itemFromOp(op, input.characterId, input.timelineId);
        newItem.validFrom = op.item.validFrom ?? occurredAt;
        newItem.supersedesId = target.id;
        const created = store.items.create(newItem);
        store.items.update(target.id, {
          status: 'superseded',
          validTo: newItem.validFrom,
        });
        itemIds.push(created.id);
        applied += 1;
        store.events.append({
          characterId: input.characterId,
          timelineId: input.timelineId,
          itemId: created.id,
          runId: input.runId,
          type: 'superseded',
          actor: 'agent',
          subject: created.subject,
          payload: { targetId: target.id, item: created },
        });
        continue;
      }

      if (op.op === 'revise' && op.targetId && op.patch) {
        const updated = store.items.update(op.targetId, op.patch);

        if (!updated) {
          continue;
        }

        itemIds.push(updated.id);
        applied += 1;
        store.events.append({
          characterId: input.characterId,
          timelineId: input.timelineId,
          itemId: updated.id,
          runId: input.runId,
          type: 'revised',
          actor: 'agent',
          subject: updated.subject,
          payload: { patch: op.patch, item: updated },
        });
        continue;
      }

      if (op.op === 'merge' && op.targetIds && op.item) {
        const targets = op.targetIds
          .map(id => store.items.get(id))
          .filter((item): item is MemoryItem => Boolean(item));

        if (targets.length < 2) {
          continue;
        }

        const primary = targets[0];
        const others = targets.slice(1);
        const sourceMessageIds = unique([
          ...primary.sourceMessageIds,
          ...op.item.evidence,
          ...others.flatMap(item => item.sourceMessageIds),
        ]);
        const updated = store.items.update(primary.id, {
          content: op.item.content,
          predicate: op.item.predicate ?? primary.predicate,
          attributes: op.item.attributes,
          importance: Math.max(primary.importance, op.item.importance),
          confidence: Math.max(primary.confidence ?? 0, op.item.confidence),
          sourceMessageIds,
        });

        for (const other of others) {
          store.items.update(other.id, {
            status: 'superseded',
            supersedesId: primary.id,
            validTo: occurredAt,
          });
        }

        if (updated) {
          itemIds.push(updated.id);
          applied += 1;
          store.events.append({
            characterId: input.characterId,
            timelineId: input.timelineId,
            itemId: updated.id,
            runId: input.runId,
            type: 'merged',
            actor: 'agent',
            subject: updated.subject,
            payload: { mergedIds: others.map(item => item.id), item: updated },
          });
        }
        continue;
      }

      if (op.op === 'retire' && op.targetId) {
        const updated = store.items.update(op.targetId, {
          status: 'archived',
          validTo: occurredAt,
        });

        if (updated) {
          itemIds.push(updated.id);
          applied += 1;
          store.events.append({
            characterId: input.characterId,
            timelineId: input.timelineId,
            itemId: updated.id,
            runId: input.runId,
            type: 'retired',
            actor: 'agent',
            subject: updated.subject,
            payload: { reason: op.reason ?? null, item: updated },
          });
        }
      }
    }

    if (input.narrative) {
      const narrative = store.narratives.append({
        characterId: input.characterId,
        timelineId: input.timelineId,
        content: input.narrative.content,
        openLoops: input.narrative.openLoops,
        watermarkMessageId: input.watermarkMessageId,
        messageCount: input.messageCount,
        sourceMessageIds: input.sourceMessageIds,
      });
      narrativeId = narrative.id;

      // Keep the legacy summary table in sync for existing UI surfaces.
      repos.summaries.upsert({
        id: `summary_${input.timelineId}`,
        timelineId: input.timelineId,
        content: narrative.content,
        messageCount: narrative.messageCount,
        sourceMessageIds: narrative.sourceMessageIds,
        status: 'active',
      });

      store.events.append({
        characterId: input.characterId,
        timelineId: input.timelineId,
        itemId: null,
        runId: input.runId,
        type: 'narrated',
        actor: 'agent',
        subject: null,
        payload: { narrativeId: narrative.id, version: narrative.version },
      });
    }
  });

  return { applied, itemIds, narrativeId };
}
