import { VoiceActivity } from './audio';

interface VoiceBridge {
  transcribe(
    pcm: Uint8Array,
    turnId?: string,
  ): Promise<{ text: string; elapsedMs?: number; rejected?: string }>;
  cancel(): Promise<unknown>;
  status(): Promise<{ ready: { asr: boolean; tts: boolean } }>;
  onPcm(callback: (payload: unknown) => void): () => void;
  onCancel(callback: (payload: unknown) => void): () => void;
}

interface PcmPayload {
  generation?: number;
  pcm?: Uint8Array;
}

export interface PresenceVoiceCallbacks {
  onLevel?: (level: number) => void;
  onMouth?: (mouth: number) => void;
  onState?: (state: 'idle' | 'listening' | 'thinking') => void;
  onText?: (text: string) => void;
  onError?: (message: string) => void;
}

function bridge(): VoiceBridge | null {
  return (window as unknown as { hereinVoice?: VoiceBridge }).hereinVoice ?? null;
}

/**
 * C presence owns the microphone and speaker now. The main process only runs
 * the worker processes and forwards PCM; there is no second renderer.
 */
export class PresenceVoice {
  private context: AudioContext | null = null;
  private output: AudioWorkletNode | null = null;
  private input: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private vad = new VoiceActivity();
  private readonly voice = bridge();
  private unsubscribers: Array<() => void> = [];
  private generation = 0;
  private mouth = 0;
  private decayTimer: number | null = null;
  private idleTimer: number | null = null;
  private lastActivity = Date.now();
  private micOn = false;
  private asrBusy = false;
  private deviceId = '';
  private starting: Promise<void> | null = null;

  constructor(private readonly callbacks: PresenceVoiceCallbacks = {}) {}

  get listening() {
    return this.micOn;
  }

  async start(options: { listen?: boolean } = {}) {
    if (this.starting) {
      return this.starting;
    }

    this.starting = this.startInternal(options).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startInternal(options: { listen?: boolean }) {
    if (!this.voice) {
      this.callbacks.onError?.('语音桥未加载');
      return;
    }

    this.context ??= new AudioContext({ sampleRate: 24_000 });
    await this.context.audioWorklet.addModule(
      new URL('voice-worklet.js', window.location.href).href,
    );

    if (!this.output) {
      this.output = new AudioWorkletNode(this.context, 'herein-output', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { initialBufferMs: 240 },
      });
      this.output.connect(this.context.destination);
      this.output.port.onmessage = ({ data }) => {
        if (data?.type === 'drained') {
          this.callbacks.onMouth?.(0);
        }
      };
    }

    if (this.unsubscribers.length === 0) {
      this.unsubscribers.push(this.voice.onPcm(payload => this.handlePcm(payload)));
      this.unsubscribers.push(this.voice.onCancel(() => this.clearAudio()));
    }

    await this.context.resume();
    this.decayTimer ??= window.setInterval(() => this.decayMouth(), 50);
    this.idleTimer ??= window.setInterval(() => {
      if (this.micOn && Date.now() - this.lastActivity > 90_000) {
        this.stopMic();
        this.callbacks.onError?.('90 秒没有有效对话，已自动停止监听。');
      }
    }, 5_000);

    if (options.listen) {
      await this.startMic();
    }
  }

  async startMic() {
    if (this.micOn || !this.context) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    const source = this.context.createMediaStreamSource(stream);
    const input = new AudioWorkletNode(this.context, 'herein-input', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });

