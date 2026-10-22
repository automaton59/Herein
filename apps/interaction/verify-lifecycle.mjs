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
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, route);
  return response.json();
}
async function wait(check, timeout = 35000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await call("/health");
    if (check(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Lifecycle evidence timeout");
}
const action = (action) => call("/v1/diagnostics/lifecycle", { action });
await wait((h) => h.ready && h.asr && h.tts);
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
    h.ready && h.rendererAgeMs < 10000 && h.metrics.tracks === 1 && h.micActive,
  45000,
);
const after = await call("/health");
assert.equal(after.buildId, endpoint.buildId);
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
