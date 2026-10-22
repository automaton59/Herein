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
const call = async (route, body) => {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 200);
  return response.json();
};
await call("/v1/listening", { enabled: false });
const started = new Date().toISOString();
await call("/v1/speech", { text: "这是马上会被替换的测试句子。" });
await new Promise((resolve) => setTimeout(resolve, 100));
const next = await call("/v1/speech", { text: "替换成功。" });
const deadline = Date.now() + 15000;
let events = [];
while (Date.now() < deadline) {
  events = (await fs.readFile(path.join(data, "metrics.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((e) => e.at >= started);
  if (
    events.some(
      (e) => e.type === "playback.sound" && e.generation === next.generation,
    ) &&
    events.some(
      (e) => e.type === "tts.complete" && e.generation === next.generation,
    )
  )
    break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(
  events.some(
    (e) => e.type === "playback.sound" && e.generation === next.generation,
  ),
);
assert.ok(!events.some((e) => e.type === "tts.error"));
assert.ok(
  !events.some(
    (e) => e.type === "playback.sound" && e.generation < next.generation,
  ),
);
await fs.writeFile(
  path.join(data, "replacement-verification.local.json"),
  JSON.stringify(
    {
      cancelDuringGeneration: true,
      replacementPlayed: true,
      generation: next.generation,
      buildId: endpoint.buildId,
    },
    null,
    2,
  ),
);
console.log("Cancelled inference and immediate replacement verified");
