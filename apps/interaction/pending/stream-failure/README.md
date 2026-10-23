# Streaming failure settlement and cancellation

The frozen runtime has two reproduced failure paths:

- Qwen/GGUF downstream ACK rejection, with no later done frame: an unhandled rejection occurs, the speech task remains unsettled, the worker remains open and its stream listener remains attached. `probe-ack.mjs` reproduces this without models or audio devices.
- SAPI worker death after the renderer has buffered approximately 3.5 seconds: `speech.error` sets the body to idle but preserves the generation and flushes queued PCM. An isolated silent Electron probe retained approximately 3.47 seconds of buffer through recovery. The initial short probe had no fresh renderer buffer sample; the strengthened probe waits for an actual speaking sample with >1500ms buffered.

`failure.patch` applies **after** `pending/sapi-progress/workers.patch` and `pending/profile-isolation/main.patch`. It captures the active Qwen worker, settles failures once, cleans listeners, rejects failed ACKs immediately, drops queued PCM, and extends the progress deadline on ACKs. Main publishes `speech.failed` for the failed generation, then cancels that generation's queued playback before sending a notice in the new generation. C still owns response/proactivity policy.

The combined private candidate is `tmp/interaction-stream-failure-candidate`, buildId `d6e145d9c9229dc110a02dbcc749444c10ae6001e95d4dfef3517cab8588cbc5`. Frozen runtime sources and active GGUF/SAPI soaks were not modified. This patch is **not yet applied to delivery sources**.

Evidence:

- Frozen probe: unsettled before done, unhandledRejections=1, workerClosed=false, messageListeners=1. Candidate: immediate rejection, unhandledRejections=0, workerClosed=true, messageListeners=0, chunks=1.
- Candidate 4/4 mechanism regressions: failed ACK, steady progress beyond total timeout, stalled ACK/late completion, failure against an old worker after replacement.
- Combined candidate Windows SAPI silent runtime, `tmp/interaction-worker-failure-fixed-data`: worker killed only after runtime/data/config/parent/creation identity checks. Old generation1 became generation2; AudioWorklet cancel ACK=0.3ms, tts.error→ACK=1ms; later renderer buffer=0, replacement speech and cancellation passed, no old motion resurrection. Main health may retain the old sampled buffer until the next 5-second renderer sample; the worklet ACK is the immediate evidence.
- Frozen counterpart `tmp/interaction-worker-failure-data` preserves the failure. All fixtures/PCM/metrics/configs remain local and uncommitted. Both short runtimes and their 11 identities each were retired after ownership checks.

Run mechanism checks against the candidate:

```powershell
node apps/interaction/pending/stream-failure/probe-ack.mjs <candidate-workers.cjs>
$env:HEREIN_INTERACTION_FAILURE_CANDIDATE = '<candidate-workers.cjs>'
node --test apps/interaction/pending/stream-failure/regression.mjs
```

After preserving/auditing the original soaks, apply the SAPI and profile patches first, then this patch with `git apply --check --ignore-space-change` and `git apply --ignore-space-change`. Record the new build and repeat required GGUF/SAPI playback, replacement, fault recovery and stability evidence. Existing frozen long soaks do not prove the changed code, physical sound, desktop composition, or hardware stability.
