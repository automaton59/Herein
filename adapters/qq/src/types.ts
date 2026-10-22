export interface QQBotConfig {
  appId: string;
  appSecret: string;
  mode?: 'websocket' | 'webhook';
  devTestUsers?: string[];
}

export interface QQAccessToken {
  accessToken: string;
  expiresAt: number;
}

export interface QQBotClientOptions {
  config: QQBotConfig;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  tokenUrl?: string;
  now?: () => number;
}

export interface QQGatewayResponse {
  url: string;
}

export interface QQSendResult {
  id?: string;
  timestamp?: string;
}

export interface QQVoiceAttachment {
  kind: 'audio';
  url?: string;
  transcript?: string;
  mimeType?: string;
}

export interface QQObservationDraft {
  id: string;
  platform: 'qq';
  conversationId: string;
  conversationKind: 'group' | 'dm';
  actorId?: string;
  actorName?: string;
  isSelf: boolean;
  isBot: boolean;
  kind: 'message';
  content: string;
  media?: QQVoiceAttachment[];
  occurredAt: string;
  receivedAt: string;
  provenance: 'owner' | 'agent' | 'untrusted' | 'system';
  audience: 'private' | 'group';
  trust: number;
  dedupeKey: string;
  raw: unknown;
}

export interface QQGatewayEvent {
  id?: string;
  op?: number;
  s?: number;
  t?: string;
  d?: Record<string, unknown>;
}
