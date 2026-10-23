# Agent A 独立验收

软件证据和真实机器验收分开记录。当前蓝鱼是用户指定的技术验证模型；`relax` 是恒等表情，正式模型后续通过 manifest 替换。

## 当前冻结版本

- 分支：`codex/interaction-runtime`。
- buildId：`d6e145d9c9229dc110a02dbcc749444c10ae6001e95d4dfef3517cab8588cbc5`（三项 pending 补丁已应用）。
- 旧 build `b3ffe698...` 的长测和截图不再等同于当前版本证据；新版本仍需最终模型/真人重验。
- 独立 renderer：`tmp/interaction-blue-overnight-dist`。
- 夜间数据：`tmp/interaction-blue-overnight-data`。
- 夜间窗口：非透明配置、静音输出、循环合成麦克风；8 小时截止 2026-10-23 07:33:39 北京时间。
- 透明配置的软件验证：`tmp/interaction-blue-regression-data`，同一 buildId，十轮合成输入及 alpha 页面截图；不是 Windows 桌面合成证据。
- 补充默认透明窗口长测：`tmp/interaction-blue-transparent-data`，同一 buildId、Qwen GGUF/Whisper CUDA/合成输入/静音输出，从 10-23 00:03:51 至 08:03:51 北京时间；独立保留结果，不与非透明主测拼接。

## 软件关卡与证据

| 要求 | 已有证据 | 仍需确认 |
| --- | --- | --- |
| 首声和连续十句 | 同版本合成输入十轮 1.13–1.52s；软件 TTS 十句 713–838ms | 真人句末、ASR 准确率、实际声音 |
| 播放中插话 | 固定 fake-device 输入先取消再 ASR；播放器取消确认 0.2ms；闭嘴/待机/新句通过 | 耳机与扬声器下真实插话、AEC 和余音 |
| 长语音 | 145/500 字 30.00/104.32s、欠供 0；末句关键词识别到；取消/替换通过 | 音质、分段衔接、逐字完整度 |
| 身体 | 9 次表情切换/复位、4 动作、视线、模拟点拖、200 次切换通过；说话中点拖反应恢复、20 次连触及动作中取消通过；4 表情各保持约 29s 跨两周期、隐藏/显示恢复；另6种映射说话组合562采样、PCM覆盖张嘴表情、反应中新表情保留、晚结束不复活；58/29.4fps | 实际点拖、可见大小/位置、Windows 透明合成 |
| 模型可替换 | 同代码 Cubism 2 与 Cubism 4、manifest 索引/循环/参数/资源审计 | 后续正式模型视觉验收 |
| 独立包 | 便携Electron与bundle从仓库外启动；171文件SHA256、配置/资源外置、10句静音PCM/取消通过 | 新 build 重新生成交付包；真人实际声音/显示 |
| 常驻与恢复 | loopback、置顶状态、窗口位置保存、模拟隐藏/恢复/worker 故障/renderer 重载 | 真热键/托盘、多屏、设备拔插、休眠与真实登录 |
| 全天候 | 旧 build 8h 数据已到截止；新 build 尚未跑完整 8h | 新 build 真实 8 小时并人工审阅内存斜率 |
| SAPI 降级长文 | 30秒总超时补丁、145/500字、取消/替换与4回归通过；已应用新 build `d6e145...` | 新 build 长语音/取消复验 |

SAPI修复候选独立长测 `tmp/interaction-sapi-progress-soak-data` 从2026-10-23 01:16:13至09:16:13北京时间进行中。它使用候选build、CPU ASR/SAPI/透明30fps，不与旧GGUF版本或硬件证据拼接。SAPI固定取消会重建worker，严格通用审计的相关复查项需按负载时序和进程创建时间人工核对，不能仅因“预期行为”跳过审阅。

可用 `pending/sapi-progress/review-recovery.mjs <data-dir> <local-config>` 关联取消/恢复/新worker/旧身份消失。这个离线复查只整理采样证据，保留严格审计标记，不能作为8小时或无泄漏的自动判定。

## 真实 8 小时结束后

在 worktree 根目录执行：

