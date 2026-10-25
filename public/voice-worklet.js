class PcmRing {
  constructor(capacity) {
    this.data = new Float32Array(capacity);
    this.read = 0;
    this.write = 0;
    this.count = 0;
  }
  get size() {
    return this.count;
  }
  clear() {
    this.read = 0;
    this.write = 0;
    this.count = 0;
  }
  push(samples) {
    if (samples.length > this.data.length - this.count) return false;
    for (const sample of samples) {
      this.data[this.write] = sample;
      this.write = (this.write + 1) % this.data.length;
      this.count += 1;
    }
    return true;
  }
  take(target) {
    const count = Math.min(target.length, this.count);
    for (let index = 0; index < count; index += 1) {
      target[index] = this.data[this.read];
      this.read = (this.read + 1) % this.data.length;
      this.count -= 1;
    }
    return count;
  }
}

class OutputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ring = new PcmRing(sampleRate * 4);
    this.generation = 0;
    this.started = false;
    this.first = false;
    this.active = false;
    this.primed = false;
    this.initialBuffer =
      (sampleRate * (options.processorOptions?.initialBufferMs || 160)) / 1000;
    this.underruns = 0;
    this.ticks = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'cancel') {
        this.ring.clear();
        this.generation = data.generation;
        this.started = this.first = this.active = false;
        this.primed = false;
        this.port.postMessage({
          type: 'cancelled',
          generation: this.generation,
          at: currentTime,
        });
      }
      if (data.type === 'pcm' && data.generation === this.generation) {
        if (!this.ring.push(data.samples))
          this.port.postMessage({ type: 'overflow' });
        this.active = true;
      }
      if (data.type === 'end' && data.generation === this.generation)
        this.active = false;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (
      !this.primed &&
      (this.ring.size >= this.initialBuffer || (!this.active && this.ring.size))
    )
      this.primed = true;
    const count = this.primed ? this.ring.take(out) : 0;
    if (!count) out.fill(0);
    let sum = 0,
      peak = 0;
    for (const value of out) {
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    if (count && !this.started) {
      this.started = true;
      this.port.postMessage({
        type: 'first',
        generation: this.generation,
        at: currentTime,
      });
    }
    if (peak > 0.001 && !this.first) {
      this.first = true;
      this.port.postMessage({
        type: 'sound',
        generation: this.generation,
        at: currentTime,
      });
    }
    if (count < out.length && this.active && this.started) this.underruns++;
    if (++this.ticks % 8 === 0)
      this.port.postMessage({
        type: 'level',
        rms: Math.sqrt(sum / out.length),
        bufferMs: (this.ring.size / sampleRate) * 1000,
        underruns: this.underruns,
        generation: this.generation,
      });
    if (!this.active && !this.ring.size && this.started) {
      this.started = false;
      this.primed = false;
      this.port.postMessage({ type: 'drained', generation: this.generation });
    }
    return true;
  }
}

class InputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(320);
    this.index = 0;
    this.phase = 0;
    this.port.onmessage = () => {};
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.frame[this.index++] = sample;
        if (this.index === 320) {
          const frame = this.frame;
          this.port.postMessage({ samples: frame, at: currentTime }, [frame.buffer]);
          this.frame = new Float32Array(320);
          this.index = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('herein-output', OutputProcessor);
registerProcessor('herein-input', InputProcessor);
