/**
 * Public contracts of the Herein core.
 *
 * This package must stay independent from the desktop/mobile UI, the private
 * character packs and the platform adapters. Those layers may depend on core,
 * never the other way around.
 */

export const CORE_VERSION = '0.1.0';

export type Audience = 'private' | 'group' | 'public';

export type Provenance = 'owner' | 'agent' | 'untrusted' | 'system';

export type ObservationKind =
  | 'message'
  | 'post'
  | 'video_watch'
  | 'comment'
  | 'like'
  | 'system';

export type ConversationKind = 'dm' | 'group' | 'public';

export interface ObservationActor {
  id: string;
  name?: string;
  isSelf: boolean;
  isBot?: boolean;
}

export interface MediaRef {
  kind: 'image' | 'video' | 'audio' | 'file';
  url?: string;
  path?: string;
  mimeType?: string;
  durationMs?: number;
  transcript?: string;
}

export interface Observation {
  id: string;
  platform: 'qq' | 'bilibili' | 'wechat' | 'douyin' | 'netease' | 'local';
  accountId: string;
  conversationId: string;
  conversationKind: ConversationKind;
  actor: ObservationActor;
  kind: ObservationKind;
  content?: string;
  media?: MediaRef[];
  occurredAt: string;
  receivedAt: string;
  provenance: Provenance;
  audience: Audience;
  trust: number;
  retention?: 'ephemeral' | 'normal' | 'long';
  raw?: unknown;
}

export type MemoryKind = 'state' | 'event' | 'preference' | 'relationship' | 'profile';

export type MemoryScope = 'global' | 'character' | 'timeline';

export interface MemoryItem {
  id: string;
  characterId?: string | null;
  timelineId?: string | null;
  scope: MemoryScope;
  kind: MemoryKind;
  audience: Audience;
  content: string;
  currentValue?: string | null;
  previousValue?: string | null;
  historicalNote?: string | null;
  importance: number;
  provenance: Provenance;
  sourceObservationIds?: string[];
  supersedesId?: string | null;
  status?: 'active' | 'disabled';
  pinned?: boolean;
  includeInContext?: boolean;
  lastRecalledAt?: string | null;
  recallCount?: number;
}

export interface Experience {
  id: string;
  kind: 'watched_video' | 'listened_music' | 'read_group' | 'saw_post';
  sourceObservationIds: string[];
  title: string;
  summary: string;
  reaction: string;
  relatedMemoryIds?: string[];
  importance: number;
  happenedAt: string;
  sharedAt?: string | null;
}

export type PresentationEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'shy'
  | 'excited'
  | 'worried'
  | 'playful'
  | 'serious';

export interface AvatarManifest {
  id: string;
  type: 'live2d' | 'vrm' | 'video' | 'static';
  entry: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  motions?: Record<string, { group: string; index?: number }>;
  expressions?: Partial<Record<PresentationEmotion, string>>;
  lipsync?: 'rms' | 'viseme' | 'none';
}

export interface ContentProfile {
  type: 'song' | 'video';
  itemId: string;
  title: string;
  creator?: string;
  coverUrl?: string;
  durationMs?: number;
  genre?: string;
  energy?: number;
  valence?: number;
  tempo?: number;
  themes?: string[];
  mood?: string;
  hook?: string;
  source?: string;
}

export interface RecommendationDecision {
  shouldRecommend: boolean;
  type?: 'song' | 'video';
  itemId?: string;
  reason?: string;
  moodTag?: string;
  confidence?: number;
}

export interface TimelineMessage {
  id: string;
  timelineId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  reasoning?: string | null;
  status?: string | null;
  sourceConversationId?: string | null;
}

export interface TimelineSyncResult {
  inserted: number;
  updated: number;
  deleted: number;
}

export * from './avatar.js';
export * from './character.js';
export * from './content.js';
export * from './recommendation.js';
export * from './prompts.js';
