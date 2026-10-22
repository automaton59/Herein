import type { QQGatewayEvent } from './types.js';
import { buildIdentifyPayload } from './normalize.js';

export interface QQSocket {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ): void;
}

export type QQSocketFactory = (url: string) => QQSocket;

export interface QQGatewayClientLike {
  getAccessToken(): Promise<string>;
  getGateway(): Promise<{ url: string }>;
}

export interface QQGatewayOptions {
  client: QQGatewayClientLike;
  intents: number;
  socketFactory?: QQSocketFactory;
  onEvent?: (event: QQGatewayEvent) => void;
  onReady?: () => void;
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
}

type GatewayPayload = {
  op?: number;
  s?: number;
  t?: string;
  d?: Record<string, unknown>;
};

function defaultSocketFactory(url: string): QQSocket {
  const Constructor = (globalThis as {
    WebSocket?: new (url: string) => QQSocket;
  }).WebSocket;

  if (!Constructor) {
    throw new Error('WebSocket is not available in this runtime');
  }

  return new Constructor(url);
}

export class QQGateway {
  private readonly options: QQGatewayOptions;
  private socket: QQSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSequence: number | null = null;
  private closed = false;
  private identified = false;
  private token = '';

  constructor(options: QQGatewayOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.identified = false;
    const token = await this.options.client.getAccessToken();
    this.token = token;
    const gateway = await this.options.client.getGateway();
    const factory = this.options.socketFactory ?? defaultSocketFactory;
    const socket = factory(gateway.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.send(buildIdentifyPayload(token, this.options.intents));
      this.identified = true;
    });

    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') {
        return;
      }

      let payload: GatewayPayload;
      try {
        payload = JSON.parse(event.data) as GatewayPayload;
      } catch {
        return;
      }

      this.handlePayload(payload);
    });

    socket.addEventListener('close', () => {
      this.clearHeartbeat();
      this.socket = null;
      this.identified = false;

      if (!this.closed && this.options.autoReconnect) {
        this.reconnectTimer = setTimeout(() => {
          void this.connect().catch(() => undefined);
        }, this.options.reconnectDelayMs ?? 3000);
      }
    });

    socket.addEventListener('error', () => {
      // close/error handlers own reconnect and cleanup.
    });
  }

  close(): void {
    this.closed = true;
    this.clearHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }

  private clearHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private send(payload: unknown) {
    this.socket?.send(JSON.stringify(payload));
  }

  private handlePayload(payload: GatewayPayload) {
    if (typeof payload.s === 'number') {
      this.lastSequence = payload.s;
    }

    if (payload.op === 10) {
      const interval = typeof payload.d?.heartbeat_interval === 'number'
        ? payload.d.heartbeat_interval
        : 30_000;
      this.clearHeartbeat();
      this.heartbeat = setInterval(() => {
        this.send({ op: 1, d: this.lastSequence });
      }, interval);

      if (!this.identified) {
        // Some gateways do not emit a separate open event; identify after HELLO.
        this.send(buildIdentifyPayload(this.token, this.options.intents));
        this.identified = true;
      }
      return;
    }

    if (payload.op === 7) {
      this.socket?.close();
      return;
    }

    if (payload.op === 9) {
      this.closed = true;
      this.socket?.close();
      return;
    }

    if (payload.op === 0 && payload.t) {
      if (payload.t === 'READY') {
        this.options.onReady?.();
      }

      this.options.onEvent?.({
        id: typeof payload.d?.id === 'string' ? payload.d.id : undefined,
        op: payload.op,
        s: payload.s,
        t: payload.t,
        d: payload.d,
      });
    }
  }
}
