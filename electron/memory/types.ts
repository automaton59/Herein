import type { Audience, MemoryItem, MemoryKind, Sensitivity } from '../data/memoryStore';

export type MemoryOpName = 'assert' | 'revise' | 'supersede' | 'merge' | 'retire';

export interface RawMemoryOp {
  op?: unknown;
  targetId?: unknown;
  targetIds?: unknown;
  subject?: unknown;
  kind?: unknown;
  predicate?: unknown;
  content?: unknown;
  attributes?: unknown;
  validFrom?: unknown;
  validTo?: unknown;
  audience?: unknown;
  sensitivity?: unknown;
  importance?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  reason?: unknown;
}

export interface RawMemoryOutput {
  summary?: unknown;
  openLoops?: unknown;
  ops?: unknown;
}

export interface PreparedOp {
  op: MemoryOpName;
  targetId?: string;
  targetIds?: string[];
  item?: {
    subject: string;
    kind: MemoryKind;
    predicate: string | null;
    content: string;
    attributes: Record<string, unknown>;
    validFrom: string | null;
    validTo: string | null;
    audience: Audience;
    sensitivity: Sensitivity;
    importance: number;
    confidence: number;
    evidence: string[];
    provenance: 'agent' | 'untrusted';
  };
  patch?: Partial<MemoryItem>;
  reason?: string;
}

export interface RejectedOp {
  index: number;
  op: string;
  reason: string;
}

export interface ReconcileContext {
  characterId: string;
  timelineId: string;
  knownItems: MemoryItem[];
  messageRoles: Map<string, 'user' | 'assistant' | 'system'>;
  now: string;
}

export interface ReconcileResult {
  accepted: PreparedOp[];
  rejected: RejectedOp[];
  narrative: {
    content: string;
    openLoops: string[];
  } | null;
}

export interface DigestInput {
  characterId: string;
  timelineId: string;
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }>;
  limit?: number;
}

export interface RecallBrief {
  characterId: string;
  timelineId: string | null;
  audience?: Audience;
  purpose?: 'chat' | 'initiative' | 'voice' | 'group_reply' | 'share';
  situation?: string;
  budget?: number;
  now?: string;
  messageId?: string | null;
  packVersion?: string | null;
  policyVersion?: string | null;
}

export interface MemorySection {
  id: string;
  title: string;
  items: string[];
  itemIds: string[];
  budget: number;
  used: number;
}

export interface RecallResult {
  text: string;
  sections: MemorySection[];
  itemIds: string[];
  scores: Record<string, number>;
  omitted: Array<{ id: string; reason: string }>;
  latencyMs: number;
  narrative: string | null;
}
