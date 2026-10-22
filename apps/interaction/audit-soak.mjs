import fs from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "tmp/interaction-data");
const requireFinished = process.argv.includes("--require-finished");
async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
}
async function readRows(name, optional = false) {
  const source = await fs.readFile(path.join(dir, name), "utf8")
    .catch(error => { if (optional && error.code === "ENOENT") return ""; throw error; });
  const lines = source.split("\n");
  const rows = [];
  let partialLastLine = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { rows.push(JSON.parse(lines[i])); }
    catch (error) {
      if (i === lines.length - 1 && !source.endsWith("\n")) partialLastLine = true;
      else throw error;
    }
  }
  return { rows, partialLastLine };
}
function stats(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  return { min: valid[0], median: valid[Math.floor(valid.length / 2)], max: valid.at(-1) };
}
function timingStats(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return { count: 0, min: null, median: null, p95: null, max: null };
  return { count: valid.length, min: valid[0], median: valid[Math.floor(valid.length / 2)],
    p95: valid[Math.max(0, Math.ceil(valid.length * 0.95) - 1)], max: valid.at(-1) };
}
function slope(points) {
  if (points.length < 3) return null;
  const x = points.map(p => p.hours), y = points.map(p => p.value);
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const variance = x.reduce((sum, value) => sum + (value - mx) ** 2, 0);
  return variance ? y.reduce((sum, value, i) => sum + (x[i] - mx) * (value - my), 0) / variance : null;
}
function hourlyWindows(points, fields) {
  const windows = new Map();
  for (const point of points) {
    const hour = Math.floor(point.hours);
    const window = windows.get(hour) || [];
    window.push(point);
    windows.set(hour, window);
  }
  return [...windows.entries()].sort(([a], [b]) => a - b).map(([hour, window]) => ({
    hourFromStart: hour, observations: window.length,
    sampledSpanMinutes: (window.at(-1).hours - window[0].hours) * 60,
    ...Object.fromEntries(Object.entries(fields).map(([label, key]) =>
      [label, stats(window.map(point => point[key]))])),
  }));
}
function lateHalfSlope(points, field) {
  const late = points.filter(point => point.hours >= 1);
  if (!late.length) return null;
  const midpoint = (late[0].hours + late.at(-1).hours) / 2;
  const tail = late.filter(point => point.hours >= midpoint && Number.isFinite(point[field]));
  return tail.length >= 3 && tail.at(-1).hours - tail[0].hours >= 1
    ? slope(tail.map(point => ({ hours: point.hours, value: point[field] }))) : null;
}
const endpoint = await readJson("endpoint.local.json");
const summary = await readJson("soak-summary.local.json");
const endurance = await readJson("endurance-summary.local.json").catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});
const observations = await readRows("soak.local.jsonl");
const { rows } = observations;
const samples = rows.filter(row => !row.failure);
const failures = rows.filter(row => row.failure);
const metricsFiles = await Promise.all(["metrics.previous.jsonl", "metrics.jsonl"]
  .map(name => readRows(name, true)));
const metrics = metricsFiles.flatMap(file => file.rows)
  .filter(row => Date.parse(row.at) >= Date.parse(summary.started));
const enduranceRows = await readRows("endurance.local.jsonl", true);
const supplementary = await readRows("process-samples.local.jsonl", true);
const times = samples.map(row => Date.parse(row.at));
const gaps = times.slice(1).map((time, i) => (time - times[i]) / 1000);
const uptimes = samples.map(row => row.uptimeSeconds);
const firstAt = times[0], lastAt = times.at(-1), started = Date.parse(summary.started);
const deadline = Date.parse(summary.deadline);
const problems = [];
if (summary.buildId !== endpoint.buildId || summary.runtimePid !== endpoint.pid)
  problems.push("endpoint_summary_identity_mismatch");
if (samples.some(row => row.buildId !== endpoint.buildId)) problems.push("sample_build_changed");
if (Math.abs(samples.length - summary.samples) > 1) problems.push("sample_count_mismatch");
if (failures.length || summary.failures) problems.push("monitor_failures");
if (!samples.length) problems.push("no_samples");
if (samples.some(row => !row.ready || !row.asr || !row.tts || row.metrics?.avatarReady !== true))
  problems.push("capability_not_ready");
