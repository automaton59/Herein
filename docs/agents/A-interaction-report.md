# Agent A 交互运行时证据报告

更新时间：2026-10-22。**进行中，尚未完成整体验收。**

## 交付范围

`apps/interaction` 是独立 Electron 运行时：本地 ASR、PCM 播放、打断、Live2D manifest、常驻窗口、托盘、快捷键、设备恢复、presence 和 C 的本机接口。没有改 Core 数据库、人格、记忆、控制台、Android、插件或设计。

独立分支 `codex/interaction-runtime`，使用 managed worktree。根工作区出现其他工作改动后，A 的实现全部隔离在 worktree。模型与真实配置位于既有私有目录或 gitignored `tmp/`，没有纳入提交。运行端口随机分配，数据目录独立；没有停止用户 Core/TTS/tunnel。

## 已有证据

| 项目              | 证据与结果                                                                                                                                 | 结论                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 独立构建          | `node apps/interaction/build.mjs`：Vite 构建成功；独立 Electron 入口与临时 HTTP 服务已运行                                                 | 通过                                 |
| 边界              | `npm run check:core`：`core boundary ok (10 files)`                                                                                        | 通过；未改变 Core                    |
| 关键测试          | `node --test apps/interaction/tests/*.test.mjs`：7/7；缓冲环、VAD、时长上限、文本分段、资产路径、命令校验、真实 SAPI 取消与替换            | 通过                                 |
| Shizuku 渲染      | Electron `capturePage` 本机截图确认形象；桌面 computer-use 捕获透明背景，不能以该截图证明 Windows 合成显示                                 | 页面渲染通过；桌面观察需补           |
| 十句文本→首声     | SAPI 基线 115–223ms、RTF 0.01–0.02；冻结版本 Qwen GGUF 首声 550–867ms、RTF 0.42–0.68、欠供 0                                               | 十句发声通过；不是麦克风闭环验收     |
| 扬声器回环        | 冻结版本 GGUF 串行回环：首声 866ms，取消到最后声音 67ms，取消 500ms 后 RMS=0；只保留计时/阈值                                              | 输出与取消通过；不是真人插话         |
| 增量文本          | `verify-stream.mjs`：两句依次播放，取消后待播分句不再发声                                                                                  | 通过                                 |
| ASR               | `bench-asr.mjs`：本地 Whisper small CUDA，首次 441ms，热 93–133ms；五个固定音频中“嗯，我在”识别错误                                        | 速度通过基线；准确率待真人验证       |
| Qwen PyTorch 增量 | `bench-qwen.py`：热首块 1598–1648ms，RTF 3.31–3.44，峰值模型分配约 2114MiB                                                                 | 不达实时；保留实验适配               |
| Qwen GGUF         | 本地 Vulkan llama.cpp b10621 + DirectML ONNX；静默固定句预热，真实增量 PCM；十句、分句、生成中取消立即替换通过                             | 自然音色短测通过；音质主观评价待用户 |
| 模拟恢复          | 并发 5 次开启麦克风仍 1 轨；模拟 suspend/resume、hide/show、ASR 终止恢复、renderer 崩溃恢复通过                                            | handler/恢复通过；不等于实际硬件周期 |
| 常驻帧率          | 禁用遮挡节流后 58fps 左右；60/30fps 配置、隐藏时 10fps                                                                                     | 当前短测通过；8 小时待结果           |
| 8 小时采集        | 最终版本 2026-10-22 22:13:44 北京时间开始，预计 10-23 06:13:44 结束；health、Electron 与实际 worker 进程树内存、GPU、fps、轨数/上下文/欠供 | 正在运行，不能声称通过               |

原始指标、固定音频和截图留在 worktree 的 `tmp/interaction-evidence`、`tmp/interaction-data`。这些目录不提交。汇总表中的首声是软件非静音采样或明确标注的扬声器回环；不把 TTFA、batch latency 和端到端语音闭环混为同一个指标。

最终运行使用 `tmp/interaction-release-data`。buildId `010100c537b52d05c8063872a1494bb09a677b1a16ea12c463d0e3faa3e1f1cb`；runtime PID 23884；monitor PID 25520。monitor 汇总在 `soak-summary.local.json`。首样本约 58.32fps、单音轨/单音频上下文、欠供 0；实际模型子进程工作集 ASR 约 721MiB、TTS 约 1009MiB，总 GPU 显存约 2854MiB。单个样本无法证明无泄漏。此前多个短测被主动终止，不能拼成 8 小时通过。

