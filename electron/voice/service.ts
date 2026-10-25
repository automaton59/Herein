import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  InteractionHealth,
  InteractionPort,
  PresenceState,
  SpeakRequest,
  SpeakResult,
} from '../core/interaction';

interface WorkerConfig {
  asr: {
    python: string;
    model: string;
    device?: string;
    cudaBin?: string;
  };
  tts: {
    provider: string;
    voice?: string;
    qwenPython?: string;
    qwenModel?: string;
    ggufSource?: string;
    ggufDependencies?: string;
    ggufDecoder?: string;
    cudaBin?: string;
  };
}

interface TranscriptResult {
  text?: string;
  elapsedMs?: number;
  error?: string;
  duration?: number;
  noSpeechProb?: number;
  avgLogprob?: number;
  compressionRatio?: number;
  languageProb?: number;
}

interface PcmMeta {
  first: boolean;
  provider: string;
  firstMs: number;
  generation: number;
}

interface VoiceWorkersLike {
  asr: { ready: boolean } | null;
  ready: boolean;
  speak(
    command: { text: string; emotion?: string; instruct?: string; speaker?: string; filler?: boolean },
    generation: number,
    onPcm: (pcm: Uint8Array, meta: Omit<PcmMeta, 'generation'>) => Promise<void> | void,
  ): Promise<unknown>;
  transcribe(pcm: Uint8Array): Promise<TranscriptResult>;
  cancel(): void;
  close(): void;
}

export interface VoiceServiceOptions {
  configPath: string | null;
  speaker?: string;
  httpTtsUrl?: string | null;
  onPcm: (pcm: Uint8Array, meta: PcmMeta) => void;
  onCancel: (generation: number) => void;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

function emotionInstruction(emotion?: string | null) {
  switch (emotion) {
    case 'happy':
    case 'excited':
      return '用轻快、亲近、带一点笑意的语气';
    case 'sad':
    case 'worried':
      return '用轻一点、放慢、带关心的语气';
    case 'angry':
      return '用压低、直白、克制的语气';
    case 'shy':
      return '用有点小声、害羞、自然的语气';
    case 'playful':
      return '用俏皮、随意、像熟人聊天的语气';
    default:
      return '用自然、口语化、像真人聊天的语气';
  }
}

function extractWavPcm(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') {
    return wav;
  }

  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') {
      return wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size));
    }
    offset += 8 + size + (size % 2);
  }

  return wav.subarray(44);
}

/**
 * C's own voice backend. A's worker processes are internal children now; no
 * separate HTTP endpoint, window, or SSE transport is involved.
 */
export class VoiceService {
  private workers: VoiceWorkersLike | null = null;
  private config: WorkerConfig | null = null;
  private generation = 0;
  private httpController: AbortController | null = null;
  private readonly httpTtsUrl: string | null;
  readonly ready = { asr: false, tts: false };
  private started = false;

  constructor(private readonly options: VoiceServiceOptions) {
    this.httpTtsUrl = options.httpTtsUrl?.replace(/\/+$/, '') ?? null;

    if (options.configPath && existsSync(options.configPath)) {
      this.config = JSON.parse(readFileSync(options.configPath, 'utf8')) as WorkerConfig;
    }
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;

    if (!this.config) {
      this.options.logger?.warn?.('voice backend skipped: no worker config');
      return;
    }

    const source = path.join(process.cwd(), 'electron', 'voice', 'workers.cjs');
    const fallback = path.join(__dirname, '..', '..', 'electron', 'voice', 'workers.cjs');
    const workersPath = existsSync(source) ? source : fallback;

    try {
      const workerConfig = this.httpTtsUrl
        ? {
          ...this.config,
          // HTTP TTS owns the Qwen model; only keep the ASR/SAPI worker here.
          tts: { ...this.config.tts, provider: 'sapi' },
        }
        : this.config;

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { VoiceWorkers } = require(workersPath) as {
        VoiceWorkers: new (config: WorkerConfig) => VoiceWorkersLike;
      };
      const workers = new VoiceWorkers(workerConfig);
      this.workers = workers;

      (workers as unknown as {
        on: (event: string, listener: (payload: Record<string, unknown>) => void) => void;
      }).on('capability', payload => {
        if (payload.asr === 'ready') {
          this.ready.asr = true;
        }
        if (payload.asr === 'unavailable') {
          this.ready.asr = false;
        }
        if (payload.tts === 'ready' && !this.httpTtsUrl) {
          this.ready.tts = true;
        }
        if (payload.tts === 'unavailable' && !this.httpTtsUrl) {
          this.ready.tts = false;
        }
        this.options.logger?.info?.('voice capability', payload);
      });

      if (this.httpTtsUrl) {
        void this.checkHttpTts();
      }
    } catch (error) {
      this.options.logger?.warn?.('voice backend failed to start', error);
    }
  }