if (samples.some(row => row.metrics?.renderErrors > 0 || row.metrics?.underruns > 0))
  problems.push("render_or_audio_failure");
if (samples.some(row => row.metrics?.tracks > 1 || row.metrics?.audioContexts > 1))
  problems.push("duplicate_audio_resources");
if (uptimes.some((uptime, i) => i && uptime <= uptimes[i - 1])) problems.push("runtime_uptime_reset");
if (times.some((time, i) => i && time <= times[i - 1])) problems.push("non_monotonic_samples");
if (samples.some(row => !(row.processes || []).some(item => item.type === "Browser" && item.pid === endpoint.pid)))
  problems.push("runtime_pid_missing_from_process_samples");
if (endpoint.started && samples.some(row =>
  Math.abs(Date.parse(row.at) - row.uptimeSeconds * 1000 - Date.parse(endpoint.started)) > 10000))
  problems.push("runtime_start_time_inconsistent");
if (gaps.some(gap => gap > 75)) problems.push("observation_gap_over_75_seconds");
if (metrics.some(row => ["renderer.gone", "worker.recovery", "tts.error", "avatar.error"].includes(row.type)))
  problems.push("runtime_error_or_recovery_event");
if (endurance && (endurance.buildId !== endpoint.buildId || endurance.runtimePid !== endpoint.pid))
  problems.push("endurance_identity_mismatch");
if (endurance?.failures || enduranceRows.rows.some(row => row.failure)) problems.push("endurance_failures");
const processSeries = new Map();
for (const sample of samples) {
  for (const item of [...(sample.processes || []), ...(sample.workers || [])]) {
    const record = processSeries.get(item.pid) || { pid: item.pid, type: item.type || "voice-worker", points: [] };
    record.points.push({ hours: (Date.parse(sample.at) - started) / 3600000,
      value: item.workingSetMiB, privateMiB: item.privateMiB });
    processSeries.set(item.pid, record);
  }
}
const processMemory = [...processSeries.values()].map(record => {
  const late = record.points.filter(point => point.hours >= 1);
  const privatePoints = late.filter(point => Number.isFinite(point.privateMiB))
    .map(point => ({ ...point, value: point.privateMiB }));
  const windowHours = late.length ? late.at(-1).hours - late[0].hours : 0;
  return { pid: record.pid, type: record.type, observations: record.points.length,
    firstMiB: record.points[0].value, lastMiB: record.points.at(-1).value,
    peakMiB: Math.max(...record.points.map(point => point.value)),
    lateWindowHours: windowHours,
    lateWorkingSetSlopeMiBPerHour: windowHours >= 1 ? slope(late) : null,
    latePrivateSlopeMiBPerHour: windowHours >= 1 ? slope(privatePoints) : null,
    privateMiB: stats(record.points.map(point => point.privateMiB)),
    lateHalfWorkingSetSlopeMiBPerHour: lateHalfSlope(record.points, "value"),
    lateHalfPrivateSlopeMiBPerHour: lateHalfSlope(record.points, "privateMiB"),
    hourlyWindows: hourlyWindows(record.points, { workingSetMiB: "value", privateMiB: "privateMiB" }),
  };
});
const processIds = type => samples.map(row => (row.processes || [])
  .filter(item => item.type === type).map(item => item.pid).sort((a, b) => a - b).join(","));
for (const type of ["Browser", "GPU", "Tab"])
  if (new Set(processIds(type)).size > 1) problems.push(`${type.toLowerCase()}_process_changed`);
if (samples.some(row => !(row.workers || []).length)) problems.push("worker_memory_missing");
if (new Set(samples.map(row => (row.workers || []).map(item => item.pid).sort((a, b) => a - b).join(","))).size > 1)
  problems.push("worker_process_tree_changed");
const lateGrowth = processMemory.filter(record => record.lateWindowHours >= 1 &&
  (record.lateWorkingSetSlopeMiBPerHour > 10 || record.latePrivateSlopeMiBPerHour > 10));
