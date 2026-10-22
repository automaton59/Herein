import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { createPhase2Repositories } from '../data/repositories';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface QQBotFileConfig {
  appId: string;
  appSecret: string;
  mode?: 'websocket' | 'webhook';
  devTestUsers?: string[];
}

export interface QQGatewayEventLike {
  id?: string;
  op?: number;
  s?: number;
  t?: string;
  d?: Record<string, unknown>;
}

export interface QQObservationDraftLike {
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
  media?: Array<{
    kind: 'audio';
    url?: string;
    transcript?: string;
    mimeType?: string;
  }>;
  occurredAt: string;
  receivedAt: string;
  provenance: 'owner' | 'agent' | 'untrusted' | 'system';
  audience: 'private' | 'group';
  trust: number;
  dedupeKey: string;
  raw: unknown;
}

export interface QQGatewayLike {
  connect(): Promise<void>;
  close(): void;
}

export interface QQClientLike {
  sendGroupMessage(groupOpenId: string, content: string, msgId?: string): Promise<{ id?: string }>;
  sendC2CMessage(openId: string, content: string, msgId?: string): Promise<{ id?: string }>;
}

export interface QQListenerHandlers {
  onEvent: (event: QQGatewayEventLike) => void;
}

export interface QQListenerOptions {
  repos: Repositories;
  config?: QQBotFileConfig;
  configPath?: string;
  fetchImpl?: typeof fetch;
  gatewayFactory?: (handlers: QQListenerHandlers) => QQGatewayLike;
  client?: QQClientLike;
  responder?: (
    event: QQGatewayEventLike,
    draft: QQObservationDraftLike,
  ) => Promise<string | null>;
}

export interface QQListenerHandle {
  stop: () => void;
}

export async function loadQQBotConfig(filePath?: string): Promise<QQBotFileConfig> {
  const resolved = path.resolve(
    filePath ?? process.env.HEREIN_QQ_CONFIG ?? path.join(process.cwd(), 'private', 'credentials', 'qqbot.json'),
  );
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(resolved, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read QQ config at ${resolved}: ${error instanceof Error ? error.message : error}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('QQ config must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;

  for (const key of ['appId', 'appSecret'] as const) {
    if (typeof record[key] !== 'string' || !record[key].trim()) {
      throw new Error(`QQ config field "${key}" must be a non-empty string`);
    }
  }

  return {
    appId: record.appId as string,
    appSecret: record.appSecret as string,
    mode: record.mode === 'webhook' ? 'webhook' : 'websocket',
    devTestUsers: Array.isArray(record.devTestUsers)
      ? record.devTestUsers.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function toObservation(draft: QQObservationDraftLike) {
  return {
    id: draft.id,
    platform: 'qq',
    accountId: null,
    conversationId: draft.conversationId,
    conversationKind: draft.conversationKind,
    actorId: draft.actorId ?? null,
    actorName: draft.actorName ?? null,
    isSelf: draft.isSelf,
    isBot: draft.isBot,
    kind: draft.kind,
    content: draft.content,
    media: draft.media ?? [],
    occurredAt: draft.occurredAt,
    receivedAt: draft.receivedAt,
    provenance: draft.provenance,
    audience: draft.audience,
    trust: draft.trust,
    retention: 'normal' as const,
    raw: draft.raw,
    dedupeKey: draft.dedupeKey,
  };
}

export async function startQQListener(options: QQListenerOptions): Promise<QQListenerHandle> {
  const config = options.config ?? await loadQQBotConfig(options.configPath);
  const adapter = await import('../../adapters/qq/dist/index.js' as string) as {
    QQBotClient: new (options: { config: QQBotFileConfig; fetchImpl?: typeof fetch }) => QQClientLike & {
      getAccessToken(): Promise<string>;
      getGateway(): Promise<{ url: string }>;
    };
    QQGateway: new (options: {
      client: unknown;
      intents: number;
      onEvent: (event: QQGatewayEventLike) => void;
      autoReconnect: boolean;
    }) => QQGatewayLike;
    normalizeQQEvent: (event: QQGatewayEventLike) => QQObservationDraftLike | null;
  };

  const client = options.client ?? new adapter.QQBotClient({
    config,
    fetchImpl: options.fetchImpl,
  });

  const handleEvent = async (event: QQGatewayEventLike) => {
    const draft = adapter.normalizeQQEvent(event);

    if (!draft) {
      return;
    }

    options.repos.observations.insert(toObservation(draft));

    if (!options.responder) {
      return;
    }

    const shouldReply = event.t === 'GROUP_AT_MESSAGE_CREATE' || event.t === 'C2C_MESSAGE_CREATE';
    if (!shouldReply) {
      return;
    }

    try {
      const reply = await options.responder(event, draft);

      if (!reply?.trim()) {
        return;
      }

      if (draft.conversationKind === 'group') {
        await client.sendGroupMessage(draft.conversationId, reply.trim(), draft.id);
      } else {
        await client.sendC2CMessage(draft.conversationId, reply.trim(), draft.id);
      }
    } catch {
      // A failed reply must not kill the listener loop.
    }
  };

  const gateway = options.gatewayFactory
    ? options.gatewayFactory({ onEvent: event => { void handleEvent(event); } })
    : new adapter.QQGateway({
      client,
      intents: 1 << 25,
      autoReconnect: true,
      onEvent: event => { void handleEvent(event); },
    });

  await gateway.connect();

  return {
    stop: () => {
      gateway.close();
    },
  };
}
