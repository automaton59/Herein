import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
// Pending fix: run against the private candidate without changing the frozen
// runtime source. After applying the patch this can run against workers.cjs.
const source = process.env.HEREIN_INTERACTION_SAPI_CANDIDATE;
if (!source) throw new Error("Set HEREIN_INTERACTION_SAPI_CANDIDATE to the worker under test");
const { VoiceWorkers } = require(path.resolve(source));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function rig() {
  const workers = Object.create(VoiceWorkers.prototype);
  workers.config = { tts: { provider: "sapi" } };
  workers.sequence = 0;
  const worker = new EventEmitter();
  worker.ready = true; worker.closed = false;
  worker.child = { stdout: { pause() {}, resume() {} } };
  let request;
  worker.send = value => { request = value; };
  worker.close = () => {
    if (worker.closed) return;
    worker.closed = true;
    worker.emit("failure", new Error("fixture closed"));
  };
  workers.sapi = worker;
  return { workers, worker, pcm: () => worker.emit("message", {
    id: request.id, pcm: Buffer.alloc(4800).toString("base64") }),
    done: () => worker.emit("message", { id: request.id, done: true }) };
}

test("steady PCM acknowledgements permit speech beyond 30 and 90 seconds total", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig(); let chunks = 0;
  const task = r.workers.speak({ text: "fixture" }, 1, async () => { chunks++; });
  const outcome = task.then(value => ({ value }), error => ({ error }));
  for (let i = 0; i < 4; i++) {
    r.pcm(); await settle();
    t.mock.timers.tick(30001); await settle();
    assert.equal(r.worker.closed, false);
  }
  r.done(); await settle();
  const result = await outcome;
  assert.equal(result.error, undefined);
  assert.equal(chunks, 4);
  assert.equal(result.value.audioSeconds, 0.4);
  assert.equal(r.worker.listenerCount("message"), 0);
  assert.equal(r.worker.listenerCount("failure"), 0);
});

test("90 seconds without progress rejects and removes all stream listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig();
  const task = r.workers.speak({ text: "fixture" }, 1, async () => {});
  const outcome = task.then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(90001); await settle();
  const result = await outcome;
  assert.match(result.error.message, /SAPI progress timeout/);
  assert.equal(r.worker.closed, true);
  assert.equal(r.worker.listenerCount("message"), 0);
  assert.equal(r.worker.listenerCount("failure"), 0);
});

test("cancellation during a pending ACK drops queued PCM and permits replacement", async () => {
  const r = rig(); let release, chunks = 0;
  const task = r.workers.speak({ text: "fixture" }, 1, async () => {
    chunks++;
    await new Promise(resolve => { release = resolve; });
  });
  const outcome = task.then(value => ({ value }), error => ({ error }));
  r.pcm(); r.pcm(); await settle();
  assert.equal(chunks, 1);
  r.workers.cancel(); await settle();
  release(); await settle();
  assert.equal((await outcome).error, undefined);
  assert.equal(chunks, 1);
  assert.equal(r.worker.listenerCount("message"), 0);
  const next = rig(); next.workers.sequence = r.workers.sequence;
  let replacements = 0;
  const replacement = next.workers.speak({ text: "fixture" }, 2, async () => { replacements++; });
  next.pcm(); next.done(); await replacement;
  assert.equal(replacements, 1);
});

test("an ACK failure rejects promptly without waiting for a done frame or timeout", async () => {
  const r = rig(); let chunks = 0;
  const task = r.workers.speak({ text: "fixture" }, 1, async () => {
    chunks++;
    throw new Error("fixture ACK failed");
  });
  const outcome = task.then(value => ({ value }), error => ({ error }));
  r.pcm(); r.pcm(); await settle();
  const result = await outcome;
  assert.match(result.error.message, /ACK failed/);
  assert.equal(chunks, 1);
  assert.equal(r.worker.closed, true);
  assert.equal(r.worker.listenerCount("message"), 0);
});
