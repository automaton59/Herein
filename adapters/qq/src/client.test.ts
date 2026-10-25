import { describe, expect, it, vi } from 'vitest';
import { QQBotApiError, QQBotClient } from './client';
import { buildIdentifyPayload, normalizeQQEvent } from './normalize';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('qq bot client', () => {
  it('caches the access token and sends a group message', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/app/getAppAccessToken')) {
        return jsonResponse({ access_token: 'token-1', expires_in: 7200 });
      }

      expect(url).toBe('https://api.sgroup.qq.com/v2/groups/group-1/messages');
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'QQBot token-1',
      }));
      const body = JSON.parse(String(init?.body)) as { content: string; msg_type: number; msg_id?: string };
      expect(body).toEqual({ content: '在。', msg_type: 0, msg_id: 'msg-1' });
      return jsonResponse({ id: 'sent-1', timestamp: '2026-10-21T12:00:00.000Z' });
    }) as typeof fetch;

    const client = new QQBotClient({
      config: { appId: 'app-1', appSecret: 'secret-1' },
      fetchImpl,
      now: () => 1000,
    });

    await expect(client.getAccessToken()).resolves.toBe('token-1');
    await expect(client.getAccessToken()).resolves.toBe('token-1');
    await expect(client.sendGroupMessage('group-1', '在。', 'msg-1')).resolves.toEqual({
      id: 'sent-1',
      timestamp: '2026-10-21T12:00:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uploads a voice URL and sends msg_type=7 with file_info', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/app/getAppAccessToken')) {
        return jsonResponse({ access_token: 'token-1', expires_in: 7200 });
      }

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

      if (url.endsWith('/v2/groups/group-1/files')) {
        expect(body).toEqual({
          file_type: 3,
          url: 'https://cdn.test/voice.wav',
          srv_send_msg: false,
        });
        return jsonResponse({ file_info: 'FILEINFO1' });
      }

      if (url.endsWith('/v2/groups/group-1/messages')) {
        expect(body).toEqual({
          msg_type: 7,
          media: { file_info: 'FILEINFO1' },
          msg_id: 'msg-1',
        });
        return jsonResponse({ id: 'sent-voice-1' });
      }

      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new QQBotClient({
      config: { appId: 'app-1', appSecret: 'secret-1' },
      fetchImpl,
      now: () => 1000,
    });

    const fileInfo = await client.uploadGroupVoice('group-1', 'https://cdn.test/voice.wav');
    expect(fileInfo).toBe('FILEINFO1');
    await expect(client.sendGroupVoice('group-1', fileInfo, 'msg-1')).resolves.toEqual({
      id: 'sent-voice-1',
    });
  });

  it('throws a typed error on non-2xx', async () => {
    const fetchImpl = (async () => jsonResponse({ message: 'unauthorized' }, 401)) as typeof fetch;
    const client = new QQBotClient({
      config: { appId: 'app-1', appSecret: 'bad' },
      fetchImpl,
    });

    await expect(client.getAccessToken()).rejects.toMatchObject({
      name: 'QQBotApiError',
      status: 401,
    } satisfies Partial<QQBotApiError>);
  });

  it('surfaces api errors that come back as HTTP 200 with a code', async () => {
    const fetchImpl = (async () => jsonResponse({
      code: 100016,
      message: 'invalid appid or secret',
    })) as typeof fetch;
    const client = new QQBotClient({
      config: { appId: 'app-1', appSecret: 'short' },
      fetchImpl,
    });

    await expect(client.getAccessToken()).rejects.toMatchObject({
      name: 'QQBotApiError',
      status: 200,
      code: 100016,
      message: 'code 100016: invalid appid or secret',
    } satisfies Partial<QQBotApiError>);
  });
});

describe('qq event normalization', () => {
  it('normalizes group and dm messages with audience/provenance', () => {
    const group = normalizeQQEvent({
      id: 'event-1',
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'msg-1',
        group_openid: 'group-1',
        content: '今天好累。',
        timestamp: '2026-10-21T12:00:00.000Z',
        author: { id: 'member-1', username: '蓝蓝' },
      },
    });

    expect(group).toEqual(expect.objectContaining({
      platform: 'qq',
      conversationId: 'group-1',
      conversationKind: 'group',
      actorId: 'member-1',
      content: '今天好累。',
      audience: 'group',
      provenance: 'untrusted',
    }));

    const dm = normalizeQQEvent({
      id: 'event-2',
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'msg-2',
        content: '在吗',
        author: { user_openid: 'user-1' },
      },
    });

    expect(dm).toEqual(expect.objectContaining({
      conversationId: 'user-1',
      conversationKind: 'dm',
      audience: 'private',
    }));
  });

  it('normalizes a voice message with platform ASR and WAV url', () => {
    const voice = normalizeQQEvent({
      id: 'event-voice',
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'msg-voice',
        content: '',
        author: { user_openid: 'user-1' },
        attachments: [{
          content_type: 'voice',
          voice_wav_url: 'https://example.test/voice.wav',
          asr_refer_text: '在吗',
        }],
      },
    });

    expect(voice).toEqual(expect.objectContaining({
      content: '在吗',
      conversationKind: 'dm',
      media: [{
        kind: 'audio',
        url: 'https://example.test/voice.wav',
        transcript: '在吗',
        mimeType: 'audio/wav',
      }],
    }));
  });

  it('ignores unknown events and builds an identify payload', () => {
    expect(normalizeQQEvent({ t: 'READY', d: {} })).toBeNull();
    expect(buildIdentifyPayload('token-1', 1 << 25)).toEqual({
      op: 2,
      d: {
        token: 'QQBot token-1',
        intents: 1 << 25,
        properties: {
          $os: 'windows',
          $browser: 'herein',
          $device: 'herein',
        },
      },
    });
  });
});
