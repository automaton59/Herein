import { describe, expect, it, vi } from 'vitest';
import { publishNtfy, publishNtfyMessage } from './ntfy';

describe('ntfy push', () => {
  it('publishes a song notification as JSON', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://ntfy.example/');
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer token-1',
      }));
      const body = JSON.parse(String(init?.body)) as {
        topic: string;
        title: string;
        message: string;
        tags: string[];
      };
      expect(body.topic).toBe('herein-test');
      expect(body.title).toBe('蓝蓝转了一首歌');
      expect(body.message).toContain('夜曲 — 周杰伦');
      expect(body.message).toContain('这个好听。');
      expect(body.tags).toEqual(['musical_note']);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await expect(publishNtfy({
      url: 'https://ntfy.example',
      topic: 'herein-test',
      token: 'token-1',
    }, {
      title: '夜曲',
      creator: '周杰伦',
      shareLine: '这个好听。',
    }, fetchImpl)).resolves.toBe(true);
  });

  it('publishes a generic proactive message', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        title: string;
        message: string;
        tags: string[];
      };
      expect(body.title).toBe('蓝蓝');
      expect(body.message).toBe('刚看到个东西，想起你。');
      expect(body.tags).toEqual(['speech_balloon']);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await expect(publishNtfyMessage({
      url: 'https://ntfy.example',
      topic: 'herein-test',
      click: 'http://example.test',
    }, {
      title: '蓝蓝',
      message: '刚看到个东西，想起你。',
      tags: ['speech_balloon'],
    }, fetchImpl)).resolves.toBe(true);
  });
});
