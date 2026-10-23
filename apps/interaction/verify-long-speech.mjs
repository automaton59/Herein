import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2]);
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
async function request(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET", headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function events() {
  const files = await Promise.all(["metrics.previous.jsonl", "metrics.jsonl"]
    .map(file => fs.readFile(path.join(dir, file), "utf8").catch(() => "")));
  return files.flatMap(file => file.trim().split("\n").filter(Boolean).map(JSON.parse))
    .filter(event => event.at >= endpoint.started);
}
const paragraph = "今天的事情可以慢慢来。先喝一点水，再把窗边的东西收好。我们一件一件做就可以了。等天气晴朗，我们可以去河边看看晚霞，听听树林里的鸟叫。回来以后，泡一杯温水，把桌上的书整理好，再看看明天需要准备的东西。现在不用赶着做完所有的事情，重要的是把眼前这一步走稳。最后一句是蓝色大鱼正在安静地等待明天。";
const longest = (paragraph.repeat(4)).slice(0, 484) + "最后一句是蓝色大鱼正在等待明天。";
assert.equal(longest.length, 500);
let health;
for (let i = 0; i < 90; i++) {
  health = await request("/health");
  if (health.tts && health.avatarReady) break;
  await delay(1000);
}
assert.ok(health.tts && health.avatarReady, "Runtime must finish warming up");
await request("/v1/listening", { enabled: false });
const results = [];
for (const text of [paragraph, longest]) {
  const before = await request("/health");
  const started = Date.now();
  const { generation } = await request("/v1/speech", { text });
  let complete, sound;
  while (Date.now() - started < 240000) {
    await delay(500);
    const rows = await events();
    complete = rows.find(event => event.type === "tts.complete" && event.generation === generation);
    sound = rows.find(event => event.type === "playback.sound" && event.generation === generation);
    health = await request("/health");
    assert.ok(!rows.some(event => event.type === "tts.error" && event.at >= new Date(started).toISOString()), "TTS failed");
    assert.equal(health.tts, true);
    if (sound && complete && health.metrics.bufferMs === 0 && ["idle", "listening"].includes(health.metrics.state)) break;
  }
  assert.ok(complete && sound, "Long speech timed out");
  assert.equal(health.metrics.bufferMs, 0);
  assert.ok(["idle", "listening"].includes(health.metrics.state));
  assert.ok(complete.audioSeconds > (text.length > 400 ? 90 : 24), "Audio still stops at the former 300-frame cap");
  assert.equal(health.metrics.underruns, before.metrics.underruns);
  assert.equal(health.metrics.renderErrors, 0);
  const body = await request("/v1/diagnostics/avatar");
  assert.equal(body.parameters.ParamMouthOpenY, 0);
  assert.equal(body.motion, "idle");
  results.push({ characters: text.length, generation, firstMs: sound.renderFirstMs,
    audioSeconds: complete.audioSeconds, elapsedMs: complete.elapsedMs, rtf: complete.rtf,
    underruns: health.metrics.underruns, recovered: true });
  console.log(JSON.stringify(results.at(-1)));
}
const { generation } = await request("/v1/speech", { text: longest, emotion: "happy" });
const firstDeadline = Date.now() + 15000;
let longStarted = false;
while (Date.now() < firstDeadline) {
  longStarted = (await events()).some(event => event.type === "playback.sound" && event.generation === generation);
  if (longStarted) break;
  await delay(100);
}
assert.ok(longStarted, "Long cancellation fixture did not start");
await delay(2500);
const cancelled = await request("/v1/cancel", {});
await delay(500);
const body = await request("/v1/diagnostics/avatar");
assert.equal(body.parameters.ParamMouthOpenY, 0);
assert.equal(body.motion, "idle");
const replacement = await request("/v1/speech", { text: "听到了。" });
for (let i = 0; i < 150; i++) {
  await delay(100);
  const rows = await events();
  if (rows.some(event => event.type === "tts.complete" && event.generation === replacement.generation)) break;
}
const rows = await events();
assert.ok(rows.some(event => event.type === "tts.complete" && event.generation === replacement.generation));
assert.ok(!rows.some(event => event.type === "tts.complete" && event.generation === generation));
await fs.writeFile(path.join(dir, "long-speech-verification.local.json"), JSON.stringify({
  buildId: endpoint.buildId, completed: new Date().toISOString(), fixedFixtures: true,
  physicalSoundVerified: false, transcriptCompletenessVerified: false,
  results, longCancelAndReplacement: true, cancelledGeneration: cancelled.generation,
}, null, 2));
console.log(JSON.stringify({ longSpeechVerified: true, runs: results.length, longCancelAndReplacement: true }));
