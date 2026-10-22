import test from "node:test";
import assert from "node:assert/strict";
import { reviewSapiRecovery, reviewRetiredIdentities } from "../pending/sapi-progress/recovery-review.mjs";
const at = seconds => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
function fixture() {
  const old = { pid: 10, parentPid: 1, name: "powershell", created: at(0) };
  const next = { pid: 11, parentPid: 1, name: "powershell", created: at(35) };
  const python = { pid: 2, name: "python", created: at(0) };
  const metrics = [{ at: at(29), type: "playback.sound", generation: 1 },
    { at: at(30), type: "cancel", generation: 2 },
    { at: at(30), type: "playback.interrupted", generation: 2 },
    { at: at(35), type: "worker.recovery" }];
  const samples = [{ at: at(20), processes: [old, python] }, { at: at(60), processes: [next, python] }];
  return { old, next, python, metrics, samples };
}
test("correlated SAPI replacement remains subject to strict audit and manual review", () => {
  const { metrics, samples } = fixture();
  const report = reviewSapiRecovery(1, at(0), metrics, samples);
  assert.equal(report.evidenceCorrelationComplete, true);
  assert.equal(report.transitions[0].cancelToNewWorkerMs, 5000);
  assert.equal(report.transitions[0].oldWorkerAbsentInFollowingSamples, true);
  assert.equal(report.eightHourAcceptance, false);
  assert.equal(report.strictSoakAuditFlagsPreserved, true);
});
test("old worker overlap and unrelated ASR restart are not excused by a cancel", () => {
  const { metrics, samples, old } = fixture();
  samples[1].processes.push(old);
  samples[1].processes[1] = { pid: 3, name: "python", created: at(35) };
  const report = reviewSapiRecovery(1, at(0), metrics, samples);
  assert.ok(report.problems.includes("overlapping_sapi_workers"));
  assert.ok(report.problems.includes("old_worker_still_observed"));
  assert.ok(report.problems.includes("asr_process_identity_changed"));
});
test("replacement without cancellation evidence or follow-up coverage is flagged", () => {
  const { metrics, samples } = fixture();
  samples[1].at = at(200);
  const report = reviewSapiRecovery(1, at(0), metrics.filter(row => row.type !== "cancel"), samples);
  assert.ok(report.problems.includes("missing_fixed_playback_cancel_evidence"));
  assert.ok(report.problems.includes("missing_followup_process_sample"));
});
test("global identity check detects a retired descendant even after it leaves the root tree", () => {
  const { metrics, samples, old } = fixture();
  samples[0].processes.push({ pid: 12, parentPid: old.pid, name: "conhost", created: at(1) });
  const report = reviewSapiRecovery(1, at(0), metrics, samples);
  assert.equal(report.retiredWorkerTrees[0].identities.length, 2);
  const alive = reviewRetiredIdentities(report.retiredWorkerTrees,
    [{ pid: 12, parentPid: 999, created: at(1) }]);
  assert.equal(alive.knownRetiredIdentitiesAbsent, false);
  const reused = reviewRetiredIdentities(report.retiredWorkerTrees,
    [{ pid: 12, parentPid: 999, created: at(100) }]);
  assert.equal(reused.knownRetiredIdentitiesAbsent, true);
  assert.equal(reused.allPossibleOrphansExcluded, false);
});
