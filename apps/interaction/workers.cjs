const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const crypto = require("node:crypto");
class JsonWorker extends EventEmitter {
  constructor(python, args, env = {}) {
    super();
    this.ready = false;
    this.closed = false;
    this.pending = new Map();
    this.started = Date.now();
    this.child = spawn(python, args, {
      windowsHide: true,
      env: { ...process.env, ...env, PYTHONIOENCODING: "utf-8" },
    });
    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) {
        this.close();
        return;
      }
      for (let idx; (idx = buffer.indexOf("\n")) >= 0;) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const event = JSON.parse(line);
          if (event.ready) {
            this.ready = true;
            this.emit("ready", event);
          } else {
            this.emit("message", event);
            const p = this.pending.get(event.id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(event.id);
              event.error ? p.reject(new Error(event.error)) : p.resolve(event);
            }
          }
        } catch {
          /* library startup messages are not protocol frames */
        }
      }
    });
    this.child.stderr.on("data", () => {}); // third-party logs may contain request text; do not persist them.
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) =>
      this.fail(new Error(`worker exited (${code})`)),
    );
    this.loadTimer = setTimeout(() => {
      if (!this.ready) {
        this.fail(new Error("worker startup timeout"));
        this.close();
      }
    }, 90000);
    this.on("ready", () => clearTimeout(this.loadTimer));
  }
  fail(error) {
    this.ready = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("failure", error);
  }
  send(value) {
    if (this.closed || !this.child.stdin.writable)
      throw new Error("worker unavailable");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  request(value, timeoutMs = 15000) {
    if (!this.ready) return Promise.reject(new Error("ASR warming up"));
    if (this.pending.size) return Promise.reject(new Error("ASR busy"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("ASR timeout"));
        this.close();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ ...value, id });
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.loadTimer);
    if (process.platform === "win32" && this.child.exitCode === null)
      spawn("taskkill.exe", ["/PID", String(this.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else this.child.kill();
    this.fail(new Error("worker closed"));
  }
}
class VoiceWorkers extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.sequence = 0;
    this.tts = null;
    this.qwenBusy = false;
    this.sapiBusy = false;
    this.startAsr();
    if (config.tts.provider.startsWith("qwen")) this.startQwen();
    else this.startSapi();
  }
  startSapi() {
    this.sapi = new JsonWorker("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(__dirname, "sapi-worker.ps1"),
      "-Voice",
      this.config.tts.voice || "Microsoft Huihui Desktop",
    ]);
    this.sapi.on("failure", () =>
      this.emit("capability", { tts: "unavailable" }),
    );
    this.sapi.on("ready", () =>
      this.emit("capability", { tts: "ready", provider: "sapi" }),
    );
  }
  startAsr() {
    const c = this.config.asr;
    this.asr = new JsonWorker(
      c.python,
      [
        path.join(__dirname, "asr-worker.py"),
        "--model",
        c.model,
        "--device",
        c.device ?? "cpu",
      ],
      { PATH: (c.cudaBin ? c.cudaBin + ";" : "") + process.env.PATH },
    );
    this.asr.on("ready", (event) =>
      this.emit("capability", { asr: "ready", ...event }),
    );
    this.asr.on("failure", () =>
      this.emit("capability", { asr: "unavailable" }),
    );
  }
  startQwen() {
    const c = this.config.tts;
    const args = [
      path.join(
        __dirname,
        c.provider === "qwen-gguf" ? "gguf-worker.py" : "qwen-worker.py",
      ),
      "--model",
      c.qwenModel,
    ];
    if (c.provider === "qwen-gguf")
      args.push(
        "--source",
        c.ggufSource,
        "--dependencies",
        c.ggufDependencies || "",
        "--provider",
        c.ggufDecoder || "DML",
        "--cuda-bin",
        c.cudaBin || "",
      );
    this.qwen = new JsonWorker(c.qwenPython, args);
    this.qwen.on("ready", (event) =>
      this.emit("capability", { tts: "ready", ...event }),
    );
    this.qwen.on("failure", () => {
      this.qwenBusy = false;
      this.emit("capability", { tts: "unavailable" });
    });
  }
  async transcribe(pcm) {
    if (pcm.byteLength > 480000)
      throw new Error("Utterance exceeds 15 seconds");
    return this.asr.request({ pcm: Buffer.from(pcm).toString("base64") });
  }
  async speak(command, generation, onPcm) {
    this.cancel();
    const sequence = this.sequence;
    const start = performance.now();
    let first = true,
      bytes = 0,
      voiceFailed = false;
    const emit = async (pcm) => {
      for (let offset = 0; offset < pcm.length; offset += 4800) {
        if (sequence !== this.sequence || voiceFailed) return;
        const part = pcm.subarray(offset, offset + 4800);
        bytes += part.length;
        await onPcm(part, {
          generation,
          first,
          provider: this.config.tts.provider,
          firstMs: performance.now() - start,
        });
        first = false;
      }
    };
    if (this.config.tts.provider.startsWith("qwen")) {
      if (this.qwenTask) await this.qwenTask.catch(() => {});
      if (sequence !== this.sequence) return { cancelled: true };
      if (!this.qwen?.ready || this.qwenBusy)
        throw new Error("Qwen not ready or cancelling");
      this.qwenBusy = true;
      const worker = this.qwen;
      const id = crypto.randomUUID();
      try {
        const task = new Promise((resolve, reject) => {
          let serial = Promise.resolve();
          // Long accepted texts can take over 90 seconds to play. Bound stalls,
          // including a stuck downstream ACK, without truncating steady progress.
          let timer, settled = false;
          const progress = () => {
            if (settled) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              finish(new Error("Qwen progress timeout"));
            }, 90000);
          };
          const finish = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) { voiceFailed = true; reject(error); worker.close(); }
            else resolve();
          };
          const message = (event) => {
            if (event.id !== id || settled) return;
            progress();
            if (event.pcm) {
              const pcm = Buffer.from(event.pcm, "base64");
              worker.child.stdout.pause();
              serial = serial
                .then(async () => {
                  if (settled) return;
                  await emit(pcm);
                  progress();
                })
                .finally(() => worker.child.stdout.resume());
              void serial.catch(finish);
            }
            if (event.done) {
              serial.then(
                () => {
                  finish(event.error ? new Error(event.error) : undefined);
                },
                (error) => {
                  finish(error);
                },
              );
            }
          };
          const failure = () => {
            finish(new Error("Qwen worker unavailable"));
          };
          const cleanup = () => {
            clearTimeout(timer);
            worker.off("message", message);
            worker.off("failure", failure);
          };
          worker.on("message", message);
          worker.on("failure", failure);
          progress();
          try { worker.send({ ...command, id }); }
          catch (error) { finish(error); }
        });
        this.qwenTask = task;
        await task;
      } finally {
        this.qwenBusy = false;
        this.qwenTask = null;
      }
    } else {
      if (!this.sapi || this.sapi.closed) this.startSapi();
      const worker = this.sapi;
      if (!worker.ready)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("SAPI startup timeout"));
          }, 15000);
          const ok = () => {
            cleanup();
            resolve();
          };
          const fail = (error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            clearTimeout(timer);
            worker.off("ready", ok);
            worker.off("failure", fail);
          };
          worker.on("ready", ok);
          worker.on("failure", fail);
        });
      if (sequence !== this.sequence) return { cancelled: true };
      this.sapiBusy = true;
      const id = crypto.randomUUID();
      try {
        await new Promise((resolve, reject) => {
          let serial = Promise.resolve();
          let timer, settled = false;
          // Pace by downstream PCM acknowledgements without imposing a total
          // duration cap on accepted long texts. A stalled stream stays bounded.
          const progress = () => {
            if (settled) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              finish(new Error("SAPI progress timeout"));
              worker.close();
            }, 90000);
          };
          const finish = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) { voiceFailed = true; reject(error); worker.close(); }
            else resolve();
          };
          const message = (event) => {
            if (event.id !== id || settled) return;
            progress();
            if (event.pcm) {
              worker.child.stdout.pause();
              serial = serial
                .then(async () => {
                  if (settled) return;
                  await emit(Buffer.from(event.pcm, "base64"));
                  progress();
                })
                .finally(() => worker.child.stdout.resume());
              // Observe a failed ACK even if no done frame arrives afterwards.
              void serial.catch(finish);
            }
            if (event.done)
              serial.then(
                () => finish(event.error ? new Error(event.error) : undefined),
                finish,
              );
          };
          const failure = error => finish(sequence !== this.sequence ? undefined : error);
          const cleanup = () => {
            clearTimeout(timer);
            worker.off("message", message);
            worker.off("failure", failure);
          };
          worker.on("message", message);
          worker.on("failure", failure);
          progress();
          try { worker.send({ ...command, id }); }
          catch (error) { finish(error); }
        });
      } finally {
        if (this.sapi === worker) this.sapiBusy = false;
      }
    }
    return {
      elapsedMs: performance.now() - start,
      audioSeconds: bytes / 48000,
      rtf: (performance.now() - start) / 1000 / (bytes / 48000 || 1),
    };
  }
  cancel() {
    this.sequence++;
    this.tts?.kill();
    this.tts = null;
    if (this.sapiBusy) {
      this.sapi?.close();
      this.sapiBusy = false;
    }
    if (this.qwenBusy) this.qwen?.send({ cancel: true });
  }
  recover() {
    if (!this.asr.ready) {
      this.asr.close();
      this.startAsr();
    }
    if (this.config.tts.provider.startsWith("qwen") && !this.qwen?.ready) {
      this.qwen?.close();
      this.startQwen();
    }
    if (this.config.tts.provider === "sapi" && !this.sapi?.ready) {
      this.sapi?.close();
      this.startSapi();
    }
  }
  close() {
    this.cancel();
    this.asr?.close();
    this.qwen?.close();
    this.sapi?.close();
  }
}
module.exports = { VoiceWorkers };