## 已发现并修复的问题

补充冻结版本实测：两条 39–40 字长句输出 8.56s/8.08s，首声 916.5ms/877ms，RTF 0.67/0.65，欠供 0，最大观察缓冲 3436ms，结束后恢复监听。API 边界实测：无 token 401、501 字发声/增量 400、非法监听类型 400、模型路径越界 400、SSE 第 9 个连接 429。原始结果为 `long-speech-verification.local.json` 与 `api-verification.local.json`，均留在独立验收数据目录。

- 每句启动 PowerShell 在负载下从约 0.5s 恶化到 9s：改持久 SAPI worker。
- 窗口遮挡后帧率跌至约 3fps：禁用 Electron/Chromium 遮挡节流，保留主动隐藏降帧。
- Pixi 默认动态代码生成与 CSP 冲突：使用 `@pixi/unsafe-eval` 替代实现，保留不含 unsafe-eval 的 CSP。
- 取消只停播放器会造成旧音频复活：gain 立即静音、环形缓冲清空、generation 过滤、TTS worker 取消共同处理。
- 句末缓冲数值未立即归零阻止下一分句：在 drained 事件归零，增量取消测试验证。
- 重启后日志 generation 复用使验证脚本误读：验证按 endpoint 启动时间过滤。
- 并发音频初始化/麦克风启动：共享初始化 Promise、设备获取 epoch、过期流清理，恢复测试确认单轨。
- Windows venv 另启实际 Python：退出回收自己的 worker 进程树，长测采集完整树，避免只测启动器内存。
- 异步模型加载前收到 show/hide：先保存可见状态，ticker 就绪后应用；health 渲染状态不被 capability 覆盖。
- GGUF 短块间欠供：自然声音 240ms 起播缓冲，最终十句欠供 0；取消不等待缓冲。

## 剩余验收

1. 真人麦克风连续 10 句、耳机与扬声器回声、播放中插话；端到端计时关联 turnId，含 VAD/ASR/C 回复/TTS/播放。
2. 正式蓝蓝模型尚未提供；用户补充指定 dsh-live2d 蓝鱼作为技术验证模型，后续会替换。Cubism 4 本机技术链路已有实测，正式外观与桌面实际显示仍需验收。
3. 输入输出设备拔插、多屏切换、休眠唤醒和真实重启自启。
4. 最终代码版本的真实连续 8 小时运行与各进程内存趋势评估；短测不是全天候验收。
5. Qwen GGUF 已完成十句、两条约 8 秒长句、分句、取消/替换与扬声器回环；还需真人主观音质、更长内容与 8 小时资源趋势。系统声音保留为降级，不能代替正式音色验收。

## C 集成

见 `apps/interaction/README.md`。C 读取独立数据目录的 `endpoint.local.json` 发现 URL/token；订阅 SSE 语音结果及 presence，自行决定何时回应、说什么、对谁说。回传 `turnId`，使用 speech 或 begin/delta/end 文本流。取消事件只上报执行事实，不改变 C 的主动性策略。真实集成放在独立运行与验证完成之后。

## 2026-10-22 夜间：蓝鱼技术验证接入

