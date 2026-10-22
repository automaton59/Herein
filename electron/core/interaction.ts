export type InteractionPriority = 'ambient' | 'normal' | 'urgent';

export type InteractionSource = 'chat' | 'initiative' | 'system';

export interface SpeakRequest {
  text: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  priority?: InteractionPriority;
  interruptible?: boolean;
  source?: InteractionSource;
}

export interface SpeakResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export interface PresenceState {
  mode?: 'idle' | 'listening' | 'speaking' | 'thinking' | 'sleeping';
  availability?: 'available' | 'busy' | 'away';
  atDesk?: boolean;
  detail?: Record<string, unknown>;
}

export interface InteractionHealth {
  status: 'ok' | 'degraded' | 'unavailable' | 'unknown';
  message?: string;
  checkedAt: string;
  latencyMs?: number;
}

export interface InteractionPort {
  speak(request: SpeakRequest): Promise<SpeakResult>;
  stop?(): Promise<void>;
  setPresence?(presence: PresenceState): Promise<void>;
  health?(): Promise<InteractionHealth>;
}

export interface InteractionLogger {
  warn?: (message: string, detail?: unknown) => void;
}

export interface InteractionDispatcherOptions {
  logger?: InteractionLogger;
}

export class InteractionDispatcher {
  private readonly port?: InteractionPort;
  private readonly logger?: InteractionLogger;

  constructor(port?: InteractionPort, options: InteractionDispatcherOptions = {}) {
    this.port = port;
    this.logger = options.logger;
  }

  available() {
    return Boolean(this.port);
  }

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    if (!this.port) {
      return { ok: false, error: 'interaction port is not configured' };
    }

    try {
      return await this.port.speak(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.('interaction speak failed', error);
      return { ok: false, error: message };
    }
  }

  async stop(): Promise<void> {
    try {
      await this.port?.stop?.();
    } catch (error) {
      this.logger?.warn?.('interaction stop failed', error);
    }
  }

  async setPresence(presence: PresenceState): Promise<void> {
    try {
      await this.port?.setPresence?.(presence);
    } catch (error) {
      this.logger?.warn?.('interaction presence failed', error);
    }
  }

  async health(): Promise<InteractionHealth> {
    if (!this.port?.health) {
      return {
        status: this.port ? 'unknown' : 'unavailable',
        message: this.port ? 'interaction port has no health check' : 'interaction port is not configured',
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      return await this.port.health();
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export interface HttpInteractionPortOptions {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpInteractionPort implements InteractionPort {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpInteractionPortOptions) {
    this.url = options.url.trim().replace(/\/+$/, '');
    this.token = options.token?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;

    if (!this.url) {
      throw new Error('interaction URL is required');
    }
  }

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const startedAt = Date.now();
    const response = await this.request('/speak', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return {
      ok: response.ok,
      latencyMs: Date.now() - startedAt,
      ...(response.ok ? {} : { error: `interaction HTTP ${response.status}` }),
    };
  }

  async stop(): Promise<void> {
    await this.request('/stop', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async setPresence(presence: PresenceState): Promise<void> {
    await this.request('/presence', {
      method: 'POST',
      body: JSON.stringify(presence),
    });
  }

  async health(): Promise<InteractionHealth> {
    const startedAt = Date.now();

    try {
      const response = await this.request('/health', { method: 'GET' });
      return {
        status: response.ok ? 'ok' : 'unavailable',
        message: response.ok ? undefined : `interaction HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
        ...(response.ok ? { latencyMs: Date.now() - startedAt } : {}),
      };
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private async request(pathname: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(`${this.url}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