  private async checkHttpTts() {
    const started = Date.now();

    while (this.httpTtsUrl && Date.now() - started < 60_000) {
      try {
        const response = await fetch(`${this.httpTtsUrl}/health`);
        if (response.ok) {
          this.ready.tts = true;
          return;
        }
      } catch {
        // Service is still loading.
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async waitForTts(timeoutMs = 30_000) {
    const started = Date.now();

    while (!this.ready.tts && Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    return this.ready.tts;
  }

  async transcribe(pcm: Uint8Array) {
    if (!this.workers) {
      throw new Error('voice backend is not ready');
    }

    return this.workers.transcribe(pcm);
  }

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    if (!this.workers) {
      return { ok: false, error: 'voice backend is not ready' };
    }

    if (!this.ready.tts) {
      return { ok: false, error: 'TTS is still loading' };
    }

    if (this.httpTtsUrl) {
      return this.speakHttp(request);
    }

    const generation = ++this.generation;
    this.options.onCancel(generation);

    const task = this.workers.speak(
      {
        text: request.text,
        emotion: request.emotion ?? 'neutral',
        instruct: request.voiceInstruct ?? emotionInstruction(request.emotion),
        speaker: this.options.speaker ?? process.env.HEREIN_VOICE_SPEAKER ?? 'vivian',
        filler: request.filler,
      },
      generation,
      (pcm, meta) => {
        this.options.onPcm(pcm, { ...meta, generation });
      },
    );

    void task.catch(error => {
      this.options.logger?.warn?.('voice speak failed', error);
    });

    return { ok: true };
  }

  private speakHttp(request: SpeakRequest): SpeakResult {
    if (!this.httpTtsUrl) {
      return { ok: false, error: 'TTS URL is missing' };
    }

    const generation = ++this.generation;
    this.httpController?.abort();
    const controller = new AbortController();
    this.httpController = controller;
    this.options.onCancel(generation);

    void (async () => {
      const started = Date.now();
      const response = await fetch(`${this.httpTtsUrl}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: request.text,
          emotion: request.emotion ?? 'neutral',
          instruct: request.voiceInstruct ?? emotionInstruction(request.emotion),
          speaker: this.options.speaker ?? process.env.HEREIN_VOICE_SPEAKER ?? 'vivian',
          language: 'Chinese',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS HTTP ${response.status}`);
      }

      const wav = Buffer.from(await response.arrayBuffer());
      const pcm = extractWavPcm(wav);
      let first = true;

      for (let offset = 0; offset < pcm.length; offset += 4800) {
        if (generation !== this.generation) {
          return;
        }

        const chunk = pcm.subarray(offset, offset + 4800);
        this.options.onPcm(chunk, {
          first,
          provider: 'qwen-http',
          firstMs: Date.now() - started,
          generation,
        });
        first = false;
      }
    })().catch(error => {
      if ((error as Error)?.name !== 'AbortError') {
        this.options.logger?.warn?.('voice HTTP TTS failed', error);
      }
    });

    return { ok: true };
  }

  cancel() {
    this.generation += 1;
    this.httpController?.abort();
    this.httpController = null;
    this.workers?.cancel();
    this.options.onCancel(this.generation);
  }

  async health(): Promise<InteractionHealth> {
    return {
      status: this.workers && this.ready.tts && this.ready.asr ? 'ok' : 'degraded',
      message: !this.workers
        ? 'voice backend not started'
        : `asr=${this.ready.asr} tts=${this.ready.tts}`,
      checkedAt: new Date().toISOString(),
    };
  }

  createPort(): InteractionPort {
    return {
      speak: request => this.speak(request),
      stop: async () => this.cancel(),
      setPresence: async (_presence: PresenceState) => undefined,
      health: () => this.health(),
    };
  }

  close() {
    this.cancel();
    this.workers?.close();
    this.workers = null;
  }
}
