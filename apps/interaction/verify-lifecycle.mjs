import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const data = path.resolve(process.argv[2] || "tmp/interaction-data");
const endpoint = JSON.parse(
  await fs.readFile(path.join(data, "endpoint.local.json"), "utf8"),
);
const headers = {
  Authorization: `Bearer ${endpoint.token}`,
  "Content-Type": "application/json",
};
async function call(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  }).catch(error => {
    const detail = new Error(`${route} ${body?.action || "poll"}: ${error.message}`, { cause: error });
    detail.name = error.name;
    throw detail;
  });
  assert.equal(response.status, 200, route);
  return response.json();
}
async function wait(check, timeout = 35000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const value = await call("/health");
      if (check(value)) return value;
    } catch (error) {
      // Chromium process metrics can briefly stall while a renderer is dying.
      // Retry only that transient poll timeout, within this recovery deadline.
      if (error.name !== "TimeoutError") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Lifecycle evidence timeout");
}
const action = (action) => call("/v1/diagnostics/lifecycle", { action });
await wait((h) => h.ready && h.avatarReady && h.asr && h.tts);
await Promise.all(
  Array.from({ length: 5 }, () => call("/v1/listening", { enabled: true })),
);
await wait(
  (h) => h.micActive && h.metrics.tracks === 1 && h.metrics.audioContexts === 1,
);
await action("suspend");
await wait((h) => h.metrics.tracks === 0 && h.metrics.state === "paused");
await action("resume");
await wait((h) => h.micActive && h.metrics.tracks === 1);
await action("hide");
await wait((h) => h.window.visible === false && h.metrics.fps < 15);
await action("show");
await wait((h) => h.window.visible === true && h.metrics.fps > 25);
const before = await call("/health");
await action("asr-crash");
await wait((h) => h.asr && h.workers[0].pid !== before.workers[0].pid);
await action("renderer-crash");
await wait(
  (h) =>
    h.ready && h.avatarReady && h.asr && h.tts &&
    Number.isFinite(h.rendererAgeMs) && h.rendererAgeMs < 10000 &&
    h.metrics.tracks === 1 && h.micActive,
  45000,
);
const after = await call("/health");
assert.equal(after.buildId, endpoint.buildId);
let resting;
const diagnosticDeadline = Date.now() + 30000;
while (Date.now() < diagnosticDeadline) {
  try {
    resting = await call("/v1/diagnostics/avatar");
    break;
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
  }
}
assert.ok(resting, "Reloaded renderer diagnostic must recover within 30 seconds");
assert.equal(resting.loaded, true);
assert.equal(resting.renderErrors, 0);
await call("/v1/avatar", { emotion: "happy" });
await new Promise(resolve => setTimeout(resolve, 1200));
const expressive = await call("/v1/diagnostics/avatar");
assert.equal(expressive.emotion, "happy");
assert.equal(expressive.renderErrors, 0);
if (expressive.cubism === 4 && expressive.parameters.ParamEyeLSmile !== undefined)
  assert.ok(expressive.parameters.ParamEyeLSmile > 0.8);
await call("/v1/avatar", { emotion: "neutral" });
await fs.writeFile(
  path.join(data, "lifecycle-verification.local.json"),
  JSON.stringify(
    {
      simulated: true,
      realPowerCycle: false,
      concurrentMicStarts: true,
      hideShow: true,
      asrRestart: true,
      rendererRestart: true,
      avatarReloaded: true,
      expressionAfterReload: true,
      buildId: after.buildId,
      window: after.window,
    },
    null,
    2,
  ),
);
console.log(
  "Simulated lifecycle, concurrent microphone starts, hide/show, ASR and renderer recovery verified",
);