```powershell
node apps/interaction/audit-soak.mjs tmp/interaction-blue-overnight-data --require-finished
# 透明窗口长测到达自己的截止时间后，单独审阅。
node apps/interaction/audit-soak.mjs tmp/interaction-blue-transparent-data --require-finished
```

先确认实际 runtime/监测进程的连续性及原始样本，再审阅 `soak-audit.local.json` 的采样缺口、processMemory、supplementaryProcesses、lateGrowthReviewPids 和错误事件。进程树采样从第 13 分钟开始，不能当作全程覆盖；原 soak 从起点记录 Electron 工作集和 ASR/TTS 全树私有内存。audit 返回 0 只代表采样关卡通过，不代替人工趋势判断或真实硬件验收。

比较每个进程 `hourlyWindows` 的中位值和最大值、预热后后半段斜率与句柄趋势，并核查 `supplementaryCoverage`；默认透明长测的补充采样从起点约 20 秒后开始。增长超过复查阈值只能判为需要调查，不能从首末样本或单个正斜率直接判定泄漏/无泄漏。

同时检查 `lateHalfGrowthReviewPids` 和 `supplementaryLateHalfGrowthReviewPids`；全后期窗口斜率低也不能掩盖后半段增长。阶段性主ASR后半段曾触发此项，小时峰值与周期回落继续留档，必须在完整窗口结束后人工审阅。

另比较 `hourlyPerformance` 的 ASR、软件首声、RTF、fps 是否在后段明显恶化，同时核查样本数。固定 TTS 负载不构成 ASR→回复闭环，端到端样本缺失保留 null；真人和物理输出延迟仍须单独验收。

SAPI 长语音补丁、profile 隔离补丁、stream-failure 补丁已按顺序应用，新 buildId `d6e145d9...8cbc5`。新 build 必须重新跑长语音/取消、直接/登录入口和故障取消；旧 frozen build 的 8h 数据不能替代新 build 的 8h。

```powershell
npm run test:interaction
node apps/interaction/build.mjs --out-dir=tmp/interaction-final-dist
```

新 build 的完整 8 小时仍需另开，旧长测只作历史证据。

## 用户主动开始真人验收后

用户已约定发送“开始真人验收”；夜间不提示、不录真人声音。真人阶段只保存计时、计数、状态和简短观察结果，不保存音频、识别文字或聊天数据。

1. 结束或隔离 A 自己的夜间负载，确认所有待停止 PID 的命令行属于 A 的临时目录。保留原指标，不停止用户 Core/TTS/tunnel。
2. 从本机蓝鱼配置创建新的 `*.local.json`：`transparent:true`、`silentOutput:false`、`autoListen:false`；仍用同一冻结 renderer，随机 port 与新的验收目录。普通设备模式启动，不带 fake-device 或 fake-audio 参数。这时才选择用户同意的输入/输出设备。
3. 用户观察实际形象；通过本 runtime UI 或本机接口启动监听，开启用户显式选择的固定回复演示。用户读十句，检查每句识别、首声和恢复。`turnId` 关联计时包含 VAD/ASR/回复/TTS/播放。
4. 先耳机，再扬声器：播放中插话；确认旧内容立即停止、不复活，闭嘴并可接续新一句。安静环境观察误触发；核查实际 AEC 效果。
5. 点击与拖动分别观察反应和回待机；表情 happy/excited/puzzled/sad、thinking/speaking/thinkEnd/idle 分别演示。neutral 去掉额外表情，恢复原 idle；relaxed 原素材没有独立可见变化。
6. 验证 Ctrl+Shift+Space / X / M、关窗到托盘、托盘显示/退出、置顶、重启运行时恢复位置。并行实例可能抢占热键；单一验收实例下观察结果。
7. 有对应硬件时检查输入/输出设备拔插、多屏移除后窗口回可见区、实际休眠唤醒。真实登录自启需要用户选择开启并在真实登录后确认；不能拿模拟 handler 测试代替。

每项记录通过/失败/缺证据。未完成项继续保留，不能把交互 demo、合成输入或旧版本长测视为整体验收完成。C 的真实集成在独立验收之后；固定回复演示不决定产品的主动性或人格。
