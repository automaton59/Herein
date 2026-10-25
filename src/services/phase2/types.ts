import type { APIProfile, ThemeMode, VoiceConfig } from '../interfaces';

export type MemoryKind = 'state' | 'event' | 'preference' | 'relationship' | 'profile';
export type MemoryScope = 'global' | 'character' | 'timeline';
export type MemoryOrigin = 'manual' | 'auto' | 'summary' | 'imported';
export type MemoryStatus = 'active' | 'disabled';
export type PresentationEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'shy' | 'excited' | 'worried' | 'playful' | 'serious';
export type CallViewMode = 'windowed' | 'mini' | 'fullscreen' | 'pip';
export type CallHost = 'in-app' | 'electron-window';
export type PresentationRenderer = 'auto' | 'static' | 'video' | 'live2d';

export interface ExpressionAssetMetadata {
  expressionKey?: string;
  emotion?: PresentationEmotion;
  priority?: number;
}

export interface DynamicAssetMetadata {
  renderer?: 'video' | 'live2d';
  entry?: string;
  loop?: boolean;
  muted?: boolean;
  defaultExpression?: PresentationEmotion;
  emotionMap?: Partial<Record<PresentationEmotion, { expression?: string; motion?: string }>>;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface CharacterPresentationProfile {
  characterId: string;
  defaultAssetId?: string | null;
  dynamicAssetId?: string | null;
  emotionAssetMap: Partial<Record<PresentationEmotion, string>>;
  fallbackEmotion: PresentationEmotion;
  preferredRenderer?: PresentationRenderer;
}

export interface CallSessionState {
  characterId: string;
  timelineId: string;
  host: CallHost;
  mode: CallViewMode;
  isOpen: boolean;
  startedAt: string;
  elapsedMs?: number;
  lastSubtitleMessageId?: string | null;
}

export interface Phase2AppSettings {
  activeCharacterId?: string | null;
  activeProfileId?: string | null;
  themeMode: ThemeMode;
  voiceConfig?: VoiceConfig;
  memoryEnabled: boolean;
  memoryProfileMode: 'follow-chat' | 'custom';
  memoryProfileId?: string | null;
  summaryTriggerMessageCount: number;
  /** False after the user presses 「断开」 in the API settings. */
  connectionAuto?: boolean;
}

export interface CharacterProfile {
  id: string;
  name: string;
  nickname?: string | null;
  description: string;
  scenario: string;
  firstMessage: string;
  systemPrompt: string;
  personalityCore: string;
  speakingStyle: string;
  valuesText: string;
  boundaries: string;
  avatarAssetId?: string | null;
  assetDir?: string | null;
}

export interface AssetRecord {
  id: string;
  characterId?: string | null;
  kind: 'avatar' | 'expression' | 'live2d' | 'video' | 'other';
  relativePath: string;
  mimeType?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface ImportedAsset {
  assetId: string;
  relativePath: string;
}

export interface RelationshipProfile {
  characterId: string;
  tone: string;
  closeness: number;
  sharedHabits: string;
  privateLanguage: string;
  importantExperiences: string;
  unresolvedContext: string;
}

export interface Timeline {
  id: string;
  characterId: string;
  title: string;
  kind: 'primary' | 'archive';
  isPrimary: boolean;
  sourceConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface TimelineMessage {
  id: string;
  timelineId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  sticker?: { id: string; name: string; url: string; pack?: string; emotion?: string } | null;
  material?: {
    id: string;
    kind: 'video' | 'song';
    source: 'bilibili' | 'netease';
    title: string;
    creator: string | null;
    url: string | null;
    coverUrl: string | null;
  } | null;
  reasoning?: string | null;
  status?: string | null;
  sourceConversationId?: string | null;
}

export interface TimelineSyncResult {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface ConversationSummary {
  id: string;
  timelineId: string;
  content: string;
  messageCount: number;
  tokenEstimate?: number;
  sourceMessageIds: string[];
  status?: string;
}

export interface MemoryItem {
  id: string;
  characterId?: string | null;
  timelineId?: string | null;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  currentValue?: string | null;
  previousValue?: string | null;
  historicalNote?: string | null;
  sourceMessageIds?: string[];
  sourceTime?: string | null;
  confidence?: number | null;
  origin?: MemoryOrigin;
  status?: MemoryStatus;
  pinned?: boolean;
  includeInContext?: boolean;
  audience?: 'private' | 'group' | 'public';
  importance?: number;
  provenance?: 'owner' | 'agent' | 'untrusted' | 'system';
  supersedesId?: string | null;
  sourceObservationIds?: string[];
  lastRecalledAt?: string | null;
  recallCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContextAssemblySection {
  title: string;
  items: string[];
}

export interface ContextAssembly {
  systemPrompt: string;
  explainableSections: ContextAssemblySection[];
  recentMessages: TimelineMessage[];
}

export interface PersonaBootstrapInfo {
  id: string;
  name: string;
  nickname?: string | null;
  relationshipFrame: string;
  avatar?: {
    type: string;
    entry: string;
    lipsync?: string;
    expressions?: Record<string, string | null>;
  } | null;
}

export interface Phase2Bootstrap {
  settings: Partial<Phase2AppSettings>;
  persona?: PersonaBootstrapInfo | null;
  profiles: APIProfile[];
  characters: CharacterProfile[];
}

export interface Phase2PreloadAPI {
  bootstrap: () => Promise<Phase2Bootstrap>;
  settings: {
    get: <T>(key: string, fallback?: T) => Promise<T>;
    set: (key: string, value: unknown) => Promise<boolean>;
  };
  profiles: {
    list: () => Promise<APIProfile[]>;
    upsert: (profile: APIProfile) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
  };
  characters: {
    list: () => Promise<CharacterProfile[]>;
    upsert: (character: CharacterProfile) => Promise<boolean>;
  };
  relationship: {
    get: (characterId: string) => Promise<RelationshipProfile | null>;
    upsert: (relationship: RelationshipProfile) => Promise<boolean>;
  };
  timeline: {
    getPrimary: (characterId: string) => Promise<Timeline | null>;
    listMessages: (timelineId: string, limit?: number) => Promise<TimelineMessage[]>;
    appendMessage: (message: TimelineMessage) => Promise<boolean>;
    syncMessages: (timelineId: string, messages: TimelineMessage[], title?: string) => Promise<TimelineSyncResult>;
    updateMessage: (messageId: string, patch: Partial<TimelineMessage>) => Promise<boolean>;
    updateTitle: (timelineId: string, title: string) => Promise<boolean>;
    deleteAfter: (timelineId: string, messageId: string) => Promise<boolean>;
    clearMessages: (timelineId: string) => Promise<boolean>;
  };
  memory: {
    list: (filter?: { characterId?: string; timelineId?: string; activeOnly?: boolean }) => Promise<MemoryItem[]>;
    create: (memory: MemoryItem) => Promise<boolean>;
    update: (id: string, patch: Partial<MemoryItem>) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
  };
  summary: {
    get: (timelineId: string) => Promise<ConversationSummary | null>;
    upsert: (summary: ConversationSummary) => Promise<boolean>;
  };
  assets: {
    importAvatar: (characterId: string, file: unknown) => Promise<ImportedAsset>;
    importExpression: (
      characterId: string,
      file: unknown,
      metadata: ExpressionAssetMetadata & { label?: string },
    ) => Promise<ImportedAsset>;
    importVideo: (
      characterId: string,
      file: unknown,
      metadata: DynamicAssetMetadata & { label?: string },
    ) => Promise<ImportedAsset>;
    importLive2D: (
      characterId: string,
      file: unknown,
      metadata: DynamicAssetMetadata & { label?: string },
    ) => Promise<ImportedAsset>;
    list: (filter?: { characterId?: string; kind?: AssetRecord['kind'] }) => Promise<AssetRecord[]>;
    update: (id: string, patch: Partial<AssetRecord>) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
    getDataUrl: (assetId: string) => Promise<string | null>;
  };
  presentation: {
    getProfile: (characterId: string) => Promise<CharacterPresentationProfile>;
    upsertProfile: (profile: CharacterPresentationProfile) => Promise<boolean>;
  };
  backup: {
    export: (targetPath?: string, includeSecrets?: boolean) => Promise<string>;
    restore: (backupPath: string) => Promise<boolean>;
  };
  characterArchive: {
    export: (characterId: string, mode: 'profile' | 'full', targetPath?: string) => Promise<string>;
    import: (archivePath: string) => Promise<string>;
  };
}
