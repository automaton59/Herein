# SAPI 长语音进展超时补丁

此补丁已经在隔离候选验证，尚未应用到当前冻结运行时。冻结 buildId `b3ffe698326d97cc97c97021d316c13cbd93ee9cafd0fc384c3227dc55f4925d` 的两个 GGUF 长测继续运行；它们不证明此补丁或 SAPI 长语音通过全天候验收。

旧 SAPI worker 对整个发声使用 30 秒总超时。接受 500 字后，播放器背压使 PCM 持续生成/确认超过 30 秒，仍会提前终止。固定静默 worker 复现：约 30.5 秒返回 worker closed，只收到 25.19 秒 PCM。补丁改为 90 秒无进展超时，PCM 帧/下游 ACK 推进时续期；结束或失败清理监听器。下游 ACK 失败立即停止该轮和 worker，防止等不到 done 帧时挂到总超时。取消仍清掉待发 PCM。

隔离候选的 500 字固定 worker 测试收到 122.4945 秒 PCM，逐块按真实时长等待，145.91 秒正常完成。这里 RTF=1.19 包含人为等待及每块调度开销，不能当作纯合成 RTF。四个回归检查持续进展超过 30/90 秒总时限、90 秒停滞、取消/替换与 ACK 失败；mock clock 只用于有界时间机制，不代替真实长播放。原 Windows SAPI 取消回归通过。

同一“持续进展超过总时限”回归在冻结源码上实测失败、候选通过，确认测试能识别旧缺陷；故未应用补丁前不要对冻结源码期待该 pending 回归全绿。

完整 Electron 候选 `a46ecc9bc3cc331f86825bbbecdc5424c9c9abc4b34d4b0d7905753a67be76cc`，同冻结 renderer、透明30fps、CPU ASR、麦克风关闭、silentOutput=true：固定145/500字输出37.69/130.40秒 PCM，软件首声205.9/133.4ms、RTF0.91/0.97、欠供0，结束身体复位，长文取消/替换通过。原始报告 `tmp/interaction-sapi-progress-runtime-data/long-speech-verification.local.json`。末态再查 buffer0/idle/嘴0/音轨0/错误0；runtime PID21848及10个子进程按候选目录和完整命令行确认后回收。此短测不证明候选全天候，也不验证物理声音/逐字准确度。

候选另开独立8小时：`tmp/interaction-sapi-progress-soak-data`，01:16:13–09:16:13（2026-10-23北京时间），同候选build、30fps/透明/CPU ASR/SAPI、循环合成输入、静音输出。runtime PID25784、soak17656、endurance29420、process sampler6360；采样器距起点约21秒，fullSoakCoverage=true。尚在运行。SAPI取消会关闭/重建worker；严格GGUF通用审计已列出worker变化/recovery复查项，必须结合固定负载取消与全树创建时间逐项审阅，不能自动豁免或标无失败通过。原GGUF长测独立保留、不拼接。

复查时执行 `node apps/interaction/pending/sapi-progress/review-recovery.mjs <data-dir> <local-config>`：从原始metrics/全树采样关联每次固定播放取消、恢复事件、新worker创建、后续独占worker与旧身份消失，另查ASR身份连续性。结果留在 `sapi-recovery-review.local.json`，只辅助人工审阅，不删除严格soak审计标记、不判断8小时或硬件通过。周期快照无法证明两次采样之间没有短暂重叠，未观察到后续样本时保留复查项。首个取消实测4.15秒后恢复、447ms后就绪，旧worker及conhost身份均已消失，下一次采样仅一个新worker。复查回归3/3，包含重叠、ASR重启、缺取消/覆盖的反例。

在 A 的两条冻结长测完成、审阅并保留原证据后，将它应用到实际源码；不要覆盖仍在运行的 bundle：

```powershell
git apply --check --ignore-space-change apps/interaction/pending/sapi-progress/workers.patch
git apply --ignore-space-change apps/interaction/pending/sapi-progress/workers.patch
$env:HEREIN_INTERACTION_SAPI_CANDIDATE = (Resolve-Path apps/interaction/workers.cjs).Path
node --test apps/interaction/pending/sapi-progress/regression.mjs
node --test apps/interaction/tests/workers.test.mjs
```

补丁只含92行实际修改上下文，未引入整文件换行重写。在当前LF源码/Windows Git自动换行配置下，以上检查实测通过；`git -c core.autocrlf=false apply --check` 同样通过。先检查成功再应用，不要强行覆盖源码。修复会改变 buildId，后续验收必须记录新版本，并完成 SAPI 实际长播放/取消和相应稳定性验证。若后续选择保持原 GGUF 冻结版演示，SAPI 降级的长语音缺陷仍属于未完成项，不能把补丁存在当作发布已修复。
