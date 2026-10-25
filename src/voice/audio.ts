export class PcmRing {
  private readonly data: Float32Array;
  private read = 0;
  private write = 0;
  private count = 0;

  constructor(capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get size() {
    return this.count;
  }

  clear() {
    this.read = 0;
    this.write = 0;
    this.count = 0;
  }

  push(samples: Float32Array): boolean {
    if (samples.length > this.data.length - this.count) {
      return false;
    }

    for (const sample of samples) {
      this.data[this.write] = sample;
      this.write = (this.write + 1) % this.data.length;
      this.count += 1;
    }

    return true;
  }

  take(target: Float32Array): number {
    const count = Math.min(target.length, this.count);

    for (let index = 0; index < count; index += 1) {
      target[index] = this.data[this.read];
      this.read = (this.read + 1) % this.data.length;
      this.count -= 1;
    }

    return count;
  }
}

export interface VoiceActivityOptions {
  startMs?: number;
  endMs?: number;
  minSpeechMs?: number;
  maxUtteranceMs?: number;
  threshold?: number;
}

export interface VoiceActivityEvent {
  type: 'start' | 'end' | 'discard';
  frames?: Float32Array[];
  durationMs?: number;
}

export interface VoiceActivityResult {
  rms: number;
  voiced: boolean;
  events: VoiceActivityEvent[];
}

export class VoiceActivity {
  readonly options: Required<VoiceActivityOptions>;
  private active = false;
  private startFrames = 0;
  private silenceMs = 0;
  private voiceMs = 0;
  private frames: Float32Array[] = [];
  private pre: Float32Array[] = [];
  private durationMs = 0;
  private noise = 0.003;

  constructor(options: VoiceActivityOptions = {}) {
    this.options = {
      startMs: 50,
      endMs: 500,
      minSpeechMs: 120,
      maxUtteranceMs: 15_000,
      threshold: 0.01,
      ...options,
    };
  }

  reset() {
    this.active = false;
    this.startFrames = 0;
    this.silenceMs = 0;
    this.voiceMs = 0;
    this.frames = [];
    this.pre = [];
    this.durationMs = 0;
  }

  consume(samples: Float32Array, dt = 20, outputSpeaking = false): VoiceActivityResult {
    let sum = 0;

    for (const sample of samples) {
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    const threshold = Math.max(
      this.options.threshold,
      this.noise * 3,
      outputSpeaking ? this.options.threshold * 1.5 : 0,
    );
    const voiced = rms > threshold;
    const events: VoiceActivityEvent[] = [];

    if (!this.active) {
      this.pre.push(samples);

      if (this.pre.length > 10) {
        this.pre.shift();
      }

      if (!voiced) {
        this.noise = this.noise * 0.99 + Math.min(rms, 0.02) * 0.01;
      }

      this.startFrames = voiced ? this.startFrames + dt : 0;

      if (this.startFrames >= this.options.startMs) {
        this.active = true;
        this.frames = [...this.pre];
        this.durationMs = this.pre.length * dt;
        this.voiceMs = this.startFrames;
        this.silenceMs = 0;
        events.push({ type: 'start' });
      }
    } else {
      this.frames.push(samples);
      this.durationMs += dt;

      if (voiced) {
        this.silenceMs = 0;
        this.voiceMs += dt;
      } else {
        this.silenceMs += dt;
      }

      if (
        this.silenceMs >= this.options.endMs
        || this.durationMs >= this.options.maxUtteranceMs
      ) {
        const voiceMs = this.voiceMs;
        const frames = this.frames;
        const durationMs = this.durationMs;
        this.reset();
        events.push({
          type: voiceMs >= this.options.minSpeechMs ? 'end' : 'discard',
          frames,
          durationMs,
        });
      }
    }

    return { rms, voiced, events };
  }
}
