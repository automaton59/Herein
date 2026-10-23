import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2] || "tmp/interaction-data");
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const soak = JSON.parse(await fs.readFile(path.join(dir, "soak-summary.local.json"), "utf8"));
assert.equal(endpoint.pid, soak.runtimePid);
assert.equal(endpoint.buildId, soak.buildId);
assert.ok(Number.isInteger(endpoint.pid) && endpoint.pid > 0);
const deadline = Date.parse(soak.deadline), started = Date.now();
const file = path.join(dir, "process-samples.local.jsonl");
const summaryFile = path.join(dir, "process-samples-summary.local.json");
assert.ok(deadline > started, "Soak must still be running");
await fs.writeFile(file, "", { flag: "wx" });
let samples = 0, failures = 0;
async function processTree() {
  const safeDir = dir.replaceAll("'", "''");
  const command = `$auditTree=Get-CimInstance Win32_Process; $auditRoot=$auditTree | Where-Object { $_.ProcessId -eq ${endpoint.pid} }; if (!$auditRoot -or !$auditRoot.CommandLine.ToLower().Contains('${safeDir.toLowerCase()}')) { throw 'Runtime ownership changed' }; $auditIds=@(${endpoint.pid}); do { $auditAdded=@($auditTree | Where-Object { $_.ParentProcessId -in $auditIds -and $_.ProcessId -notin $auditIds } | ForEach-Object { [int]$_.ProcessId }); $auditIds+=$auditAdded } while ($auditAdded.Count); Get-Process -Id $auditIds -ErrorAction Stop | ForEach-Object { $auditPid=$_.Id; $auditInfo=$auditTree | Where-Object { $_.ProcessId -eq $auditPid }; [pscustomobject]@{ pid=$auditPid; parentPid=$auditInfo.ParentProcessId; created=$auditInfo.CreationDate.ToUniversalTime().ToString('o'); name=$_.ProcessName; workingSetMiB=$_.WorkingSet64/1MB; privateMiB=$_.PrivateMemorySize64/1MB; handles=$_.HandleCount; threads=$_.Threads.Count; cpuSeconds=$_.CPU } } | ConvertTo-Json -Compress`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    let output = "", settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    child.stdout.on("data", value => { output += value; if (output.length > 1048576) child.kill(); });
    child.stderr.on("data", () => {});
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (code !== 0) return finish(new Error("Process tree inspection failed"));
      try {
        const value = JSON.parse(output); finish(null, Array.isArray(value) ? value : [value]);
      } catch (error) { finish(error); }
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error("Process inspection timeout")); }, 10000);
  });
}
async function save(status) {
  await fs.writeFile(summaryFile, JSON.stringify({ status, monitorPid: process.pid,
    runtimePid: endpoint.pid, buildId: endpoint.buildId,
    started: new Date(started).toISOString(), deadline: new Date(deadline).toISOString(),
    samples, failures, supplementary: true,
    fullSoakCoverage: started <= Date.parse(soak.started) + 45000 }, null, 2));
}
await save("running");
while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint.url + "/health", {
      headers: { Authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(5000),
    });
    assert.ok(response.ok);
    const health = await response.json();
    assert.equal(health.buildId, endpoint.buildId);
    const processes = await processTree();
    await fs.appendFile(file, JSON.stringify({ at: new Date().toISOString(),
      runtimePid: endpoint.pid, buildId: endpoint.buildId, uptimeSeconds: health.uptimeSeconds,
      processTypes: Object.fromEntries(health.processes.map(item => [item.pid, item.type])),
      processes }) + "\n");
    samples++;
  } catch (error) {
    failures++;
    await fs.appendFile(file, JSON.stringify({ at: new Date().toISOString(), failure: error.name }) + "\n");
  }
  await save("running");
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(60000, deadline - Date.now()))));
}
await save(failures ? "finished-with-failures" : "finished");
console.log(JSON.stringify({ processSamplingFinished: true, samples, failures }));
