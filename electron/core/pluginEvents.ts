import { randomUUID } from 'node:crypto';
import type { createPhase2Repositories, ObservationRecord } from '../data/repositories';
import { PluginError, type PluginEvent } from '../plugins/types';

type Repositories = ReturnType<typeof createPhase2Repositories>;

/**
 * A channel message that has already been persisted and may need a reply.
 * Deliberately narrow: the Core only needs to know where to send and what was
 * said. Protocol details (msg_id, openid, group vs c2c) stay inside the plugin.
 */
export interface PluginChannelMessage {
  conversationId: string;
  conversationKind: 'dm' | 'group';
  msgId: string;
  content: string;
  actorName?: string | null;
}

export interface PluginEventSinkOptions {
  repos: Repositories;
  logger?: { warn: (message: string, detail?: unknown) => void };
  /**
   * Produces reply text for an incoming channel message. Returning null means
   * "stay silent". The Core owns persona, memory and model access — the plugin
   * never sees any of it.
   */
  onChannelMessage?: (pluginId: string, message: PluginChannelMessage) => Promise<string | null>;
  /** Sends the reply back through the plugin that produced the message. */
  sendReply?: (pluginId: string, message: PluginChannelMessage, reply: string) => Promise<void>;
}

const CONVERSATION_KINDS = new Set(['dm', 'group', 'public']);
const PROVENANCES = new Set(['owner', 'agent', 'untrusted', 'system']);
const AUDIENCES = new Set(['private', 'group', 'public']);
const RETENTIONS = new Set(['ephemeral', 'normal', 'long']);

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginError('invalid_manifest', `plugin event is missing "${field}"`, 400);
  }

  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function timestamp(value: unknown, field: string): string {
  const raw = text(value, field);
  const parsed = Date.parse(raw);

  if (Number.isNaN(parsed)) {
    throw new PluginError('invalid_manifest', `plugin event field "${field}" is not a valid date`, 400);
  }

  return new Date(parsed).toISOString();
}

/**
 * Turns a plugin-supplied observation draft into a record the repositories
 * accept. The plugin describes what it saw; the Core decides identity, defaults
 * and persistence. Fields the plugin is not allowed to set are ignored.
 */
export function toObservationRecord(payload: Record<string, unknown>): ObservationRecord {
  const conversationKind = text(payload.conversationKind, 'conversationKind');

  if (!CONVERSATION_KINDS.has(conversationKind)) {
    throw new PluginError('invalid_manifest', `unknown conversationKind: ${conversationKind}`, 400);
  }

  const provenance = text(payload.provenance ?? 'untrusted', 'provenance');

  if (!PROVENANCES.has(provenance)) {
    throw new PluginError('invalid_manifest', `unknown provenance: ${provenance}`, 400);
  }

  const audience = text(payload.audience ?? 'private', 'audience');

  if (!AUDIENCES.has(audience)) {
    throw new PluginError('invalid_manifest', `unknown audience: ${audience}`, 400);
  }

  const retention = optionalText(payload.retention) ?? 'normal';

  if (!RETENTIONS.has(retention)) {
    throw new PluginError('invalid_manifest', `unknown retention: ${retention}`, 400);
  }

  const trust = typeof payload.trust === 'number' && Number.isFinite(payload.trust)
    ? Math.max(0, Math.min(1, payload.trust))
    : 0.5;

  const media = Array.isArray(payload.media) ? payload.media : [];

  return {
    id: optionalText(payload.id) ?? randomUUID(),
    platform: text(payload.platform, 'platform'),
    accountId: optionalText(payload.accountId),
    conversationId: text(payload.conversationId, 'conversationId'),
    conversationKind: conversationKind as ObservationRecord['conversationKind'],
    actorId: optionalText(payload.actorId),
    actorName: optionalText(payload.actorName),
    isSelf: payload.isSelf === true,
    isBot: payload.isBot === true,
    kind: text(payload.kind, 'kind'),
    content: optionalText(payload.content),
    media,
    occurredAt: timestamp(payload.occurredAt, 'occurredAt'),
    receivedAt: optionalText(payload.receivedAt) ?? new Date().toISOString(),
    provenance: provenance as ObservationRecord['provenance'],
    audience: audience as ObservationRecord['audience'],
    trust,
    retention: retention as ObservationRecord['retention'],
    raw: payload.raw,
    dedupeKey: optionalText(payload.dedupeKey),
  };
}

function toChannelMessage(payload: Record<string, unknown>, record: ObservationRecord): PluginChannelMessage {
  const conversationKind = record.conversationKind;

  if (conversationKind !== 'dm' && conversationKind !== 'group') {
    throw new PluginError(
      'invalid_manifest',
      `channel.message needs conversationKind "dm" or "group", got "${conversationKind}"`,
      400,
    );
  }

  return {
    conversationId: record.conversationId,
    conversationKind,
    msgId: text(payload.msgId, 'msgId'),
    content: record.content ?? '',
    actorName: record.actorName ?? null,
  };
}

/**
 * The single place where plugin-originated data becomes durable. Every plugin
 * event flows through here, so persistence, dedupe and reply policy stay in the
 * Core instead of being reimplemented per plugin.
 */
export function createPluginEventSink(options: PluginEventSinkOptions) {
  return async (pluginId: string, event: PluginEvent): Promise<void> => {
    if (event.type === 'observation') {
      options.repos.observations.insert(toObservationRecord(event.payload));
      return;
    }

    if (event.type === 'channel.message') {
      const record = toObservationRecord(event.payload);
      const inserted = options.repos.observations.insert(record);

      if (!inserted || event.payload.shouldReply !== true || !options.onChannelMessage) {
        return;
      }

      const message = toChannelMessage(event.payload, record);

      let reply: string | null = null;

      try {
        reply = await options.onChannelMessage(pluginId, message);
      } catch (error) {
        options.logger?.warn(`channel reply generation failed: ${pluginId}`, error);
        return;
      }

      if (!reply?.trim() || !options.sendReply) {
        return;
      }

      try {
        await options.sendReply(pluginId, message, reply.trim());
      } catch (error) {
        // A failed send must not break the listener loop.
        options.logger?.warn(`channel reply send failed: ${pluginId}`, error);
      }

      return;
    }

    throw new PluginError('plugin_failed', `unsupported plugin event: ${event.type}`, 400);
  };
}
