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
