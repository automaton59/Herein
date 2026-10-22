import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2]);
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
async function call(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const diagnostic = () => call("/v1/diagnostics/avatar");
async function wait(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(80);
  }
  throw new Error("Body during speech evidence timeout");
}
await wait(async () => { const h = await call("/health"); return h.ready && h.avatarReady && h.tts; }, 90000);
const before = await call("/health");
assert.equal(before.micActive, false, "Use an isolated static-input instance");
const speech = await call("/v1/speech", { emotion: "happy", text:
  "这是一段固定的静音表演测试内容。播放期间，形象被点按或者拖动时，会先做一次反应，然后继续跟随当前的说话状态。口型应该继续跟随声音，取消后立即恢复待机。这个测试只检查运行时的动作和表情衔接，不会播放到真实扬声器，也不会使用真人麦克风。我们还会连续触发多个反应，确保最后一个动作结束后没有积压。" });
await wait(async () => { const v = await diagnostic(); return v.state === "speaking" && v.motion === "speaking" && v.parameters.ParamMouthOpenY > 0.02 && v; });
const reactions = [];
const samples = [];
async function sample() {
  const value = await diagnostic();
  assert.equal(value.renderErrors, 0);
  assert.ok(value.motionQueue <= 1 && value.expressionQueue <= 4);
  samples.push({ state: value.state, motion: value.motion, mouth: value.parameters.ParamMouthOpenY,
    motionQueue: value.motionQueue, expressionQueue: value.expressionQueue, fps: value.fps });
  return value;
}
for (const action of ["tap", "drag"]) {
  await call("/v1/diagnostics/avatar", { action });
  await sleep(150);
  const during = await sample();
  assert.equal(during.state, "speaking");
  assert.equal(during.motion, "thinkEnd");
  assert.equal(during.index, 1);
  const restored = await wait(async () => {
    const value = await sample();
    return value.state === "speaking" && value.motion === "speaking" && value.index === 0 && value;
  }, 5000);
  assert.equal(restored.emotion, "happy");
  await sleep(1000);
  assert.equal((await diagnostic()).expressionName, "happy");
  reactions.push({ action, stateDuring: during.state, motionDuring: during.motion,
    motionAfter: restored.motion, emotionAfter: restored.emotion });
}
for (let i = 0; i < 20; i++) {
  await call("/v1/diagnostics/avatar", { action: i % 2 ? "drag" : "tap" });
  await sleep(30);
  await sample();
}
await wait(async () => { const v = await sample(); return v.state === "speaking" && v.motion === "speaking" && v; }, 5000);
await call("/v1/diagnostics/avatar", { action: "drag" });
await sleep(100);
await call("/v1/cancel", {});
const cancelled = await wait(async () => {
  const v = await diagnostic();
  return v.motion === "idle" && v.parameters.ParamMouthOpenY < 0.0001 && v.expressionDefault && v;
}, 5000);
await sleep(2200);
assert.equal((await diagnostic()).motion, "idle", "Old one-shot finish must not resurrect speaking");
await call("/v1/avatar", { emotion: "excited" });
await wait(async () => (await diagnostic()).parameters.ParamMouthOpenY > 0.8);
await call("/v1/avatar", { emotion: "neutral" });
const health = await call("/health");
assert.equal(health.metrics.underruns, before.metrics.underruns);
const report = { buildId: endpoint.buildId, completed: new Date().toISOString(),
  simulatedInteractions: true, realPointerInteraction: false, physicalSoundVerified: false,
  generation: speech.generation, reactions, rapidReactions: 20, cancelDuringOneShot: true,
  noLateMotionResurrection: true, laterExpressionWorks: true,
  mouthRange: { min: Math.min(...samples.map(row => row.mouth)), max: Math.max(...samples.map(row => row.mouth)) },
  minimumFps: Math.min(...samples.map(row => row.fps)),
  peakExpressionQueue: Math.max(...samples.map(row => row.expressionQueue)),
  restingMouth: cancelled.parameters.ParamMouthOpenY, renderErrors: health.metrics.renderErrors,
  underruns: health.metrics.underruns, samples,
};
await fs.writeFile(path.join(dir, "body-during-speech-verification.local.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ bodyDuringSpeechVerified: true, reactions: reactions.length,
  rapidReactions: 20, cancelDuringOneShot: true, minimumFps: report.minimumFps, mouthRange: report.mouthRange }));
