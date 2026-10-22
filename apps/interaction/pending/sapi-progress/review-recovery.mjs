import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { reviewSapiRecovery } from "./recovery-review.mjs";

const dir = path.resolve(process.argv[2]);
const config = JSON.parse(await fs.readFile(process.argv[3], "utf8"));
assert.equal(config.tts.provider, "sapi", "This review only understands the SAPI fallback");
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const summary = JSON.parse(await fs.readFile(path.join(dir, "soak-summary.local.json"), "utf8"));
assert.equal(endpoint.pid, summary.runtimePid);
assert.equal(endpoint.buildId, summary.buildId);
async function rows(name, optional = false) {
  const source = await fs.readFile(path.join(dir, name), "utf8").catch(error => {
    if (optional && error.code === "ENOENT") return "";
    throw error;
  });
  const lines = source.split("\n"), result = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { result.push(JSON.parse(lines[i])); }
    catch (error) {
      if (i === lines.length - 1 && !source.endsWith("\n")) continue;
      throw error;
    }
  }
  return result;
}
const [previous, metrics, samples] = await Promise.all([
  rows("metrics.previous.jsonl", true), rows("metrics.jsonl"), rows("process-samples.local.jsonl"),
]);
assert.ok(samples.every(row => row.failure || row.runtimePid === endpoint.pid && row.buildId === endpoint.buildId));
const report = { audited: new Date().toISOString(), buildId: endpoint.buildId,
  ...reviewSapiRecovery(endpoint.pid, summary.started, [...previous, ...metrics], samples) };
await fs.writeFile(path.join(dir, "sapi-recovery-review.local.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ evidenceCorrelationComplete: report.evidenceCorrelationComplete,
  transitions: report.transitions.length, peakWorkerCount: report.peakWorkerCount,
  problems: report.problems, manualReviewRequired: true, eightHourAcceptance: false }));
if (report.problems.length) process.exitCode = 1;
