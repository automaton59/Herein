import { readFile } from 'node:fs/promises';

export type InteractionPriority = 'ambient' | 'normal' | 'urgent';

export type InteractionSource = 'chat' | 'initiative' | 'system';

export interface SpeakRequest {
  text: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  priority?: InteractionPriority;
  interruptible?: boolean;
  source?: InteractionSource;
  turnId?: string;
  filler?: boolean;
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

export interface AInteractionPortOptions {
  endpointFile: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface AInteractionEndpoint {
  url: string;
  token: string;
}

/**
 * A's standalone Electron runtime uses /v1/speech, /v1/cancel and /health.
 * It writes a per-launch endpoint.local.json; read it on every request because
 * the port and token rotate when A restarts.
 */
export class AInteractionPort implements InteractionPort {
  private readonly endpointFile: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AInteractionPortOptions) {
    this.endpointFile = options.endpointFile;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const startedAt = Date.now();

    try {
      const response = await this.request('/v1/speech', {
        method: 'POST',
        body: JSON.stringify({
          text: request.text,
          emotion: request.emotion ?? 'neutral',
          instruct: request.voiceInstruct ?? '',
          ...(request.filler ? { filler: true } : {}),
          ...(request.turnId
            ? { turnId: request.turnId }
            : request.source === 'initiative'
              ? { turnId: `initiative-${Date.now()}` }
              : {}),
        }),
      });

      return {
        ok: response.ok,
        latencyMs: Date.now() - startedAt,
        ...(response.ok ? {} : { error: `A runtime HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async stop(): Promise<void> {
    await this.request('/v1/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async health(): Promise<InteractionHealth> {
    try {
      const response = await this.request('/health', { method: 'GET' });

      if (!response.ok) {
        return {
          status: 'unavailable',
          message: `A runtime HTTP ${response.status}`,
          checkedAt: new Date().toISOString(),
        };
      }

      const value = await response.json() as {
        ready?: boolean;
        asr?: boolean;
        tts?: boolean;
      };
      const missing = [
        value.ready ? null : 'runtime',
        value.asr ? null : 'asr',
        value.tts ? null : 'tts',
      ].filter((item): item is string => Boolean(item));

      return {
        status: missing.length === 0 ? 'ok' : value.ready ? 'degraded' : 'unavailable',
        message: missing.length === 0 ? undefined : `not ready: ${missing.join(', ')}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private async endpoint(): Promise<AInteractionEndpoint> {
    const raw = JSON.parse(await readFile(this.endpointFile, 'utf8')) as Partial<AInteractionEndpoint>;

    if (typeof raw.url !== 'string' || !raw.url.trim() || typeof raw.token !== 'string' || !raw.token.trim()) {
      throw new Error('A interaction endpoint is invalid');
    }

    return {
      url: raw.url.trim().replace(/\/+$/, ''),
      token: raw.token.trim(),
    };
  }

  private async request(pathname: string, init: RequestInit): Promise<Response> {
    const endpoint = await this.endpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(`${endpoint.url}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
