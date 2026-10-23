import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { reviewSapiRecovery, reviewRetiredIdentities } from "./recovery-review.mjs";

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
if (process.argv.includes("--live")) {
  assert.equal(process.platform, "win32");
  const safeDir = dir.replaceAll("'", "''");
  const knownPids = [...new Set(report.retiredWorkerTrees.flatMap(tree => tree.identities.map(item => item.pid)))];
  const command = `$auditTree=Get-CimInstance Win32_Process; $auditRoot=$auditTree | Where-Object { $_.ProcessId -eq ${endpoint.pid} }; if (!$auditRoot -or !$auditRoot.CommandLine.ToLower().Contains('${safeDir.toLowerCase()}')) { throw 'Runtime ownership changed' }; $auditKnown=@(${knownPids.join(",")}); [pscustomobject]@{ rootCreated=$auditRoot.CreationDate.ToUniversalTime().ToString('o'); processes=@($auditTree | Where-Object { $_.ProcessId -in $auditKnown } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o');parentPid=$_.ParentProcessId;name=$_.Name} }) } | ConvertTo-Json -Compress -Depth 4`;
  const live = await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    let output = "", settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 1048576) child.kill(); });
    child.stderr.on("data", () => {});
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (code !== 0) return finish(new Error("Live process identity check failed"));
      try { finish(null, JSON.parse(output)); } catch (error) { finish(error); }
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error("Live identity check timeout")); }, 10000);
  });
  assert.ok(Math.abs(Date.parse(live.rootCreated) - Date.parse(endpoint.started)) < 10000,
    "Runtime PID creation differs from original endpoint");
  report.liveRetiredIdentityCheck = { checked: new Date().toISOString(),
    ...reviewRetiredIdentities(report.retiredWorkerTrees, live.processes) };
  if (!report.liveRetiredIdentityCheck.knownRetiredIdentitiesAbsent) {
    report.problems.push("known_retired_worker_identity_still_alive");
    report.evidenceCorrelationComplete = false;
  }
}
await fs.writeFile(path.join(dir, "sapi-recovery-review.local.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ evidenceCorrelationComplete: report.evidenceCorrelationComplete,
  transitions: report.transitions.length, peakWorkerCount: report.peakWorkerCount,
  liveKnownRetiredIdentitiesAbsent: report.liveRetiredIdentityCheck?.knownRetiredIdentitiesAbsent ?? null,
  problems: report.problems, manualReviewRequired: true, eightHourAcceptance: false }));
if (report.problems.length) process.exitCode = 1;
