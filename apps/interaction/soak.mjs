import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
const dataDir = path.resolve(process.argv[2] || "tmp/interaction-data");
const hours = Number(process.argv[3] || 8);
if (!Number.isFinite(hours) || hours <= 0)
  throw new Error("hours must be positive");
const endpoint = JSON.parse(
  await fs.readFile(path.join(dataDir, "endpoint.local.json"), "utf8"),
);
const start = Date.now(),
  deadline = start + hours * 3600000;
const file = path.join(dataDir, "soak.local.jsonl");
const summary = path.join(dataDir, "soak-summary.local.json");
let samples = 0,
  failures = 0,
  peakHost = 0,
  minimumFps = Infinity,
  firstHost = 0,
  lastHost = 0;
const processMemory = new Map();
async function workerMemory(pids) {
  const safe = pids.filter((pid) => Number.isInteger(pid) && pid > 0);
  if (!safe.length) return [];
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$workerIds=@(${safe.join(",")}); $workerTree=Get-CimInstance Win32_Process; do { $workerAdded=@($workerTree | Where-Object { $_.ParentProcessId -in $workerIds -and $_.ProcessId -notin $workerIds } | ForEach-Object { [int]$_.ProcessId }); $workerIds+= $workerAdded } while ($workerAdded.Count); Get-Process -Id $workerIds -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ pid=$_.Id; workingSetMiB=$_.WorkingSet64/1MB; privateMiB=$_.PrivateMemorySize64/1MB } } | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    let output = "";
    child.stdout.on("data", (value) => {
      output += value;
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      try {
        const value = JSON.parse(output);
        resolve(Array.isArray(value) ? value : [value]);
      } catch {
        resolve([]);
      }
    });
    setTimeout(() => {
      child.kill();
      resolve([]);
    }, 3000).unref();
  });
}
async function gpu() {
  return new Promise((resolve) => {
    const child = spawn(
      "nvidia-smi",
      [
        "--query-gpu=memory.used,utilization.gpu",
        "--format=csv,noheader,nounits",
      ],
      { windowsHide: true },
    );
    let result = "";
    child.stdout.on("data", (data) => (result += data));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(result.trim()));
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 3000).unref();
  });
}
async function save(status) {
  await fs.writeFile(
    summary,
    JSON.stringify(
      {
        status,
        monitorPid: process.pid,
        runtimePid: endpoint.pid,
        runtimeStarted: endpoint.started,
        buildId: endpoint.buildId,
        started: new Date(start).toISOString(),
        deadline: new Date(deadline).toISOString(),
        elapsedHours: (Date.now() - start) / 3600000,
        samples,
        failures,
        peakHostMiB: peakHost,
        firstHostMiB: firstHost,
        lastHostMiB: lastHost,
        minimumFps: Number.isFinite(minimumFps) ? minimumFps : null,
        processMemory: [...processMemory.values()],
      },
      null,
      2,
    ),
  );
}
await save("running");
while (Date.now() < deadline) {
  try {
    process.kill(endpoint.pid, 0);
    const response = await fetch(endpoint.url + "/health", {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`health ${response.status}`);
    const value = await response.json();
    const metric = value.metrics;
    if (
      !value.ready ||
      !value.asr ||
      !value.tts ||
      value.avatarReady === false ||
      metric.renderErrors > 0 ||
      value.rendererAgeMs > 15000 ||
      value.buildId !== endpoint.buildId ||
      metric.tracks > 1 ||
      metric.audioContexts > 1
    )
      failures++;
    samples++;
    firstHost ||= metric.rssMiB || 0;
    lastHost = metric.rssMiB || 0;
    peakHost = Math.max(peakHost, lastHost);
    if (metric.fps > 0) minimumFps = Math.min(minimumFps, metric.fps);
    const workers = await workerMemory(
      (value.workers || []).map((worker) => worker.pid),
    );
    for (const item of [...value.processes, ...workers]) {
      const record = processMemory.get(item.pid) || {
        pid: item.pid,
        type: item.type || "voice-worker",
        firstMiB: item.workingSetMiB,
        peakMiB: 0,
        lastMiB: 0,
      };
      record.peakMiB = Math.max(record.peakMiB, item.workingSetMiB);
      record.lastMiB = item.workingSetMiB;
      processMemory.set(item.pid, record);
    }
    await fs.appendFile(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        uptimeSeconds: value.uptimeSeconds,
        ready: value.ready,
        asr: value.asr,
        tts: value.tts,
        micActive: value.micActive,
        generation: value.generation,
        metrics: metric,
        processes: value.processes,
        workers,
        buildId: value.buildId,
        gpu: await gpu(),
      }) + "\n",
    );
  } catch (error) {
    failures++;
    await fs.appendFile(
      file,
      JSON.stringify({ at: new Date().toISOString(), failure: error.name }) +
        "\n",
    );
    if (error.code === "ESRCH") {
      await save("runtime-stopped");
      process.exit(1);
    }
  }
  await save("running");
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(30000, deadline - Date.now())),
  );
}
await save(failures ? "finished-with-failures" : "finished");
console.log(JSON.stringify({ soakComplete: true, hours, samples, failures }));
