import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const script = fileURLToPath(new URL("../audit-soak.mjs", import.meta.url));
async function fixture(check) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herein-soak-audit-"));
  const end = Date.now() - 1000, start = end - 8 * 3600000;
  const rows = Array.from({ length: 961 }, (_, i) => ({
    at: new Date(start + i * 30000).toISOString(), uptimeSeconds: 10 + i * 30,
    ready: true, asr: true, tts: true, micActive: true, buildId: "fixture-build",
    metrics: { avatarReady: true, tracks: 1, audioContexts: 1, fps: 58, renderErrors: 0, underruns: 0 },
    processes: ["Browser", "GPU", "Tab"].map((type, j) => ({ pid: j + 1, type, workingSetMiB: 100 })),
    workers: [{ pid: 4, workingSetMiB: 800, privateMiB: 1000 }],
  }));
  const summary = { status: "finished", buildId: "fixture-build", runtimePid: 1,
    started: new Date(start).toISOString(), deadline: new Date(end).toISOString(), samples: rows.length, failures: 0 };
  try {
    await fs.writeFile(path.join(dir, "endpoint.local.json"), JSON.stringify({ pid: 1, buildId: "fixture-build" }));
    await check({ dir, rows, summary });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function run(dir, rows, summary) {
  await fs.writeFile(path.join(dir, "soak-summary.local.json"), JSON.stringify(summary));
  await fs.writeFile(path.join(dir, "soak.local.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
  let code = 0;
  try { await exec(process.execPath, [script, dir, "--require-finished"]); }
  catch (error) { code = error.code; }
  return { code, report: JSON.parse(await fs.readFile(path.join(dir, "soak-audit.local.json"), "utf8")) };
}
test("audit requires eight hours even when a summary says finished", async () => fixture(async ({ dir, rows, summary }) => {
  summary.started = rows.at(-2).at;
  const result = await run(dir, rows.slice(-2), { ...summary, samples: 2 });
  assert.equal(result.code, 1);
  assert.equal(result.report.actualEightHoursFinished, false);
}));
test("audit rejects long gaps and runtime restarts", async () => fixture(async ({ dir, rows, summary }) => {
  rows[500].uptimeSeconds = 1;
  rows.splice(300, 4);
  const result = await run(dir, rows, { ...summary, samples: rows.length });
  assert.equal(result.code, 1);
  assert.ok(result.report.problems.includes("runtime_uptime_reset"));
  assert.ok(result.report.problems.includes("observation_gap_over_75_seconds"));
}));
test("eight-hour samples remain subject to manual memory and physical acceptance", async () => fixture(async ({ dir, rows, summary }) => {
  const { code, report } = await run(dir, rows, summary);
  assert.equal(code, 0);
  assert.equal(report.actualEightHoursFinished, true);
  assert.equal(report.outcome, "eight_hours_sampled_manual_memory_review_required");
  assert.equal(report.realMicrophoneVerified, false);
  assert.equal(report.actualDesktopVerified, false);
}));
test("audit exposes late memory growth without silently calling it leak-free", async () => fixture(async ({ dir, rows, summary }) => {
  rows.forEach((row, i) => { row.workers[0].privateMiB += i; });
  const { report } = await run(dir, rows, summary);
  assert.deepEqual(report.lateGrowthReviewPids, [4]);
  assert.equal(report.memoryAssessment, "review_late_growth");
}));
test("audit rejects changed worker trees and a mismatched runtime PID", async () => fixture(async ({ dir, rows, summary }) => {
  rows[500].workers[0].pid = 5;
  rows[600].processes[0].pid = 99;
  const { code, report } = await run(dir, rows, summary);
  assert.equal(code, 1);
  assert.ok(report.problems.includes("worker_process_tree_changed"));
  assert.ok(report.problems.includes("runtime_pid_missing_from_process_samples"));
}));

test("hourly private and handle trends expose growth even with stable working sets", async () => fixture(async ({ dir, rows, summary }) => {
  const processRows = rows.filter((_, i) => i % 2 === 0).map((row, i) => ({
    at: row.at, processTypes: { 3: "Tab" },
    processes: [{ pid: 3, name: "electron", created: rows[0].at,
      privateMiB: 100 + i, handles: 300 + i, threads: 20 }],
  }));
  await fs.writeFile(path.join(dir, "process-samples.local.jsonl"), processRows.map(JSON.stringify).join("\n") + "\n");
  const { code, report } = await run(dir, rows, summary);
  assert.equal(code, 0);
  assert.equal(report.memoryAssessment, "review_late_growth");
  assert.deepEqual(report.lateGrowthReviewPids, []);
  assert.deepEqual(report.supplementaryGrowthReviewPids, [3]);
  assert.equal(report.supplementaryCoverage.startsWithin45Seconds, true);
  assert.equal(report.supplementaryCoverage.endsWithin90SecondsOfDeadline, true);
  const process = report.supplementaryProcesses[0];
  assert.ok(process.lateHalfPrivateSlopeMiBPerHour > 59);
  assert.ok(process.hourlyWindows[7].privateMiB.median > process.hourlyWindows[1].privateMiB.median);
  assert.equal(report.processMemory[2].hourlyWindows[1].workingSetMiB.median, 100);
}));

test("supplementary sampling gaps cannot silently look continuous", async () => fixture(async ({ dir, rows, summary }) => {
  const processRows = rows.filter((_, i) => i % 2 === 0 && (i < 300 || i > 400))
    .map(row => ({ at: row.at, processes: [{ pid: 3, created: rows[0].at, privateMiB: 100, handles: 300, threads: 20 }] }));
  await fs.writeFile(path.join(dir, "process-samples.local.jsonl"), processRows.map(JSON.stringify).join("\n") + "\n");
  const { code, report } = await run(dir, rows, summary);
  assert.equal(code, 1);
  assert.ok(report.problems.includes("supplementary_observation_gap_over_90_seconds"));
}));

test("hourly timings separate ASR, software sound and unmeasured endpoint latency", async () => fixture(async ({ dir, rows, summary }) => {
  const metrics = [
    { at: rows[100].at, type: "asr.complete", asrMs: 120 },
    { at: rows[101].at, type: "voice.turn", asrMs: 120, vadToAsrMs: 135 },
    { at: rows[102].at, type: "tts.first", firstMs: 600 },
    { at: rows[103].at, type: "playback.sound", renderFirstMs: 800 },
    { at: rows[104].at, type: "playback.sound", renderFirstMs: 1000 },
    { at: rows[240].at, type: "playback.sound", renderFirstMs: 1100, endToSoundMs: 1500 },
  ];
  await fs.writeFile(path.join(dir, "metrics.jsonl"), metrics.map(JSON.stringify).join("\n") + "\n");
  const { report } = await run(dir, rows, summary);
  const first = report.hourlyPerformance.find(hour => hour.hourFromStart === 0);
  const second = report.hourlyPerformance.find(hour => hour.hourFromStart === 2);
  assert.equal(first.asrMs.count, 1, "Renderer copy must not double-count ASR");
  assert.equal(first.ttsFirstMs.median, 600);
  assert.equal(first.softwareFirstSoundMs.count, 2);
  assert.equal(first.softwareFirstSoundMs.p95, 1000);
  assert.equal(first.softwareEndToSoundMs.count, 0);
  assert.equal(first.softwareEndToSoundMs.median, null);
  assert.equal(second.softwareEndToSoundMs.median, 1500);
}));

test("late-half growth remains visible when earlier decline masks the full late slope", async () => fixture(async ({ dir, rows, summary }) => {
  rows.forEach((row, i) => {
    const hours = i / 120;
    row.workers[0].privateMiB = hours < 4.5 ? 1700 - 120 * hours : 1160 + 30 * (hours - 4.5);
  });
  const { report } = await run(dir, rows, summary);
  assert.deepEqual(report.lateGrowthReviewPids, []);
  assert.deepEqual(report.lateHalfGrowthReviewPids, [4]);
  assert.ok(report.processMemory.find(p => p.pid === 4).lateHalfPrivateSlopeMiBPerHour > 29);
  assert.equal(report.memoryAssessment, "review_late_growth");
}));