const supplementarySeries = new Map();
for (const sample of supplementary.rows.filter(row => !row.failure)) {
  for (const item of sample.processes || []) {
    const record = supplementarySeries.get(item.pid) || { pid: item.pid,
      type: sample.processTypes?.[item.pid] || item.name, created: item.created,
      points: [], identityChanged: false };
    record.identityChanged ||= record.created !== item.created;
    record.points.push({ hours: (Date.parse(sample.at) - started) / 3600000,
      privateMiB: item.privateMiB, handles: item.handles, threads: item.threads });
    supplementarySeries.set(item.pid, record);
  }
}
const supplementaryProcesses = [...supplementarySeries.values()].map(record => {
  const late = record.points.filter(point => point.hours >= 1);
  const windowHours = late.length ? late.at(-1).hours - late[0].hours : 0;
  return { pid: record.pid, type: record.type, created: record.created,
    identityChanged: record.identityChanged, observations: record.points.length,
    privateMiB: stats(record.points.map(point => point.privateMiB)),
    handles: stats(record.points.map(point => point.handles)),
    threads: stats(record.points.map(point => point.threads)), lateWindowHours: windowHours,
    latePrivateSlopeMiBPerHour: windowHours >= 1 ? slope(late.map(point => ({ hours: point.hours, value: point.privateMiB }))) : null,
    lateHandleSlopePerHour: windowHours >= 1 ? slope(late.map(point => ({ hours: point.hours, value: point.handles }))) : null,
    lateHalfPrivateSlopeMiBPerHour: lateHalfSlope(record.points, "privateMiB"),
    lateHalfHandleSlopePerHour: lateHalfSlope(record.points, "handles"),
    hourlyWindows: hourlyWindows(record.points, { privateMiB: "privateMiB", handles: "handles", threads: "threads" }),
  };
});
if (supplementary.rows.some(row => row.failure) || supplementaryProcesses.some(record => record.identityChanged))
  problems.push("supplementary_process_sampling_failure");
const supplementaryTimes = supplementary.rows.filter(row => !row.failure).map(row => Date.parse(row.at));
const supplementaryGaps = supplementaryTimes.slice(1).map((time, i) => (time - supplementaryTimes[i]) / 1000);
if (supplementaryGaps.some(gap => gap > 90)) problems.push("supplementary_observation_gap_over_90_seconds");
if (supplementaryTimes.some((time, i) => i && time <= supplementaryTimes[i - 1]))
  problems.push("supplementary_non_monotonic_samples");
const supplementaryGrowth = supplementaryProcesses.filter(record =>
  record.latePrivateSlopeMiBPerHour > 10 || record.lateHandleSlopePerHour > 10);
const performanceBuckets = new Map();
for (const row of metrics) {
  const hour = Math.floor((Date.parse(row.at) - started) / 3600000);
  const bucket = performanceBuckets.get(hour) || [];
  bucket.push(row);
  performanceBuckets.set(hour, bucket);
}
const timingFields = {
  asrMs: ["asr.complete", "asrMs"], vadToAsrMs: ["voice.turn", "vadToAsrMs"],
  ttsFirstMs: ["tts.first", "firstMs"], softwareFirstSoundMs: ["playback.sound", "renderFirstMs"],
  softwareEndToSoundMs: ["playback.sound", "endToSoundMs"],
  softwareCancelAckMs: ["playback.interrupted", "interruptMs"], rtf: ["tts.complete", "rtf"],
};
const hourlyPerformance = [...performanceBuckets.entries()].sort(([a], [b]) => a - b)
  .map(([hour, bucket]) => ({ hourFromStart: hour,
    firstEvent: bucket[0].at, lastEvent: bucket.at(-1).at,
    eventCounts: Object.fromEntries(Object.values(timingFields).map(([type]) =>
      [type, bucket.filter(row => row.type === type).length])),
    ...Object.fromEntries(Object.entries(timingFields).map(([label, [type, key]]) =>
      [label, timingStats(bucket.filter(row => row.type === type).map(row => row[key]))])),
    fps: timingStats(samples.filter(row => Math.floor((Date.parse(row.at) - started) / 3600000) === hour)
      .map(row => row.metrics?.fps)),
  }));
