import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2]);
const config = JSON.parse(await fs.readFile(process.argv[3], "utf8"));
// This flag is only for a separately launched Chromium fake-audio instance.
const syntheticInput = process.argv.includes("--synthetic-input");
assert.equal(config.silentOutput, true, "Endurance requires silent output");
assert.equal(config.diagnostics, true, "Endurance requires isolated diagnostics runtime");
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const soak = JSON.parse(await fs.readFile(path.join(dir, "soak-summary.local.json"), "utf8"));
assert.equal(endpoint.buildId, soak.buildId);
assert.equal(endpoint.pid, soak.runtimePid);
const deadline = Date.parse(soak.deadline);
const started = new Date().toISOString();
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
const file = path.join(dir, "endurance.local.jsonl");
const summaryFile = path.join(dir, "endurance-summary.local.json");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const motions = ["thinking", "speaking", "thinkEnd", "idle"];
const emotions = ["happy", "puzzled", "sad", "excited", "relaxed", "neutral"];
let cycles = 0, speeches = 0, cancels = 0, failures = 0, minimumFps = Infinity, asrRequests = 0;
async function request(route, body) {
  const r = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET", headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(r.ok, `${route}: ${r.status}`);
  return r.json();
}
async function waitFor(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error("Endurance operation timeout");
}
async function save(status) {
  await fs.writeFile(summaryFile, JSON.stringify({ status, monitorPid: process.pid,
    runtimePid: endpoint.pid, buildId: endpoint.buildId, started,
    deadline: new Date(deadline).toISOString(), cycles, speeches, cancels, failures,
    minimumFps: Number.isFinite(minimumFps) ? minimumFps : null,
    silentOutput: true, realMicrophone: false,
    syntheticInput, asrRequests,
  }, null, 2));
}
await save("running");
while (Date.now() < deadline) {
  try {
    const health = await request("/health");
    assert.equal(health.buildId, endpoint.buildId);
    assert.ok(health.ready && health.asr && health.tts);
    assert.ok(health.avatarReady);
    assert.equal(health.metrics.renderErrors, 0);
    assert.equal(health.metrics.underruns, 0);
    if (syntheticInput) assert.ok(health.micActive && health.metrics.tracks === 1);
    await request("/v1/avatar", { motion: motions[cycles % motions.length], emotion: emotions[cycles % emotions.length] });
    await sleep(2500);
    const active = await request("/v1/diagnostics/avatar");
    assert.equal(active.renderErrors, 0);
    assert.ok(active.motionQueue <= 1 && active.expressionQueue <= 4);
    minimumFps = Math.min(minimumFps, active.fps);
    await request("/v1/avatar", { emotion: "neutral", motion: "idle" });
    await sleep(1200);
    const rest = await request("/v1/diagnostics/avatar");
    assert.ok(rest.expressionDefault && rest.motionQueue === 1 && rest.expressionQueue <= 1);
    assert.equal(rest.parameters.ParamMouthOpenY, 0);
    // Fixed diagnostic speech every 15 cycles, never a proactive conversation policy.
    if (cycles % 15 === 0) {
      // Keep fixed playback independent of the next synthetic utterance.
      if (syntheticInput) {
        await request("/v1/listening", { enabled: false });
        await waitFor(async () => (await request("/health")).metrics.tracks === 0);
      }
      try {
      const requestAt = new Date().toISOString();
      const { generation } = await request("/v1/speech", {
        text: "这是一句固定的静音稳定性验证语音。", emotion: "happy",
      });
      await waitFor(async () => {
        const rows = (await fs.readFile(path.join(dir, "metrics.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
        return rows.some(row => row.at >= requestAt && row.type === "playback.sound" && row.generation === generation);
      });
      speeches++;
      if (speeches % 2) { await request("/v1/cancel", {}); cancels++; }
      await waitFor(async () => {
        const current = await request("/v1/diagnostics/avatar");
        return !["thinking", "speaking"].includes(current.state) && current.motion === "idle" && current.parameters.ParamMouthOpenY === 0;
      });
      } finally {
        if (syntheticInput) await request("/v1/listening", { enabled: true });
      }
    }
    if (syntheticInput) {
      const metrics = (await fs.readFile(path.join(dir, "metrics.jsonl"), "utf8"))
        .trim().split("\n").map(JSON.parse);
      asrRequests = metrics.filter(row => row.at >= started && row.type === "asr.complete").length;
    }
    cycles++;
    await fs.appendFile(file, JSON.stringify({ at: new Date().toISOString(), cycle: cycles,
      fps: rest.fps, motionQueue: rest.motionQueue, expressionQueue: rest.expressionQueue,
      mouth: rest.parameters.ParamMouthOpenY, renderErrors: rest.renderErrors,
      speechCount: speeches, cancelCount: cancels, buildId: endpoint.buildId }) + "\n");
  } catch (error) {
    failures++;
    await fs.appendFile(file, JSON.stringify({ at: new Date().toISOString(), failure: error.name }) + "\n");
  }
  await save("running");
  await sleep(Math.max(0, Math.min(60000, deadline - Date.now())));
}
await save(failures ? "finished-with-failures" : "finished");
console.log(JSON.stringify({ enduranceComplete: true, cycles, speeches, cancels, failures }));
