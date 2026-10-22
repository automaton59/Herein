import { afterEach, describe, expect, it, vi } from 'vitest';
import { QQGateway, type QQSocket } from './gateway';

class FakeSocket implements QQSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: 'open' | 'message' | 'close' | 'error', event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('qq gateway', () => {
  it('identifies, heartbeats and dispatches events', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const events: unknown[] = [];
    const gateway = new QQGateway({
      client: {
        getAccessToken: async () => 'token-1',
        getGateway: async () => ({ url: 'wss://gateway.test' }),
      },
      intents: 1 << 25,
      socketFactory: () => socket,
      onEvent: event => events.push(event),
    });

    await gateway.connect();
    socket.emit('open');
    expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({
      op: 2,
      d: expect.objectContaining({ token: 'QQBot token-1' }),
    }));

    socket.emit('message', {
      data: JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }),
    });
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(socket.sent[1])).toEqual({ op: 1, d: null });

    socket.emit('message', {
      data: JSON.stringify({
        op: 0,
        s: 1,
        t: 'GROUP_MESSAGE_CREATE',
        d: { id: 'msg-1', group_openid: 'group-1', content: '在吗' },
      }),
    });
    expect(events).toHaveLength(1);

    gateway.close();
    expect(socket.closed).toBe(true);
  });
});