const finished = summary.status === "finished" && Date.now() >= deadline &&
  (deadline - started) >= 8 * 3600000 && firstAt - started <= 45000 && deadline - lastAt <= 45000;
if (endurance && summary.status === "finished" && endurance.status !== "finished")
  problems.push("endurance_not_finished");
const report = {
  audited: new Date().toISOString(), buildId: endpoint.buildId,
  runtimePid: endpoint.pid, sourceStatus: summary.status,
  elapsedHours: (Date.now() - started) / 3600000,
  sampledSpanHours: samples.length ? (lastAt - firstAt) / 3600000 : 0,
  expectedHours: (deadline - started) / 3600000, actualEightHoursFinished: finished,
  samples: samples.length, sampleGapsSeconds: stats(gaps),
  firstSample: samples[0]?.at, lastSample: samples.at(-1)?.at,
  minimumFps: stats(samples.map(row => row.metrics?.fps))?.min,
  audioResources: { tracks: stats(samples.map(row => row.metrics?.tracks)),
    contexts: stats(samples.map(row => row.metrics?.audioContexts)),
    underruns: stats(samples.map(row => row.metrics?.underruns)) },
  gpuMemoryMiB: stats(samples.map(row => row.gpu ? Number(row.gpu.split(",")[0]) : NaN)),
  processMemory, lateGrowthReviewPids: lateGrowth.map(record => record.pid),
  supplementaryProcesses,
  supplementaryCoverageStart: supplementary.rows[0]?.at,
  supplementaryCoverage: {
    samples: supplementaryTimes.length,
    startsWithin45Seconds: supplementaryTimes.length ? supplementaryTimes[0] - started <= 45000 : false,
    endsWithin90SecondsOfDeadline: supplementaryTimes.length ? Math.abs(deadline - supplementaryTimes.at(-1)) <= 90000 : false,
    sampledSpanHours: supplementaryTimes.length ? (supplementaryTimes.at(-1) - supplementaryTimes[0]) / 3600000 : 0,
    sampleGapsSeconds: stats(supplementaryGaps),
  },
  supplementaryGrowthReviewPids: supplementaryGrowth.map(record => record.pid),
  memoryReviewThresholdMiBPerHour: 10,
  memoryAssessment: lateGrowth.length || supplementaryGrowth.length ? "review_late_growth" : finished ? "review_trends_before_acceptance" : "insufficient_duration",
  metricsCoverageStart: metrics[0]?.at,
  hourlyPerformance,
  performanceSemantics: "software_timing_only_missing_values_are_not_zero",
  metricsCounts: Object.fromEntries(["asr.complete", "tts.complete", "playback.sound", "playback.interrupted", "renderer.gone", "worker.recovery", "tts.error", "avatar.error"]
    .map(type => [type, metrics.filter(row => row.type === type).length])),
  endurance: endurance && { status: endurance.status, cycles: endurance.cycles,
    speeches: endurance.speeches, cancels: endurance.cancels,
    asrRequests: endurance.asrRequests, syntheticInput: endurance.syntheticInput,
    failures: endurance.failures },
  partialLastLines: observations.partialLastLine || enduranceRows.partialLastLine || supplementary.partialLastLine || metricsFiles.some(file => file.partialLastLine),
  problems, sampledChecksPass: problems.length === 0,
  outcome: problems.length ? "needs_review" : finished ? "eight_hours_sampled_manual_memory_review_required" : "incomplete",
  realMicrophoneVerified: false, actualDesktopVerified: false,
};
await fs.writeFile(path.join(dir, "soak-audit.local.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outcome: report.outcome, actualEightHoursFinished: finished,
  samples: samples.length, sampledSpanHours: report.sampledSpanHours,
  problems, lateGrowthReviewPids: report.lateGrowthReviewPids }));
if (problems.length || (requireFinished && !finished)) process.exitCode = 1;
