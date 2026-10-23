import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2]);
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
async function request(route, body) {
  const response = await fetch(endpoint.url + route, { method: body ? "POST" : "GET", headers,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(100);
  }
  throw new Error("Replacement burst evidence timeout");
}
await wait(async () => { const h = await request("/health"); return h.ready && h.avatarReady && h.asr && h.tts; }, 90000);
const initial = await request("/health");
assert.equal(initial.micActive, false, "Use an isolated autoListen=false instance");
const started = new Date().toISOString();
const rounds = [];
const discarded = new Set();
const expected = new Set();
async function events() {
  return (await fs.readFile(path.join(dir, "metrics.jsonl"), "utf8")).trim().split("\n")
    .map(JSON.parse).filter(row => row.at >= started);
}
for (let round = 0; round < 5; round++) {
  for (let i = 0; i < 10; i++) {
    const old = await request("/v1/speech", { text: "这是会立刻被替换的固定测试声音。", emotion: i % 2 ? "happy" : "puzzled" });
    discarded.add(old.generation);
    await sleep(10);
  }
  const final = await request("/v1/speech", { text: "替换成功。", emotion: "happy" });
  expected.add(final.generation);
  const completed = await wait(async () => {
    const rows = await events();
    const h = await request("/health");
    return h.generation === final.generation &&
      rows.some(row => row.type === "tts.complete" && row.generation === final.generation) &&
      h.metrics.bufferMs === 0 && ["idle", "listening"].includes(h.metrics.state) && rows;
  });
  const sound = completed.find(row => row.type === "playback.sound" && row.generation === final.generation);
  assert.ok(sound);
  assert.ok(!completed.some(row => row.type === "tts.error"));
  assert.ok(!completed.some(row => row.type === "playback.sound" && discarded.has(row.generation)));
  // Drained changes execution state between animation frames. Wait for the
  // actual model frame to apply that state before checking the resting mouth.
  const body = await wait(async () => {
    const value = await request("/v1/diagnostics/avatar");
    return value.motion === "idle" && value.expressionDefault &&
      value.parameters.ParamMouthOpenY < 0.0001 && value;
  }, 4000);
  assert.ok(body.parameters.ParamMouthOpenY < 0.0001);
  assert.equal(body.motion, "idle");
  assert.equal(body.renderErrors, 0);
  rounds.push({ round: round + 1, replacements: 10, lastGeneration: final.generation, firstMs: sound.renderFirstMs });
  console.log(JSON.stringify(rounds.at(-1)));
}
await sleep(1500);
const rows = await events();
const health = await request("/health");
assert.ok(!rows.some(row => row.type === "playback.sound" && !expected.has(row.generation)));
assert.equal(health.metrics.underruns, initial.metrics.underruns);
await fs.writeFile(path.join(dir, "replacement-burst-verification.local.json"), JSON.stringify({
  buildId: endpoint.buildId, completed: new Date().toISOString(),
  commands: 55, immediateReplacements: discarded.size, audibleGenerations: expected.size,
  rounds, staleSounds: 0, underruns: health.metrics.underruns, renderErrors: health.metrics.renderErrors,
  physicalSoundVerified: false, realMicrophone: false,
}, null, 2));
console.log(JSON.stringify({ replacementBurstVerified: true, immediateReplacements: discarded.size, staleSounds: 0 }));
