import type { RecommendationDecision } from './index.js';

export interface RecommendationGateContext {
  now: Date;
  itemId: string;
  lastRecommendedAt?: string | null;
  turnsSinceLast?: number;
  recentItemIds?: string[];
  userMood?: 'neutral' | 'happy' | 'sad' | 'angry' | 'upset' | 'anxious';
  cooldownMinutes?: number;
  minTurnsBetween?: number;
  noRepeatDays?: number;
}

export interface RecommendationGateResult {
  allowed: boolean;
  reason: string;
}

export function canRecommend(context: RecommendationGateContext): RecommendationGateResult {
  if (context.userMood === 'sad' || context.userMood === 'angry' || context.userMood === 'upset') {
    return { allowed: false, reason: 'user is upset; do not push content' };
  }

  const minTurns = context.minTurnsBetween ?? 10;
  if ((context.turnsSinceLast ?? minTurns) < minTurns) {
    return { allowed: false, reason: 'too soon after the last recommendation' };
  }

  const cooldownMinutes = context.cooldownMinutes ?? 45;
  if (context.lastRecommendedAt) {
    const last = new Date(context.lastRecommendedAt).getTime();
    if (Number.isFinite(last) && context.now.getTime() - last < cooldownMinutes * 60_000) {
      return { allowed: false, reason: 'cooldown is still active' };
    }
  }

  const noRepeatDays = context.noRepeatDays ?? 7;
  const recent = new Set(context.recentItemIds ?? []);
  if (recent.has(context.itemId) && noRepeatDays > 0) {
    return { allowed: false, reason: 'item was recommended recently' };
  }

  return { allowed: true, reason: 'ok' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRecommendationDecision(input: unknown): RecommendationDecision {
  if (!isRecord(input) || typeof input.shouldRecommend !== 'boolean') {
    throw new Error('shouldRecommend must be a boolean');
  }

  if (!input.shouldRecommend) {
    return { shouldRecommend: false };
  }

  if (input.type !== 'song' && input.type !== 'video') {
    throw new Error('type must be song or video');
  }

  if (typeof input.itemId !== 'string' || !input.itemId.trim()) {
    throw new Error('itemId must be a non-empty string');
  }

  if (typeof input.reason !== 'string' || !input.reason.trim()) {
    throw new Error('reason must be a non-empty string');
  }

  const reason = input.reason.trim();
  if (reason.length > 80) {
    throw new Error('reason is too long');
  }

  const confidence = typeof input.confidence === 'number' ? input.confidence : 0.5;
  if (confidence < 0 || confidence > 1) {
    throw new Error('confidence must be between 0 and 1');
  }

  return {
    shouldRecommend: true,
    type: input.type,
    itemId: input.itemId.trim(),
    reason,
    moodTag: typeof input.moodTag === 'string' ? input.moodTag.slice(0, 24) : undefined,
    confidence,
  };
}
