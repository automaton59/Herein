import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const source = process.env.HEREIN_INTERACTION_FAILURE_CANDIDATE;
if (!source) throw new Error("Set HEREIN_INTERACTION_FAILURE_CANDIDATE to the worker under test");
const { VoiceWorkers } = require(path.resolve(source));
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function rig() {
  const workers = Object.create(VoiceWorkers.prototype);
  workers.config = { tts: { provider: "qwen-gguf" } };
  workers.sequence = 0;
  const worker = new EventEmitter();
  worker.ready = true; worker.closed = false;
  worker.child = { stdout: { pause() {}, resume() {} } };
  let request;
  worker.send = value => { if (!value.cancel) request = value; };
  worker.close = () => {
    if (worker.closed) return;
    worker.closed = true;
    worker.emit("failure", new Error("fixture closed"));
  };
  workers.qwen = worker;
  return { workers, worker,
    pcm: bytes => worker.emit("message", { id: request.id,
      pcm: Buffer.alloc(bytes || 4800).toString("base64") }),
    done: error => worker.emit("message", { id: request.id, done: true, error }) };
}
test("Qwen ACK rejection closes the original worker and stops queued PCM without done", async () => {
  const r = rig(); let chunks = 0;
  const result = r.workers.speak({ text: "fixture" }, 1, async () => {
    chunks++; throw new Error("fixture ACK failure");
  }).then(value => ({ value }), error => ({ error }));
  r.pcm(); r.pcm(); await settle();
  assert.match((await result).error.message, /ACK failure/);
  assert.equal(chunks, 1);
  assert.equal(r.worker.closed, true);
  assert.equal(r.worker.listenerCount("message"), 0);
  assert.equal(r.worker.listenerCount("failure"), 0);
  assert.equal(r.workers.qwenBusy, false);
  assert.equal(r.workers.qwenTask, null);
});
test("steady ACK progress beyond total 90 seconds completes and releases listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(); let chunks = 0;
  const task = r.workers.speak({ text: "fixture" }, 1, async () => { chunks++; });
  for (let i = 0; i < 4; i++) {
    r.pcm(); await settle(); t.mock.timers.tick(30001); await settle();
    assert.equal(r.worker.closed, false);
  }
  r.done(); const result = await task;
  assert.equal(result.audioSeconds, 0.4);
  assert.equal(chunks, 4);
  assert.equal(r.worker.listenerCount("message"), 0);
});
test("90 seconds stalled on an ACK rejects, then a late ACK cannot emit the rest", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(); let release, chunks = 0;
  const result = r.workers.speak({ text: "fixture" }, 1, async () => {
    chunks++; await new Promise(resolve => { release = resolve; });
  }).then(value => ({ value }), error => ({ error }));
  r.pcm(9600); await settle();
  t.mock.timers.tick(90001); await settle();
  assert.match((await result).error.message, /progress timeout/);
  release(); await settle();
  assert.equal(chunks, 1);
  assert.equal(r.worker.closed, true);
  assert.equal(r.worker.listenerCount("message"), 0);
});
test("a stale failure cannot close a replacement worker or leave listeners behind", async () => {
  const r = rig(); let release;
  const task = r.workers.speak({ text: "fixture" }, 1, async () => {
    await new Promise(resolve => { release = resolve; });
    throw new Error("fixture delayed ACK failure");
  }).catch(error => error);
  r.pcm(); await settle();
  const replacement = new EventEmitter();
  replacement.close = () => { throw new Error("Replacement must not be closed"); };
  r.workers.qwen = replacement;
  release(); await settle(); await task;
  assert.equal(r.worker.closed, true);
  assert.equal(r.worker.listenerCount("message"), 0);
});
