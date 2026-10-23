import { readFile } from 'node:fs/promises';

export interface ATranscriptEvent {
  type: 'transcript';
  text: string;
  final: boolean;
  generation?: number;
  turnId?: string;
}

export interface APresenceEvent {
  type: 'presence';
  state?: string;
  micActive?: boolean;
  idleSeconds?: number;
  runtimeIdleSeconds?: number;
}

export interface AInterruptedEvent {
  type: 'interrupted';
  generation?: number;
  reason?: string;
}

export type AInteractionEvent =
  | ATranscriptEvent
  | APresenceEvent
  | AInterruptedEvent
  | { type: string; [key: string]: unknown };

export interface AInteractionSessionOptions {
  endpointFile: string;
  onEvent: (event: AInteractionEvent) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  reconnectMs?: number;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

interface AEndpoint {
  url: string;
  token: string;
}

export function parseAInteractionBlock(block: string): AInteractionEvent | null {
  const dataLines = block
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  const raw = dataLines.join('\n').trim();

  if (!raw || raw === '{}') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const type = (parsed as { type?: unknown }).type;

    return typeof type === 'string' && type
      ? parsed as AInteractionEvent
      : null;
  } catch {
    return null;
  }
}

async function readEndpoint(filePath: string): Promise<AEndpoint> {
  const raw = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw) as Partial<AEndpoint>;

  if (typeof parsed.url !== 'string' || !parsed.url.trim()) {
    throw new Error('A interaction endpoint URL is missing');
  }

  if (typeof parsed.token !== 'string' || !parsed.token.trim()) {
    throw new Error('A interaction endpoint token is missing');
  }

  return {
    url: parsed.url.trim().replace(/\/+$/, ''),
    token: parsed.token.trim(),
  };
}

export class AInteractionSession {
  private readonly options: AInteractionSessionOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly reconnectMs: number;
  private running = false;
  private controller: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(options: AInteractionSessionOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.reconnectMs = options.reconnectMs ?? 2000;
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop() {
    this.running = false;
    this.controller?.abort();
    await this.loopPromise;
    this.loopPromise = null;
  }

  isRunning() {
    return this.running;
  }

  private async loop() {
    while (this.running) {
      const controller = new AbortController();
      this.controller = controller;

      try {
        const endpoint = await readEndpoint(this.options.endpointFile);
        const response = await this.fetchImpl(`${endpoint.url}/v1/events`, {
          headers: {
            accept: 'text/event-stream',
            authorization: `Bearer ${endpoint.token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`A SSE HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error('A SSE response has no body');
        }

        await this.consume(response.body);
      } catch (error) {
        if (this.running && !controller.signal.aborted) {
          this.options.logger?.warn?.('A SSE connection failed', error);
        }
      } finally {
        this.controller = null;
      }

      if (this.running) {
        await new Promise<void>(resolve => setTimeout(resolve, this.reconnectMs));
      }
    }
  }

  private async consume(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this.running) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');

        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseAInteractionBlock(block);

          if (event) {
            await this.options.onEvent(event);
          }

          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
