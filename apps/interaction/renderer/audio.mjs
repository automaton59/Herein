export class PcmRing {
  constructor(capacity) {
    this.data = new Float32Array(capacity);
    this.read = 0;
    this.write = 0;
    this.size = 0;
  }
  push(samples) {
    if (samples.length > this.data.length - this.size) return false;
    for (const value of samples) {
      this.data[this.write] = value;
      this.write = (this.write + 1) % this.data.length;
    }
    this.size += samples.length;
    return true;
  }
  take(output) {
    const count = Math.min(output.length, this.size);
    for (let i = 0; i < count; i++) {
      output[i] = this.data[this.read];
      this.read = (this.read + 1) % this.data.length;
    }
    output.fill(0, count);
    this.size -= count;
    return count;
  }
  clear() {
    this.read = this.write = this.size = 0;
  }
}
export class VoiceActivity {
  constructor(options = {}) {
    this.options = {
      startMs: 60,
      endMs: 450,
      minSpeechMs: 150,
      maxUtteranceMs: 15000,
      threshold: 0.015,
      ...options,
    };
    this.reset();
    this.noise = 0.003;
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
  consume(samples, dt = 20, outputSpeaking = false) {
    let sum = 0;
    for (const v of samples) sum += v * v;
    const rms = Math.sqrt(sum / samples.length);
    const threshold = Math.max(
      this.options.threshold,
      this.noise * 3,
      outputSpeaking ? this.options.threshold * 1.5 : 0,
    );
    const voiced = rms > threshold;
    const events = [];
    if (!this.active) {
      this.pre.push(samples);
      if (this.pre.length > 10) this.pre.shift();
      if (!voiced) this.noise = this.noise * 0.99 + Math.min(rms, 0.02) * 0.01;
      this.startFrames = voiced ? this.startFrames + dt : 0;
      if (this.startFrames >= this.options.startMs) {
        this.active = true;
        this.frames = [...this.pre];
        this.durationMs = this.pre.length * dt;
        this.voiceMs = this.startFrames;
        this.silenceMs = 0;
        events.push({ type: "start" });
      }
    } else {
      this.frames.push(samples);
      this.durationMs += dt;
      if (voiced) {
        this.silenceMs = 0;
        this.voiceMs += dt;
      } else this.silenceMs += dt;
      if (
        this.silenceMs >= this.options.endMs ||
        this.durationMs >= this.options.maxUtteranceMs
      ) {
        const voiceMs = this.voiceMs;
        const frames = this.frames;
        const durationMs = this.durationMs;
        this.reset();
        events.push({
          type: voiceMs >= this.options.minSpeechMs ? "end" : "discard",
          frames,
          durationMs,
        });
      }
    }
    return { rms, voiced, events };
  }
}
export class TextSegments {
  constructor(maxLength = 60, maxTotal = 500) {
    this.buffer = "";
    this.total = 0;
    this.maxLength = maxLength;
    this.maxTotal = maxTotal;
  }
  append(text, final = false) {
    this.total += text.length;
    if (this.total > this.maxTotal)
      throw new Error("Text stream exceeds 500 characters");
    this.buffer += text;
    const parts = [];
    while (this.buffer) {
      let end = this.buffer.search(/[。！？!?\n]/);
      if (end >= 0) end++;
      else if (this.buffer.length >= this.maxLength) end = this.maxLength;
      else if (final) end = this.buffer.length;
      else break;
      const part = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (part) parts.push(part);
    }
    return parts;
  }
}