用户指定 [lrplrplrp/dsh-live2d](https://github.com/lrplrplrp/dsh-live2d)，并明确它只是跑通路线、积累经验，后续会换模型。独立 checkout 位于本机忽略目录 `tmp/dsh-live2d`，提交 `1ba6522a18408716a5c71a81575503ddad9b96be`；没有安装 DSH 插件。仅提交 manifest 模板与通用运行代码，不提交模型、贴图、Cubism Core、录音或截图。项目 MIT 和 Cubism Core 文件头 Live2D 专有许可保留在原本地 checkout。

接入由 `avatar.dsh.example.json` 描述：5 个原始表情 + neutral 复位、4 个动作；Anima 0 说话/2 思考/1 思考结束，明确索引与循环。运行状态驱动身体，但不决定主动性或发言内容。点按/拖动分别触发一次反应后恢复当前运行状态，指针离开回中。新口型只在实际 PCM 播放时覆盖表情嘴部，35ms 开/85ms 合平滑；取消立即闭嘴。修复动作缺失嘴曲线时的半张嘴残留、neutral 之后无法重新应用相同表情、快速切换的淡出队列积压（最多 4）和 C 先于 ASR IPC 回调回应时的身体状态覆盖。

最终复查补充：interrupted 状态不再永久覆盖新表情嘴部，取消后的 excited 参数=1；neutral 立即清掉旧表情淡出队列。Cubism 4 无效嘴参数实测 avatarReady=false/renderErrors=1；Cubism 2 对未知参数会生成虚拟项，不能用同一存在性检查，新代码 Shizuku 加载回归通过。这些修正过程中两个蓝鱼长测被主动终止，标记 stopped-for-*，没有拼接进最终 8 小时。原 Shizuku 旧版本长测仍独立保留；用户睡后通过本实例接口暂停了 A 自己的真人麦克风监听，监测连续性保留，后段不作持续真人监听证据。

以下证据属于蓝鱼版本 buildId `d70d0eaf5b77d27e2c67dc4d2c25ccd2818a763c3db1c237ebdd3c2a294ab642`，不同于上文 Shizuku 长测版本。独立静态资源 `tmp/interaction-dsh-dist`，验收数据 `tmp/interaction-blue-final-data`。夜间配置 silentOutput=true，发声验证只测 PCM 与身体，最终 gain=0。

| 验证 | 证据 | 结果/限制 |
| --- | --- | --- |
| 资源 | `inspect-avatar.mjs`，15 个引用资源、2,580,988 bytes；模型指纹 `a3c2ee30cf93781072931e365534429f3f76fe6fe1b953bdfef38d2b13ae36c3` | 全部存在；路径及 SHA-256 本地报告，不分发资源 |
| 构建/单测/边界 | 438 modules 构建；11/11；Core boundary 10 files | 通过 |
| 表情与动作 | `avatar-verification.local.json`：9 次表情切换/复位、4 个索引、模拟 tap/drag、视线、PCM/取消 | 通过，约 58fps、renderErrors=0；不替代真实 Windows 点拖 |
| 残留修复 | excited 嘴参数约 1；tap/drag 回待机嘴都为 0；视线 X 约 0.746→0.002 | 通过；neutral 恢复原模型 idle，idle 前几秒本身包含笑眼，不等于人为强制直脸 |
| 快速切换 | `avatar-stress-verification.local.json`：200 次；采样淡出表情队列峰值 4，结束动作/表情队列各 1；renderer 工作集 147.69→146.38MiB | 短测通过；不是无泄漏长测证据 |
| 十句软件首声 | `verification.local.json`：557.6–849.4ms，RTF 0.38–0.68，欠供 0 | 静音 PCM 通过；非扬声器首声 |
| 增量/取消替换 | stream/replacement 报告，同一版本 | 通过 |
| 合成输入十轮 | `tmp/interaction-blue-synthetic-data/synthetic-voice-verification.local.json`：10 transcripts /10 PCM sound；endToSound 1130–1480ms，欠供 0 | 伪麦克风→AudioWorklet→VAD→ASR→SSE 固定回复→TTS→PCM；非真人准确率/AEC/扬声器验收 |
| 蓝鱼 8 小时 | runtime PID 28488；monitor PID 21696；2026-10-22 23:05:22 北京时间开始，预计 10-23 07:05:22 结束 | 正在运行；此前 Shizuku 监测保留，不能互相替代或拼接 |
| 连续表现负载 | `endurance.mjs` PID 11948，23:05:32 北京时间开始；约每分钟动作/表情轮换复位、每 15 轮固定静音发声与交替取消，沿用蓝鱼 soak deadline | 正在运行；单独报告次数、队列、fps、渲染错误和失败 |
| Cubism 2 回归 | 新代码 + 原 Shizuku，CPU ASR/SAPI 静音临时实例；happy/tap/drag/neutral 命令 200，model loaded，renderErrors=0、约 58fps、嘴=0 | 可加载与基本命令通过；旧 flick_head 缺失保持如实记录 |

截图和表情对照图只保留本机验收数据目录。页面截图能证明模型在 renderer 内绘制，Windows 桌面合成与热键/托盘的真人观察待用户明天验收。未自动触发需要用户操作/回复的请求，也没有让整机睡眠/重启。今夜不保存真人输入、不开启真人麦克风测试；合成音频为固定 fixture。

旧的 Shizuku 资源审计发现未使用的 flick_head 动作引用缺失（`flickHead_00.mtn`）；不能把全部旧资产都标完整。蓝鱼本次 15 个引用资源审计通过。
