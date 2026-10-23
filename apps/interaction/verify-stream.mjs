import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const directory = path.resolve(process.argv[2] || "tmp/interaction-data");
const endpoint = JSON.parse(
  await fs.readFile(path.join(directory, "endpoint.local.json"), "utf8"),
);
const headers = {
  Authorization: `Bearer ${endpoint.token}`,
  "Content-Type": "application/json",
};
const send = async (route, value) => {
  const response = await fetch(endpoint.url + route, {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const start = new Date().toISOString(),
  turnId = "stream-verification";
await send("/v1/text", { op: "begin", turnId });
await send("/v1/text", { op: "delta", turnId, text: "你好。第二句" });
await send("/v1/text", { op: "delta", turnId, text: "已经到达。" });
await send("/v1/text", { op: "end", turnId });
await new Promise((resolve) => setTimeout(resolve, 6000));
const rows = (await fs.readFile(path.join(directory, "metrics.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse)
  .filter((event) => event.at >= start);
assert.equal(rows.filter((event) => event.type === "playback.sound").length, 2);
await send("/v1/text", { op: "begin", turnId: "cancelled-turn" });
await send("/v1/text", {
  op: "delta",
  turnId: "cancelled-turn",
  text: "这一句正在播放。第二句等待播放。第三句等待播放。",
});
await new Promise((resolve) => setTimeout(resolve, 400));
const cancellation = new Date().toISOString();
await send("/v1/cancel", {});
await new Promise((resolve) => setTimeout(resolve, 5000));
const after = (await fs.readFile(path.join(directory, "metrics.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse)
  .filter(
    (event) => event.at >= cancellation && event.type === "playback.sound",
  );
assert.equal(after.length, 0);
await fs.writeFile(
  path.join(directory, "stream-verification.local.json"),
  JSON.stringify(
    { twoClausesPlayed: true, cancelledQueuedClauses: true },
    null,
    2,
  ),
);
console.log("Text clauses and queued cancellation verified");
