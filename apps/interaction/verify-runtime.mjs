import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
const dataDir = path.resolve(process.argv[2] || "tmp/interaction-data");
const endpoint = JSON.parse(
  await fs.readFile(path.join(dataDir, "endpoint.local.json"), "utf8"),
);
const headers = {
  Authorization: `Bearer ${endpoint.token}`,
  "Content-Type": "application/json",
};
async function request(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}
async function events() {
  return (await fs.readFile(path.join(dataDir, "metrics.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.at >= endpoint.started);
}
async function waitFor(check, timeout = 15000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Runtime evidence timeout");
}
const unauthorized = await fetch(endpoint.url + "/health");
assert.equal(unauthorized.status, 401);
const rows = [];
for (const text of [
  "你好。",
  "我在这里。",
  "慢慢说。",
  "今天辛苦了。",
  "听到了。",
  "这个不错。",
  "别急。",
  "休息一下吧。",
  "我陪着你。",
  "晚安。",
]) {
  const started = performance.now();
  const { generation } = await request("/v1/speech", { text });
  const first = await waitFor(async () =>
    (await events()).find(
      (e) => e.type === "playback.sound" && e.generation === generation,
    ),
  );
  const requestToSoundMs = performance.now() - started;
  await waitFor(async () => {
    const health = await request("/health");
    return (
      health.generation === generation &&
      ["idle", "listening"].includes(health.metrics.state) &&
      health.metrics.bufferMs === 0
    );
  }, 20000);
  const complete = (await events()).find(
    (e) => e.type === "tts.complete" && e.generation === generation,
  );
  rows.push({
    generation,
    requestToSoundMs,
    renderFirstMs: first.renderFirstMs,
    ...complete,
  });
  console.log(
    JSON.stringify({
      generation,
      firstMs: first.renderFirstMs,
      rtf: complete?.rtf,
    }),
  );
}
const long = await request("/v1/speech", {
  text: "这是一段用来验证打断的声音，正在播放时应该可以立刻停止，随后旧音频不再继续。",
});
await waitFor(async () =>
  (await events()).find(
    (e) => e.type === "playback.sound" && e.generation === long.generation,
  ),
);
const started = performance.now();
const interrupted = await request("/v1/cancel", {});
const roundTrip = performance.now() - started;
const after = await request("/health");
assert.equal(after.generation, interrupted.generation);
await waitFor(async () => {
  const stopped = await request("/health");
  return (
    ["idle", "listening", "interrupted"].includes(stopped.metrics.state) &&
    stopped.metrics.bufferMs === 0
  );
}, 8000);
const report = {
  runs: rows,
  cancelRoundTripMs: roundTrip,
  cancelGeneration: interrupted.generation,
  unauthorizedStatus: unauthorized.status,
};
await fs.writeFile(
  path.join(dataDir, "verification.local.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    complete: true,
    runs: rows.length,
    cancelGeneration: interrupted.generation,
  }),
);