    source.connect(input);
    input.port.onmessage = ({ data }) => this.consumeInput(data?.samples);
    this.stream = stream;
    this.source = source;
    this.input = input;
    this.micOn = true;
    this.lastActivity = Date.now();
    this.vad.reset();
    this.callbacks.onState?.('listening');
    await this.context.resume();
  }

  stopMic() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect();
    this.input?.disconnect();
    this.stream = null;
    this.source = null;
    this.input = null;
    this.micOn = false;
    this.vad.reset();
    this.callbacks.onState?.('idle');
  }

  private consumeInput(samples?: Float32Array) {
    if (!samples || !this.micOn) {
      return;
    }

    const result = this.vad.consume(samples, 20, this.outputActive());
    this.callbacks.onLevel?.(Math.min(1, result.rms * 8));

    for (const event of result.events) {
      if (event.type === 'start') {
        if (this.mouth > 0.08) {
          this.cancel();
        }

        this.callbacks.onState?.('listening');
      }

      if (event.type === 'end' && event.frames) {
        void this.transcribe(event.frames);
      }
    }
  }

  private outputActive() {
    return this.mouth > 0.04;
  }

  private async transcribe(frames: Float32Array[]) {
    if (!this.voice || this.asrBusy) {
      return;
    }

    const total = frames.reduce((sum, frame) => sum + frame.length, 0);

    if (total < 1600) {
      return;
    }

    const pcm = new Int16Array(Math.min(total, 240_000));
    let offset = 0;

    for (const frame of frames) {
      for (const value of frame) {
        if (offset >= pcm.length) {
          break;
        }

        pcm[offset++] = Math.max(-32768, Math.min(32767, value * 32767));
      }
    }

    this.asrBusy = true;
    this.callbacks.onState?.('thinking');

    try {
      const result = await this.voice.transcribe(
        new Uint8Array(pcm.buffer),
        crypto.randomUUID(),
      );
      const text = result.text.trim();
      this.callbacks.onText?.(text);

      if (text) {
        this.lastActivity = Date.now();
      } else {
        this.callbacks.onError?.(result.rejected === 'media-hallucination'
          ? '忽略：疑似媒体/字幕声'
          : result.rejected === 'repeated'
            ? '忽略：重复片段'
            : '没听清：检查输入设备和麦克风音量。');
      }
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'ASR failed');
    } finally {
      this.asrBusy = false;
      this.callbacks.onState?.(this.micOn ? 'listening' : 'idle');
    }
  }

  private handlePcm(payload: unknown) {
    if (!this.output || !this.context) {
      return;
    }

    const data = payload as PcmPayload;
    const bytes = data.pcm;

    if (!bytes || !(bytes instanceof Uint8Array)) {
      return;
    }

    const generation = data.generation ?? this.generation + 1;

    if (generation !== this.generation) {
      this.generation = generation;
      this.output.port.postMessage({ type: 'cancel', generation });
    }

    const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }

    let energy = 0;
    for (const sample of samples) {
      energy += sample * sample;
    }

    const rms = Math.sqrt(energy / Math.max(1, samples.length));
    this.mouth = Math.max(this.mouth, Math.min(1, rms * 5));
    this.callbacks.onMouth?.(this.mouth);

    this.output.port.postMessage({ type: 'pcm', samples, generation }, [samples.buffer]);
  }

  private clearAudio() {
    this.output?.port.postMessage({ type: 'cancel', generation: ++this.generation });
    this.mouth = 0;
    this.callbacks.onMouth?.(0);
  }

  private decayMouth() {
    if (this.mouth <= 0.01) {
      this.mouth = 0;
      return;
    }

    this.mouth *= 0.86;
    this.callbacks.onMouth?.(this.mouth);
  }

  cancel() {
    void this.voice?.cancel();
    this.clearAudio();
  }

  async setDevice(deviceId: string) {
    this.deviceId = deviceId;
    const wasOn = this.micOn;

    if (wasOn) {
      this.stopMic();
      await this.startMic();
    }
  }

  async devices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  }

  async stop() {
    this.stopMic();
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
    this.input?.disconnect();
    this.output?.disconnect();
    this.source?.disconnect();
    this.input = null;
    this.output = null;
    this.source = null;

    if (this.decayTimer !== null) {
      window.clearInterval(this.decayTimer);
      this.decayTimer = null;
    }

    if (this.idleTimer !== null) {
      window.clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
