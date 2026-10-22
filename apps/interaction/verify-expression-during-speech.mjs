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
async function wait(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(90);
  }
  throw new Error("Expression during speech evidence timeout");
}
const diagnostic = () => call("/v1/diagnostics/avatar");
await wait(async () => { const h = await call("/health"); return h.ready && h.tts && h.avatarReady; }, 90000);
const before = await call("/health");
assert.equal(before.buildId, endpoint.buildId);
assert.equal(before.micActive, false);
assert.equal(before.metrics.tracks || 0, 0);
assert.equal((await diagnostic()).cubism, 4, "Use the provisional dsh model");
const report = { status: "running", buildId: endpoint.buildId,
  started: new Date().toISOString(), simulatedInteractions: true,
  actualDesktopVerified: false, realPointerVerified: false, physicalAudioVerified: false,
  microphoneUsed: false, cases: [], samples: [] };
const filename = path.join(dir, "expression-during-speech-verification.local.json");
const save = () => fs.writeFile(filename, JSON.stringify(report, null, 2));
await save();
async function sample(phase) {
  const v = await diagnostic();
  assert.equal(v.loaded, true);
  assert.equal(v.renderErrors, 0);
  assert.ok(v.motionQueue <= 1 && v.expressionQueue <= 4);
  report.samples.push({ at: new Date().toISOString(), phase,
    state: v.state, emotion: v.emotion, expressionName: v.expressionName,
    expressionDefault: v.expressionDefault, motion: v.motion,
    mouth: v.parameters.ParamMouthOpenY, eyeSmile: v.parameters.ParamEyeLSmile,
    angleY: v.parameters.ParamAngleY, fps: v.fps,
    motionQueue: v.motionQueue, expressionQueue: v.expressionQueue });
  return v;
}
async function face(emotion, expressionName, state) {
  return wait(async () => {
    const v = await sample(`face-${emotion}`);
    return v.state === state && v.emotion === emotion &&
      (expressionName === null ? v.expressionDefault : v.expressionName === expressionName) && v;
  });
}
const text = "这是一段固定的静音表演测试。表情变化时，嘴部仍应跟随实际播放的声音。点击和拖动只做一次身体反应，结束后恢复原来的表情。取消之后回到待机，旧动作不能再次启动。这些内容不会播放到真实扬声器。";
try {
  for (const [emotion, expressionName] of [
    ["neutral", null], ["happy", "happy"], ["excited", "happy2"],
    ["puzzled", "puzzled"], ["sad", "unhappy"], ["relaxed", "relax"],
  ]) {
    const accepted = await call("/v1/speech", { text });
    await wait(async () => {
      const v = await sample("speech-start");
      return v.state === "speaking" && v.parameters.ParamMouthOpenY > 0.02 && v;
    });
    await call("/v1/avatar", { emotion });
    await face(emotion, expressionName, "speaking");
    // A selected expression starts fading in before its parameters reach target.
    if (emotion === "happy") await wait(async () =>
      (await sample("happy-fade-in")).parameters.ParamEyeLSmile > 0.8);
    if (emotion === "sad") await wait(async () =>
      (await sample("sad-fade-in")).parameters.ParamAngleY < -20);
    await sleep(1100);
    const mouths = [];
    for (let i = 0; i < 20; i++) {
      const v = await sample(`speaking-${emotion}`);
      assert.equal(v.state, "speaking");
      assert.equal(v.emotion, emotion);
      assert.equal(v.motion, "speaking");
      if (expressionName === null) assert.equal(v.expressionDefault, true);
      else assert.equal(v.expressionName, expressionName);
      if (emotion === "happy") assert.ok(v.parameters.ParamEyeLSmile > 0.8);
      if (emotion === "sad") assert.ok(v.parameters.ParamAngleY < -20);
      mouths.push(v.parameters.ParamMouthOpenY);
      await sleep(120);
    }
    const mouthRange = { min: Math.min(...mouths), max: Math.max(...mouths) };
    assert.ok(mouthRange.max - mouthRange.min > 0.01, "PCM mouth must vary during expression");
    if (emotion === "excited") assert.ok(mouthRange.min < 0.8, "PCM overrides the expression's fixed open mouth");

    await call("/v1/diagnostics/avatar", { action: "drag" });
    await wait(async () => (await sample("drag-start")).motion === "thinkEnd");
    await wait(async () => (await sample("drag-end")).motion === "speaking", 5000);
    await face(emotion, expressionName, "speaking");
    await sleep(700);
    await face(emotion, expressionName, "speaking");

    // A new C expression during a transient reaction must survive its finish.
    await call("/v1/diagnostics/avatar", { action: "tap" });
    await wait(async () => (await sample("tap-start")).motion === "thinkEnd");
    await call("/v1/avatar", { emotion: "sad" });
    await wait(async () => (await sample("tap-end")).motion === "speaking", 5000);
    await face("sad", "unhappy", "speaking");
    await wait(async () => (await sample("new-sad-fade-in")).parameters.ParamAngleY < -20);
    await sleep(300);
    assert.ok((await face("sad", "unhappy", "speaking")).parameters.ParamAngleY < -20);

    await call("/v1/diagnostics/avatar", { action: "tap" });
    await wait(async () => (await sample("cancel-reaction")).motion === "thinkEnd");
    await call("/v1/cancel", {});
    await wait(async () => {
      const v = await sample("cancel-rest");
      return v.motion === "idle" && v.expressionDefault && v.parameters.ParamMouthOpenY < 0.0001;
    });
    await call("/v1/avatar", { emotion: "excited" });
    await wait(async () => (await sample("later-excited")).parameters.ParamMouthOpenY > 0.8);
    await sleep(2100);
    const later = await sample("late-finish");
    assert.equal(later.motion, "idle", "Late reaction must not resurrect speech");
    assert.equal(later.expressionName, "happy2");
    assert.ok(later.parameters.ParamMouthOpenY > 0.8);
    await call("/v1/avatar", { emotion: "neutral" });
    await wait(async () => {
      const v = await sample("final-neutral");
      return v.expressionDefault && v.parameters.ParamMouthOpenY < 0.0001;
    });
    report.cases.push({ emotion, expressionName, generation: accepted.generation,
      mouthRange, transientRestored: true, newerExpressionSurvived: true,
      cancellationReset: true, lateFinishDidNotResurrect: true,
      identityOnlyExpression: emotion === "relaxed" });
    await save();
    console.log(JSON.stringify({ expressionDuringSpeech: emotion, mouthRange, passed: true }));
  }
  const after = await call("/health");
  assert.equal(after.buildId, endpoint.buildId);
  assert.equal(after.micActive, false);
  assert.equal(after.metrics.tracks, 0);
  assert.equal(after.metrics.renderErrors, 0);
  assert.equal(after.metrics.underruns, before.metrics.underruns || 0);
  report.status = "passed";
  report.completed = new Date().toISOString();
  report.underruns = after.metrics.underruns;
  report.minimumFps = Math.min(...report.samples.map(s => s.fps));
  report.peakExpressionQueue = Math.max(...report.samples.map(s => s.expressionQueue));
  await save();
  console.log(JSON.stringify({ expressionsDuringSpeechVerified: true, cases: report.cases.length,
    samples: report.samples.length, minimumFps: report.minimumFps,
    peakExpressionQueue: report.peakExpressionQueue, underruns: report.underruns }));
} catch (error) {
  report.status = "failed";
  report.failureCategory = error.name;
  report.completed = new Date().toISOString();
  await call("/v1/cancel", {}).catch(() => {});
  await save();
  throw error;
}
