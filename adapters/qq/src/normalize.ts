import type { QQGatewayEvent, QQObservationDraft } from './types.js';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function normalizeQQEvent(event: QQGatewayEvent): QQObservationDraft | null {
  const data = record(event.d);
  const type = event.t ?? '';
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.map(record)
    : [];
  const voice = attachments.find(item => (
    text(item.content_type) === 'voice'
    || Boolean(text(item.voice_wav_url))
  ));
  const transcript = text(voice?.asr_refer_text) || text(data.asr_refer_text);
  const content = text(data.content).trim() || transcript || (voice ? '[语音]' : '');

  if (!content) {
    return null;
  }

  const receivedAt = new Date().toISOString();
  const author = record(data.author);
  const actorId = text(author.id) || text(author.member_openid) || text(author.user_openid);
  const actorName = text(author.username) || text(author.nick) || undefined;
  const media = voice
    ? [{
      kind: 'audio' as const,
      url: text(voice.voice_wav_url) || text(data.voice_wav_url) || undefined,
      transcript: transcript || undefined,
      mimeType: 'audio/wav',
    }]
    : undefined;

  if (type === 'GROUP_AT_MESSAGE_CREATE' || type === 'GROUP_MESSAGE_CREATE') {
    const groupOpenId = text(data.group_openid);

    if (!groupOpenId) {
      return null;
    }

    const id = text(data.id) || text(event.id) || `${groupOpenId}:${receivedAt}`;
    return {
      id,
      platform: 'qq',
      conversationId: groupOpenId,
      conversationKind: 'group',
      actorId: actorId || undefined,
      actorName,
      isSelf: false,
      isBot: false,
      kind: 'message',
      content,
      media,
      occurredAt: text(data.timestamp) || receivedAt,
      receivedAt,
      provenance: 'untrusted',
      audience: 'group',
      trust: 0.5,
      dedupeKey: `qq:group:${groupOpenId}:${id}`,
      raw: event,
    };
  }

  if (type === 'C2C_MESSAGE_CREATE') {
    const userOpenId = text(author.user_openid) || text(author.id);

    if (!userOpenId) {
      return null;
    }

    const id = text(data.id) || text(event.id) || `${userOpenId}:${receivedAt}`;
    return {
      id,
      platform: 'qq',
      conversationId: userOpenId,
      conversationKind: 'dm',
      actorId: userOpenId,
      actorName,
      isSelf: false,
      isBot: false,
      kind: 'message',
      content,
      media,
      occurredAt: text(data.timestamp) || receivedAt,
      receivedAt,
      provenance: 'untrusted',
      audience: 'private',
      trust: 0.5,
      dedupeKey: `qq:dm:${userOpenId}:${id}`,
      raw: event,
    };
  }

  return null;
}

export function buildIdentifyPayload(token: string, intents: number) {
  return {
    op: 2,
    d: {
      token: `QQBot ${token}`,
      intents,
      properties: {
        $os: 'windows',
        $browser: 'herein',
        $device: 'herein',
      },
    },
  };
}
