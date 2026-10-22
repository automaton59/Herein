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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const before = await request("/health");
const samples = [];
const emotions = ["happy", "sad", "puzzled", "excited", "relaxed", "neutral"];
const motions = ["thinking", "speaking", "thinkEnd", "idle"];
for (let i = 0; i < 200; i++) {
  await request("/v1/avatar", { emotion: emotions[i % emotions.length], motion: motions[i % motions.length] });
  await sleep(40);
  if (i % 20 === 0) {
    const sample = await request("/v1/diagnostics/avatar");
    assert.equal(sample.renderErrors, 0);
    assert.ok(sample.motionQueue <= 1);
    assert.ok(sample.expressionQueue <= 4);
    samples.push({ iteration: i, fps: sample.fps, motionQueue: sample.motionQueue, expressionQueue: sample.expressionQueue });
  }
}
await request("/v1/avatar", { emotion: "neutral", motion: "idle" });
await sleep(1600);
const after = await request("/health");
const resting = await request("/v1/diagnostics/avatar");
assert.equal(resting.expressionDefault, true);
assert.ok(resting.expressionQueue <= 1);
assert.equal(resting.motionQueue, 1);
assert.equal(resting.parameters.ParamMouthOpenY, 0);
assert.equal(resting.renderErrors, 0);
assert.equal(before.buildId, after.buildId);
await fs.writeFile(path.join(dir, "avatar-stress-verification.local.json"), JSON.stringify({
  commands: 200, buildId: after.buildId, samples,
  before: before.processes, after: after.processes, resting,
  completed: new Date().toISOString(), longRun: false,
}, null, 2));
console.log(JSON.stringify({ commands: 200, renderErrors: resting.renderErrors,
  fps: resting.fps, finalMotionQueue: resting.motionQueue, finalExpressionQueue: resting.expressionQueue }));
