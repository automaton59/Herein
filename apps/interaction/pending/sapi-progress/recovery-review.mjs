// Evidence correlation only: retain the strict soak audit's recovery flags.
export function reviewSapiRecovery(runtimePid, started, metrics, samples) {
  const since = Date.parse(started);
  const events = metrics.filter(row => Date.parse(row.at) >= since);
  const observations = samples.filter(row => !row.failure && Date.parse(row.at) >= since)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const identity = item => `${item.pid}@${item.created}`;
  const workerAt = row => (row.processes || []).filter(item => item.name === "powershell");
  const problems = [];
  if (!observations.length) problems.push("no_process_samples");
  if (samples.some(row => row.failure)) problems.push("process_sampling_failure");
  if (observations.some(row => workerAt(row).length > 1)) problems.push("overlapping_sapi_workers");
  if (observations.some(row => workerAt(row).some(item => item.parentPid !== runtimePid)))
    problems.push("sapi_parent_mismatch");
  const pythonTrees = observations.map(row => (row.processes || [])
    .filter(item => item.name === "python").map(identity).sort().join(","));
  if (new Set(pythonTrees).size > 1) problems.push("asr_process_identity_changed");
  const recoveries = events.filter(row => row.type === "worker.recovery");
  const seen = new Map();
  for (const row of observations) for (const item of workerAt(row)) {
    const key = identity(item);
    const entry = seen.get(key) || { ...item, firstObserved: row.at, lastObserved: row.at };
    entry.lastObserved = row.at;
    seen.set(key, entry);
  }
  const workers = [...seen.values()].sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  const transitions = workers.slice(1).map((worker, index) => {
    const old = workers[index], created = Date.parse(worker.created);
    const recovery = recoveries.find(event => Math.abs(Date.parse(event.at) - created) <= 2000);
    const interruption = events.filter(event => event.type === "playback.interrupted" &&
      Date.parse(event.at) <= created && created - Date.parse(event.at) <= 30000).at(-1);
    const cancellation = interruption && events.find(event => event.type === "cancel" &&
      event.generation === interruption.generation &&
      Math.abs(Date.parse(event.at) - Date.parse(interruption.at)) <= 2000);
    const sound = interruption && events.filter(event => event.type === "playback.sound" &&
      event.generation === interruption.generation - 1 && Date.parse(event.at) <= Date.parse(interruption.at)).at(-1);
    const following = observations.find(row => Date.parse(row.at) >= created);
    const active = following && workerAt(following);
    const oldPresentAfterCreation = observations.some(row => Date.parse(row.at) >= created &&
      (row.processes || []).some(item => identity(item) === identity(old)));
    const rowProblems = [];
    if (!recovery) rowProblems.push("new_worker_without_matching_recovery");
    if (!cancellation || !interruption || !sound) rowProblems.push("missing_fixed_playback_cancel_evidence");
    if (!following || Date.parse(following.at) - created > 90000) rowProblems.push("missing_followup_process_sample");
    if (active && (active.length !== 1 || identity(active[0]) !== identity(worker)))
      rowProblems.push("replacement_not_exclusive");
    if (oldPresentAfterCreation) rowProblems.push("old_worker_still_observed");
    return { oldPid: old.pid, oldCreated: old.created,
      newPid: worker.pid, newCreated: worker.created,
      recoveryAt: recovery?.at, interruptedAt: interruption?.at,
      cancelGeneration: cancellation?.generation,
      cancelToNewWorkerMs: cancellation ? created - Date.parse(cancellation.at) : null,
      followingSample: following?.at,
      oldWorkerAbsentInFollowingSamples: !oldPresentAfterCreation,
      problems: rowProblems };
  });
  const matched = new Set(transitions.map(row => row.recoveryAt).filter(Boolean));
  const unmatchedRecoveries = recoveries.filter(row => !matched.has(row.at));
  if (unmatchedRecoveries.length) problems.push("recovery_without_observed_replacement");
  for (const row of transitions) for (const problem of row.problems) problems.push(problem);
  const current = workerAt(observations.at(-1) || {});
  return { runtimePid, observedSamples: observations.length,
    firstSample: observations[0]?.at, lastSample: observations.at(-1)?.at,
    workers: workers.map(item => ({ pid: item.pid, created: item.created,
      firstObserved: item.firstObserved, lastObserved: item.lastObserved })),
    currentWorkerCount: current.length, peakWorkerCount: Math.max(0, ...observations.map(row => workerAt(row).length)),
    transitions, unmatchedRecoveryEvents: unmatchedRecoveries.map(row => row.at),
    problems: [...new Set(problems)],
    evidenceCorrelationComplete: problems.length === 0,
    strictSoakAuditFlagsPreserved: true, manualReviewRequired: true,
    eightHourAcceptance: false, realHardwareVerified: false,
    limitations: "Periodic process snapshots do not prove absence between observations or desktop/audio hardware behavior",
  };
}
