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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(80);
  }
  throw new Error("Synthetic barge evidence timeout");
}
await wait(async () => {
  const health = await request("/health");
  return health.ready && health.avatarReady && health.asr && health.tts;
}, 90000);
const streamAbort = new AbortController();
const stream = await fetch(endpoint.url + "/v1/events", { headers, signal: streamAbort.signal });
assert.ok(stream.ok);
const messages = [];
const reader = (async () => {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of stream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split("\n").find(line => line.startsWith("data: "));
        if (!data) continue;
        const event = JSON.parse(data.slice(6));
        // Retain event shape/counts, never fixture transcript text.
        messages.push({ at: Date.now(), type: event.type, generation: event.generation,
          reason: event.reason, characters: event.type === "transcript" ? event.text?.length || 0 : undefined });
      }
    }
  } catch (error) { if (!streamAbort.signal.aborted) throw error; }
})();
const started = new Date().toISOString();
async function events() {
  return (await fs.readFile(path.join(dir, "metrics.jsonl"), "utf8"))
    .trim().split("\n").map(JSON.parse).filter(row => row.at >= started);
}
try {
  const initial = await request("/health");
  assert.equal(initial.micActive, false, "Use a fresh autoListen=false fake-device instance");
  const old = await request("/v1/speech", { emotion: "happy",
    text: "这是一段固定的静音测试声音，用来验证合成输入在播放过程中是否能够触发打断。打断以后旧声音应该停止，模型闭嘴，随后可以正常播放新的一句话。" });
  await wait(async () => (await events()).find(row => row.type === "playback.sound" && row.generation === old.generation));
  const listenStarted = Date.now();
  await request("/v1/listening", { enabled: true });
  const interrupted = await wait(() => messages.find(event => event.type === "interrupted" &&
    event.reason === "renderer" && event.at >= listenStarted));
  const transcript = await wait(() => messages.find(event => event.type === "transcript" && event.at > interrupted.at && event.characters > 0));
  const stopped = await wait(async () => {
    const health = await request("/health");
    return health.metrics.bufferMs === 0 && health.generation > old.generation && health;
  });
  const body = await request("/v1/diagnostics/avatar");
  assert.equal(body.parameters.ParamMouthOpenY, 0);
  assert.equal(body.motion, "idle");
  const rows = await events();
  const interrupt = rows.find(row => row.type === "playback.interrupted" && row.generation > old.generation);
  assert.ok(interrupt);
  assert.ok(!messages.some(event => event.type === "speech.completed" && event.generation === old.generation));
  assert.equal(stopped.metrics.underruns, initial.metrics.underruns);
  const next = await request("/v1/speech", { text: "听到了。" });
  await wait(() => messages.find(event => event.type === "speech.completed" && event.generation === next.generation));
  await wait(async () => {
    const health = await request("/health");
    return health.generation === next.generation && health.metrics.bufferMs === 0 &&
      ["idle", "listening"].includes(health.metrics.state);
  });
  await request("/v1/listening", { enabled: false });
  const report = { buildId: endpoint.buildId, completed: new Date().toISOString(),
    syntheticInput: true, realMicrophone: false, physicalSoundVerified: false,
    beforeAsrCompletion: interrupted.at < transcript.at,
    microphoneEnableToCancelMs: interrupted.at - listenStarted,
    playbackCancelAckMs: interrupt.interruptMs,
    transcriptAfterCancelMs: transcript.at - interrupted.at,
    transcriptCharacters: transcript.characters,
    originalGeneration: old.generation, cancelledGeneration: stopped.generation,
    staleCompletion: false, mouthClosed: true, idleRestored: true, replacementCompleted: true,
    underruns: stopped.metrics.underruns,
    timingLimit: "Microphone-enable includes fixture leading silence; no physical voice-onset timing claim",
  };
  await fs.writeFile(path.join(dir, "synthetic-barge-verification.local.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await request("/v1/listening", { enabled: false }).catch(() => {});
  streamAbort.abort(); await reader;
}
