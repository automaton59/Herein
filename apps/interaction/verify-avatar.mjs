import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2] || "tmp/interaction-dsh-v2-data");
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
async function request(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET", headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${route} ${response.status}`);
  return response.json();
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const diagnostic = () => request("/v1/diagnostics/avatar");
async function waitFor(check, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await sleep(80);
  }
  throw new Error("Avatar verification timeout");
}
const rows = [];
await waitFor(async () => (await request("/health")).tts);
assert.equal((await diagnostic()).cubism, 4);
for (const emotion of ["neutral", "happy", "excited", "puzzled", "relaxed", "sad", "neutral", "happy", "neutral"]) {
  await request("/v1/avatar", { emotion, motion: "idle" });
  await sleep(1000);
  const value = await diagnostic();
  assert.equal(value.emotion, emotion);
  assert.equal(value.renderErrors, 0);
  if (emotion === "happy") assert.ok(value.parameters.ParamEyeLSmile > 0.8);
  if (emotion === "excited") assert.ok(value.parameters.ParamMouthOpenY > 0.8);
  if (emotion === "sad") {
    assert.equal(value.expressionName, "unhappy");
    assert.ok(value.parameters.ParamAngleY < -20);
    assert.ok(value.parameters.ParamEyeLOpen < 0.1);
  }
  if (emotion === "neutral") {
    assert.equal(value.expressionDefault, true);
    assert.ok(value.parameters.ParamMouthOpenY < 0.1);
  }
  await request("/v1/diagnostics/capture", {});
  const filename = `avatar-${rows.length}-${emotion}.png`;
  await fs.copyFile(path.join(dir, "runtime-capture.png"), path.join(dir, filename));
  rows.push({ emotion, parameters: value.parameters, fps: value.fps, capture: filename });
}
const motionRows = [];
for (const [motion, group, index] of [["thinking", "Anima", 2], ["speaking", "Anima", 0], ["thinkEnd", "Anima", 1], ["idle", "Idle", 0]]) {
  await request("/v1/avatar", { motion });
  await sleep(250);
  const value = await diagnostic();
  assert.equal(value.group, group);
  assert.equal(value.index, index);
  motionRows.push({ motion, group: value.group, index: value.index });
  if (motion === "thinkEnd") {
    await sleep(2200);
    assert.equal((await diagnostic()).motion, "idle");
  }
}
const interactionRows = [];
for (const action of ["tap", "drag"]) {
  await request("/v1/diagnostics/avatar", { action });
  await sleep(800);
  const during = await diagnostic();
  assert.equal(during.motion, "thinkEnd");
  await sleep(2000);
  const after = await diagnostic();
  assert.equal(after.motion, "idle");
  assert.equal(after.expressionDefault, true);
  assert.ok(after.parameters.ParamMouthOpenY < 0.1, "One-shot must not leave stale mouth animation");
  interactionRows.push({ action, simulated: true, during: during.parameters, after: after.parameters });
}
await request("/v1/diagnostics/avatar", { action: "focus", x: 330, y: 100 });
await sleep(1200);
const gaze = await diagnostic();
assert.ok(Math.abs(gaze.parameters.ParamEyeBallX) > 0.05);
await request("/v1/diagnostics/avatar", { action: "center" });
await sleep(1200);
const centered = await diagnostic();
const bad = await fetch(endpoint.url + "/v1/avatar", { method: "POST", headers, body: JSON.stringify({ motion: "unknown" }) });
assert.equal(bad.status, 400);

// Silent-output configuration verifies body/PCM sequencing without waking the user.
const { generation } = await request("/v1/speech", { text: "这是一段固定的动作验证语音，用来检查说话时的口型，以及打断以后身体是否立即恢复待机。", emotion: "happy" });
const speaking = await waitFor(async () => {
  const value = await diagnostic();
  return value.state === "speaking" && value.parameters.ParamMouthOpenY > 0.05 && value;
});
assert.equal(speaking.index, 0);
assert.equal(speaking.group, "Anima");
await request("/v1/cancel", {});
const cancelled = await waitFor(async () => {
  const value = await diagnostic();
  return value.state !== "speaking" && value.motion === "idle" && value;
});
await sleep(800);
const resting = await diagnostic();
assert.ok(resting.parameters.ParamMouthOpenY < 0.1);
assert.equal(resting.expressionDefault, true);
assert.equal(resting.renderErrors, 0);
await request("/v1/avatar", { emotion: "excited" });
await sleep(1200);
const afterCancelExpression = await diagnostic();
assert.ok(afterCancelExpression.parameters.ParamMouthOpenY > 0.8,
  "A later expression must work while execution state remains interrupted");
await request("/v1/avatar", { emotion: "neutral" });
const report = {
  buildId: endpoint.buildId, completed: new Date().toISOString(),
  technicalVerificationModel: true, realPointerInteraction: false,
  actualDesktopVisibilityVerified: false, physicalSoundVerified: false,
  expressions: rows, motions: motionRows, interactions: interactionRows,
  gaze: { focused: gaze.parameters, centered: centered.parameters },
  speech: { generation, speaking: speaking.parameters, cancelled: cancelled.state, resting: resting.parameters,
    afterCancelExpression: afterCancelExpression.parameters },
};
await fs.writeFile(path.join(dir, "avatar-verification.local.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ avatarVerified: true, expressions: rows.length, motions: motionRows.length,
  simulatedInteractions: interactionRows.length, mouthAndCancel: true, renderErrors: resting.renderErrors, fps: resting.fps }));
