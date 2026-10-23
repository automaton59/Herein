import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2]);
const config = JSON.parse(await fs.readFile(process.argv[3], "utf8"));
assert.equal(config.autoListen, false, "Use an isolated non-listening instance");
assert.equal(config.silentOutput, true, "Use silent output");
assert.equal(config.diagnostics, true, "Use isolated diagnostics");
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET", headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}
async function wait(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(150);
  }
  throw new Error("Loop evidence timeout");
}
const diagnostic = () => call("/v1/diagnostics/avatar");
await wait(async () => { const h = await call("/health"); return h.ready && h.avatarReady && h.tts; }, 90000);
const before = await call("/health");
assert.equal(before.buildId, endpoint.buildId);
assert.equal(before.micActive, false);
assert.equal(before.metrics.tracks || 0, 0);
assert.equal((await diagnostic()).cubism, 4, "This verifier checks the provisional dsh model");
const report = { status: "running", buildId: endpoint.buildId,
  started: new Date().toISOString(), actualDesktopVerified: false,
  realPointerVerified: false, physicalAudioVerified: false,
  cases: [], simulatedHideShow: false, oneShotRestored: false };
const output = path.join(dir, "avatar-loop-verification.local.json");
const save = () => fs.writeFile(output, JSON.stringify(report, null, 2));
await save();
try {
  for (const [emotion, expressionName, motion] of [
    ["happy", "happy", "idle"], ["excited", "happy2", "idle"],
    ["puzzled", "puzzled", "thinking"], ["sad", "unhappy", "idle"],
  ]) {
    await call("/v1/avatar", { emotion, motion });
    await sleep(1200);
    const samples = [], started = performance.now();
    // Each loop is 12.717 seconds in this model. Sample beyond two boundaries.
    while (performance.now() - started < 28500) {
      const v = await diagnostic();
      assert.equal(v.renderErrors, 0);
      assert.equal(v.emotion, emotion);
      assert.equal(v.expressionName, expressionName);
      assert.equal(v.motion, motion);
      assert.equal(v.group, motion === "thinking" ? "Anima" : "Idle");
      assert.equal(v.index, motion === "thinking" ? 2 : 0);
      assert.ok(v.motionQueue <= 1 && v.expressionQueue <= 4);
      if (emotion === "happy") assert.ok(v.parameters.ParamEyeLSmile > 0.8);
      if (emotion === "excited") assert.ok(v.parameters.ParamMouthOpenY > 0.8);
      if (emotion === "sad") assert.ok(v.parameters.ParamAngleY < -20);
      samples.push({ elapsedMs: performance.now() - started, fps: v.fps,
        mouth: v.parameters.ParamMouthOpenY, eyeSmile: v.parameters.ParamEyeLSmile,
        angleY: v.parameters.ParamAngleY,
        motionQueue: v.motionQueue, expressionQueue: v.expressionQueue });
      await sleep(250);
    }
    const capture = await call("/v1/diagnostics/capture", {});
    assert.equal(capture.captured, true);
    const filename = `loop-${emotion}.png`;
    await fs.copyFile(path.join(dir, "runtime-capture.png"), path.join(dir, filename));
    const row = { emotion, motion, expressionName, durationMs: performance.now() - started,
      minimumFps: Math.min(...samples.map(s => s.fps)), samples, capture: filename };
    report.cases.push(row);
    await save();
    console.log(JSON.stringify({ loopCase: emotion, samples: samples.length,
      durationMs: row.durationMs, minimumFps: row.minimumFps }));
  }
  await call("/v1/avatar", { emotion: "happy", motion: "thinkEnd" });
  await sleep(250);
  assert.equal((await diagnostic()).motion, "thinkEnd");
  await wait(async () => (await diagnostic()).motion === "idle");
  await sleep(2200);
  const restored = await diagnostic();
  assert.equal(restored.motion, "idle");
  assert.equal(restored.expressionName, "happy");
  report.oneShotRestored = true;

  await call("/v1/diagnostics/lifecycle", { action: "hide" });
  const hidden = await wait(async () => {
    const h = await call("/health");
    return h.window.visible === false && h.metrics.fps < 15 && h;
  });
  await sleep(13000);
  const hiddenAvatar = await diagnostic();
  assert.equal(hiddenAvatar.motion, "idle");
  assert.equal(hiddenAvatar.expressionName, "happy");
  assert.equal(hiddenAvatar.renderErrors, 0);
  await call("/v1/diagnostics/lifecycle", { action: "show" });
  const shown = await wait(async () => {
    const h = await call("/health");
    return h.window.visible === true && h.metrics.fps > 25 && h;
  });
  assert.equal((await diagnostic()).expressionName, "happy");
  report.simulatedHideShow = true;
  report.hiddenFps = hidden.metrics.fps;
  report.shownFps = shown.metrics.fps;
  await call("/v1/avatar", { emotion: "neutral", motion: "idle" });
  await wait(async () => {
    const v = await diagnostic();
    return v.expressionDefault && v.parameters.ParamMouthOpenY === 0 && v;
  });
  const after = await call("/health");
  assert.equal(after.micActive, false);
  assert.equal(after.metrics.tracks, 0);
  assert.equal(after.metrics.renderErrors, 0);
  assert.equal(after.metrics.underruns || 0, 0);
  assert.deepEqual(after.processes.map(p => p.pid).sort(), before.processes.map(p => p.pid).sort());
  report.status = "passed";
  report.completed = new Date().toISOString();
  report.processesUnchanged = true;
  await save();
  console.log(JSON.stringify({ avatarLoopsVerified: true, cases: report.cases.length,
    oneShotRestored: true, hiddenFps: report.hiddenFps, shownFps: report.shownFps }));
} catch (error) {
  report.status = "failed";
  report.failureCategory = error.name;
  report.completed = new Date().toISOString();
  await save();
  throw error;
}
