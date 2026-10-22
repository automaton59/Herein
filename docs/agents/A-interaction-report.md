# Agent A 交互运行时证据报告

更新时间：2026-10-23。**进行中，尚未完成整体验收。**

当前以末尾“长文截断与重载状态修复”“夜间审计补充”为准：修复版 buildId `b3ffe698326d97cc97c97021d316c13cbd93ee9cafd0fc384c3227dc55f4925d`，数据 `tmp/interaction-blue-overnight-data`，8 小时从 10-22 23:33:39 至 10-23 07:33:39 北京时间。下文早期蓝鱼和 Shizuku 表格是历史证据，其旧运行状态不能当作当前冻结版验收。

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
| 动作连续帧 | 同 buildId 独立 CPU ASR/SAPI 静音截图实例：186 帧，185 对相邻帧有可测变化；眼开闭 0–1、呼吸 0.10–0.90、嘴 0–1；本机 `tmp/interaction-motion-capture-data/avatar-motion-demo.mp4` | renderer 内连续动作证据；不是 Windows 桌面录屏，模型资源与视频不提交 |

截图和表情对照图只保留本机验收数据目录。页面截图能证明模型在 renderer 内绘制，Windows 桌面合成与热键/托盘的真人观察待用户明天验收。未自动触发需要用户操作/回复的请求，也没有让整机睡眠/重启。今夜不保存真人输入、不开启真人麦克风测试；合成音频为固定 fixture。

旧的 Shizuku 资源审计发现未使用的 flick_head 动作引用缺失（`flickHead_00.mtn`）；不能把全部旧资产都标完整。蓝鱼本次 15 个引用资源审计通过。

截至本次提交，蓝鱼最终版本短测完成、运行时源文件与构建 main.js 的 SHA-256 重算符合 live buildId；两个历史蓝鱼长测片段不计入最终结果。当前 8 小时仍在真实计时，不标完成。夜间蓝鱼 endurance 驱动身体与 TTS，真人麦克风关闭；ASR 十轮闭环来自单独的合成输入实例，8 小时主实例不作持续麦克风/ASR 请求负载通过证据。

## 2026-10-22 深夜：长文截断与重载状态修复

进一步隔离测试发现：旧蓝鱼版本 145 字语音在 24.00 秒停止，GGUF `max_steps=300` 对应的 300 帧上限使长文提前结束，却仍返回 completed。39 字对照为 8.56 秒。修复为句末/分句优先、每片最多 60 字的连续 PCM 合成，各片段预算 max(300, 字符数×15) 帧；到达生成上限上报失败，取消会停止后续片段。worker 原先 90 秒总超时改为 90 秒无进展超时，仍约束停滞或背压。没有更改用户正在运行的 TTS 服务。

渲染器崩溃时 health 会短暂保留旧 avatarReady 和轨数；现在立即清理旧就绪状态、renderer 时间与 micActive。加强生命周期验收，必须等新 renderer 样本、模型重新加载，再确认新 happy 参数生效；重载期间诊断接口的瞬时超时在 30 秒期限内重试，不把旧 health 当恢复证据。

修复版 buildId `b3ffe698326d97cc97c97021d316c13cbd93ee9cafd0fc384c3227dc55f4925d`；独立短测数据 `tmp/interaction-long-fixed-v2-data`，静音、伪麦克风，CPU ASR。相关短测实例已回收，不接触 Core/TTS/tunnel。

| 验证 | 证据 | 结果/限制 |
| --- | --- | --- |
| 145/500 字完整请求 | `long-speech-verification.local.json`：30.00s /104.32s PCM；首声 928.5/851.1ms；合成 27.22/101.49s；RTF 0.91/0.97 | 欠供 0；500 字跨过原 90 秒总时限；结束后待机闭嘴；长文取消和立即替换通过 |
| 末句未被裁掉 | `gguf-tail-verification.local.json`：上述两条固定 TTS PCM 尾部 12 秒，重采样后 Whisper CPU 识别；两条均检测到“蓝色大鱼”及“明天” | 固定合成内容的末句关键词证据；不保存 PCM/识别文字，不等于逐字完整或真人音质通过 |
| 十句回归 | `verification.local.json`：首声 713.2–838.3ms，RTF 0.57–0.79 | 静音软件链路，欠供 0；多实例并发负载下测得 |
| 身体回归 | `avatar-verification.local.json`：9 个表情切换、4 个动作、模拟点拖、口型/取消；`avatar-stress-verification.local.json`：200 次切换 | 错误 0、约 58.4fps、结束动作/表情队列各 1；不能替代真实桌面观察 |
| 生命周期加强 | `lifecycle-verification.local.json`：五个并发麦克风请求、模拟挂起恢复、隐藏显示、ASR/renderer 重启、重载后表情参数 | 通过；使用静音 fake device，不等于实际休眠/拔插 |
| 30fps 原身体回归 | `tmp/interaction-fps30-data/avatar-verification.local.json`，body/bundle 未变；同样 9 表情/4 动作/点拖/取消，约 29.5fps | 对应前一 buildId 的身体降级证据；不混作新版 TTS 证据 |
| 分段边界/构建 | Python 3/3（500 字无标点、分句、Unicode/空白完整保留）、Node 11/11、438 modules 构建、Core boundary 10 files | 通过 |
| 增量/替换回归 | stream/replacement 报告，同修复版实例 | 通过 |

旧蓝鱼 `tmp/interaction-blue-final-data` 在约 29 分钟后主动终止并标记 `stopped-for-long-speech-and-reload-fix`；此前采样和表现轮换无失败，但不能算 8 小时。原 Shizuku 历史长测独立保留，也不能替代修复版。

修复版重新开始真实 8 小时：本机数据 `tmp/interaction-blue-overnight-data`，静态 bundle `tmp/interaction-blue-overnight-dist`；runtime PID 22520，monitor PID 6776，endurance PID 17500。开始 **2026-10-22 23:33:39 北京时间**，预计 **10-23 07:33:39** 结束。静音最终输出、Chromium fake device 循环固定 fixture，不访问真人麦克风。约每分钟轮换动作/表情，持续经过 VAD/ASR；每 15 轮暂关伪麦克风进行固定 TTS 完成/取消测试后恢复。endurance 另记 ASR 请求计数，此测试不作“毫不中断的真人监听”证据，也不决定产品主动性。

当前长测仍在真实计时；不能标整体验收完成。明天等用户主动发“开始真人验收”再验证实声/插话与桌面操作；夜间没有请求用户回复或操作。

## 2026-10-22 夜间审计补充

再次视觉复查同修复版的 6 张 renderer 表情图，生成本机 `tmp/interaction-long-fixed-v2-data/expression-contact-sheet.png`；sad 的闭眼低头、excited 的张嘴、puzzled 的左右眼差异可见。neutral/happy/relaxed 在原 idle 笑眼阶段非常接近。原资源 `relax.exp3.json` 全部为 Add 0，实际是恒等操作；加载/切换成功不代表存在独立的放松表情。`inspect-avatar.mjs` 增加表情参数效果审计，蓝鱼报告 identityOnlyExpressions=[relax]；资源及模型指纹未变。没有改模型、贴图或造新表情。

新增 `audit-soak.mjs` 独立审计原始数据：时间窗、采样间隔、uptime 与 PID/build 连续性、重复音频资源、渲染/合成/恢复事件、进程内存与一小时之后的斜率。当前运行与旧终止片段均正确判为 incomplete；5 个审计回归通过，包含伪造 finished 的短片段、采样缺口、uptime 重置、后期内存增长、worker 进程树变化/错误 runtime PID，不会自动声称无泄漏或真实硬件通过。

补充采样 `sample-processes.mjs` PID 7680，**23:46:13 北京时间**开始，跟随新版 soak 至 07:33:39；实际全进程树的创建时间、私有内存、工作集、句柄和线程数保存到 `process-samples.local.jsonl`。它从第 13 分钟开始，fullSoakCoverage=false；原 soak 已从开始采集全程工作集和实际 ASR/TTS 子进程私有内存，新增采样不能冒充全程覆盖。未修改冻结运行代码和 bundle，也未重启新版 runtime。

截至补充时，运行时/soak/endurance/补充采样均通过实际进程与活跃 session 确认；新版已约 13 分钟、采样 27 次、表现轮换 12 次、ASR 完成约 100 次，失败 0，帧率约 58。上述数字是阶段快照，最终以实际 deadline 后原始文件为准。

最终完整验收仍须逐项证明：真人 10 句端到端延迟和识别、耳机/扬声器回声与真实插话、桌面显示/点拖/托盘/热键、多屏/设备/电源/登录周期，以及冻结版连续 8 小时与资源趋势。当前完成独立软件运行、可替换模型接入和合成/模拟验证；没有用这些结果替代剩余真机要求。

## 2026-10-22 修复版语音闭环回归

同冻结 buildId 的独立透明窗口、静音输出、fake-device 实例 `tmp/interaction-blue-regression-data`：十轮 AudioWorklet→VAD→Whisper CUDA→SSE 固定回复→GGUF→PCM 全部完成；endToSound 1129.6–1519.7ms、欠供 0、渲染错误 0，停止后 tracks=0/buffer=0。`synthetic-voice-verification.local.json` 只存计时、计数/长度。非真人准确率与实际声音验收。

`tmp/interaction-blue-barge-data/synthetic-barge-verification.local.json`：先播放长句，再开启含 2 秒前导静音的固定插话伪麦克风；输入触发取消在 ASR 返回之前，播放器取消确认 0.2ms，2.302 秒后返回非空 ASR；旧轮次不 completed，嘴=0、动作 idle，新短句完成，欠供 0。microphone-enable-to-cancel=2.232s 含 fixture 前导静音，不能宣称它是真人人声起点到停止余音的延迟。未保存 PCM 或识别文字，也没启用真人麦克风。

透明配置 capturePage 显示蓝鱼，alpha 范围 0–255（具体像素计数保留本机核查）；只能证明 renderer 透明背景，Windows 实际合成仍待真人观察。夜间 8 小时主实例沿用非透明配置，透明状态不混成 8 小时通过。补充 `apps/interaction/ACCEPTANCE.md` 将 software/hardware 证据及用户主动开始后的步骤逐项对齐。

已把插话 fixture 生成收进 `make-voice-fixture.ps1 -BargeIn` 并实际复现：16kHz/单声道/9.95675 秒固定音频；第二个临时实例同 buildId，取消确认仍 0.2ms、先取消后 ASR、新句完成、欠供 0。页面透明截图 575×930，alpha=0 的像素 303,309 个；不据此确认桌面实际显示。三个临时回归实例均按 endpoint PID 与完整命令行归属回收，长测原进程保留。

## 2026-10-23 默认透明窗口长测补充

非透明主长测保持原进程连续运行。为覆盖默认 transparent=true 的配置，另开同一冻结 buildId、同一 bundle、同一模型和 GGUF/DML 声音的透明窗口实例，Whisper CUDA + 循环合成输入，silentOutput=true。独立数据 `tmp/interaction-blue-transparent-data`；runtime PID 24872，soak PID 6824，endurance PID 25636，process sampler PID 22712。

透明长测 **2026-10-23 00:03:51 北京时间**开始，预计 **08:03:51**结束；补充全树私有内存/句柄采样于 00:04:11 启动，距起点约 20 秒，fullSoakCoverage=true。最初约 58.4fps、单轨/单上下文、失败 0。它仍在真实计时，不能标通过；两个不同配置的长测不拼接。透明配置的 renderer 连续运行不代替 Windows 实际合成显示、热键、托盘、多屏或真人声音验收。

启动后整机瞬时空闲物理内存约 3GiB，GPU 占用约 5927/8188MiB（含其他已在运行的实例/服务）；这些是资源余量快照，不能归为蓝鱼单实例内存或无泄漏证明。原 Shizuku 旧版本长测独立保留，未停止用户 Core/TTS/tunnel，未开启真实麦克风。

同 buildId 的 `tmp/interaction-blue-burst-data/replacement-burst-verification.local.json` 补查快速连续替换：5 轮共 55 个命令，50 个旧轮次无软件首声、5 个最终短句均完成，首声 621.5–965.3ms，欠供/渲染错误均 0。播放 drained 事件可能早于下一动画帧，验证等实际模型帧闭嘴/neutral/idle 后再判定。该实例 CPU ASR、静音、透明窗口，只运行短压力测试；按完整命令行与 endpoint PID 归属回收，没有改冻结 runtime 或重启两个蓝鱼长测。

同 buildId 的 `tmp/interaction-body-states-data/body-during-speech-verification.local.json` 补查说话中的表演：独立透明、30fps、SAPI 固定长句静音 PCM、CPU ASR、真人麦克风关闭。tap/drag 各一次后继续 speaking、恢复原 happy；连续 20 个模拟反应队列无积压；动作中取消恢复 idle/闭嘴，2.2 秒后未复活旧 speaking，后续 excited 表情仍可应用。采样口型 0.00001–0.905，最低 29.51fps、renderErrors=0、underruns=0。SAPI 取消后的 worker 重建是该降级实现的行为，不能把此条当 GGUF worker 无重启证据；原两条 GGUF 长测未动。

## 2026-10-23 模型替换审计补充

补充离线 `avatar-inventory.mjs`，由 `inspect-avatar.mjs` 调用；没有修改冻结 runtime 源文件、bundle 或两个长测进程。私有清单 `tmp/interaction-evidence/dsh-avatar-inventory.local.json` 实测 15 资源、2,580,988 bytes，原模型指纹保持 `a3c2ee30cf93781072931e365534429f3f76fe6fe1b953bdfef38d2b13ae36c3`。

| 动作 | 原素材时长 | 有嘴曲线 | 执行循环 |
| --- | --- | --- | --- |
| idle | 12.717s | 无 | true |
| speaking | 12.717s | 有 | true |
| thinking | 12.717s | 无 | true |
| thinkEnd | 1.717s | 无 | false；原素材 true，由 manifest 覆盖 |

9 个 manifest 参数均列在可选 DisplayInfo 元数据内；它不是 moc 的权威参数表，真实 mouth 仍由 renderer 校验。5 个表情名称映射存在，relaxed 唯一为恒等操作；模型 EyeBlink 有双眼，LipSync 为空且 HitAreas 为空，当前分别通过 manifest mouth 和运行时形象区域执行口型/点拖。审计列出这些事实与覆盖，不把资源加载成功当作独立可见表情。

审计回归 3/3：能区分 Add 0/Multiply 1 与有效的 Overwrite 0，检测错误表情名称/动作索引，保留可选元数据缺失的 unknown，并列出旧式随机动作组的全部选择。蓝鱼实际清单通过。两个 live `/health` 再查同 buildId，约 58.3/58.4fps、单轨/单上下文、欠供/渲染错误 0；这仍是未到截止的阶段性观察，不是 8 小时验收结论。

长测审计另补每个进程的按小时 min/median/max、覆盖分钟、后半段斜率及补充采样起点/终点覆盖，便于完整长测后人工区分预热、周期波动与持续增长。补充采样缺口超过 90 秒列为问题；私有内存/句柄增长也进入 memoryAssessment，避免只有工作集增长才提醒复查。审计回归扩大到 7/7，包含工作集稳定但私有内存/句柄增长和补充采样中断的反例。实际两条 live 数据审计均仍 incomplete、problems=[]；运行时和原采样器未修改。

## 2026-10-23 表情跨循环与隐藏恢复

同一冻结 buildId 的隔离实例 `tmp/interaction-avatar-loops-data`，30fps、透明窗口、CPU ASR/SAPI、autoListen=false、silentOutput=true；只发身体/固定隐藏显示诊断命令，没有开启麦克风或发声。`verify-avatar-loops.mjs` 实测 happy/excited/puzzled/sad 各 28.7–28.8 秒、109 次模型取样，共 436 次，跨两个 12.717 秒动作周期；表情名称/动作索引持续正确，队列无积压，最低 29.38fps、renderErrors=0。happy 笑眼 >0.8、excited 嘴 >0.8、sad 角度Y <-20 在整个采样窗口保持；puzzled 在 thinking 动作中保持原表情应用，不声称任意帧都有强烈视觉区分。

thinkEnd 一次结束后回 idle，2.2 秒后仍 idle；happy 保留。模拟隐藏后 9.96fps，保持 13 秒跨动作周期后表情仍在；显示后恢复 29fps。整个测试 Electron 进程集合未变，末态 neutral/idle/嘴0/音轨0。报告 `avatar-loop-verification.local.json`；表情对照与脸部裁图保留该本机目录，目视复查 excited 张嘴开眼、sad 低头闭眼。happy 和 puzzled 在当前基础动作的笑眼阶段视觉相近，是素材叠加限制。该证据仍不证明 Windows 合成或真实点拖。

临时 runtime PID 26324 已经完整命令行和数据目录验证，连同 10 个子进程回收；再查进程不存在。两条原蓝鱼 runtime/soak/endurance/process sampler 仍保持原 PID/创建时间，未覆盖 bundle 或修改冻结 runtime。

长测审计补 `hourlyPerformance` 分别汇总 ASR、VAD→识别、合成首包、软件首声/取消确认、RTF/fps，缺测保留 count=0/null，不把主/renderer ASR 双计。8/8 审计回归通过。阶段性首小时主实例 ASR 511 次、89.18–555.58ms，中位 344.98ms；软件首声 4 次、737.6–826.8ms，RTF 2 次、0.44–0.45，帧率最低 58.26。透明实例当时首声 3 次、586.6–953.2ms。主后续第 1 小时尚不足完整时段，不能从少量 TTS 样本断言长期速度稳定。长测固定 TTS 与循环合成输入未连接回复，endToSound 不存在；不混作合成十轮闭环或真人声音证据。

## 2026-10-23 SAPI 长语音降级缺陷与待应用修复

**当前冻结源码仍未修复此项。** SAPI 保留30秒总超时，500字固定worker带实时PCM背压复现：30.48秒返回worker closed，仅接收25.1895秒PCM。原始 `tmp/interaction-evidence/sapi-long-probe.local.json`。没有物理输出或真人音频。

为保留两条原GGUF长测的源码/版本连续性，候选仅复制到忽略目录 `tmp/interaction-sapi-progress-candidate`，补丁与4个机制回归保留在 `apps/interaction/pending/sapi-progress`。候选改90秒无进展超时，PCM/ACK续期、失败清监听器及立即停止worker；取消丢待播PCM。4/4通过（持续推进超过30/90秒总时限、真实停滞、取消/替换、ACK失败），原Windows SAPI取消回归1/1通过。500字worker实测122.4945秒PCM、145.91秒完成，RTF包含人为逐块等待，不当作纯合成性能。

完整候选buildId `a46ecc9bc3cc331f86825bbbecdc5424c9c9abc4b34d4b0d7905753a67be76cc`；数据 `tmp/interaction-sapi-progress-runtime-data`，同冻结renderer、透明30fps、CPU ASR、SAPI、silentOutput=true/autoListen=false。145/500字输出37.69/130.40秒PCM，软件首声205.9/133.4ms、RTF0.91/0.97、欠供0；长文取消/替换通过，末态buffer0/idle/嘴0/轨0/错误0。临时runtime PID21848及10子进程归属核查后回收。最初误用冻结入口的未执行测试实例PID26772也已回收，不作为候选证据。

补丁收紧为92行实际修改上下文，在当前LF源码/Windows Git自动换行配置下 `git apply --check --ignore-space-change` 和 `git -c core.autocrlf=false apply --check` 通过，但尚未应用到交付源码。原两条GGUF long soak仍旧build/PID连续运行，当前约1.6/1.1小时、失败0；不是8小时结论。必须在原长测结束审阅并保留后应用修复、记录新build并完成必要复验，不能将旧GGUF长测或候选短测称为最终新版全天候证明。

“持续进展超过总时限”回归在冻结源码实测失败、候选通过，确认能检测缺陷。清理后旧临时PID26772被Windows新svchost进程复用（新创建01:10:08，原测试endpoint01:04:37），未对复用后的系统进程操作；候选PID21848已不存在。停止判断以完整命令行/创建时间归属为准，不只看编号。

修复候选独立8小时长测于**2026-10-23 01:16:13北京时间**启动，截止**09:16:13**；数据 `tmp/interaction-sapi-progress-soak-data`，runtime25784、soak17656、endurance29420、process sampler6360，session分别83505/32531/97255/70576。同候选build、透明30fps、Whisper CPU int8（4线程）、SAPI、循环合成输入/静音输出；补充全树采样从01:16:33启动，fullSoakCoverage=true。最初约29.3fps、单轨/单上下文，soak/endurance失败0；只是阶段观察。

启动后空闲物理内存约2.44GiB，原GGUF两实例仍约58fps、采样检查无问题；这个快照不代表长期资源稳定。SAPI固定取消使worker主动关闭，主线程恢复会记录worker.recovery。严格通用审计因此列出runtime_error_or_recovery_event/worker_process_tree_changed，需要到实际截止按取消负载时序、进程创建时间和全树资源审阅每次重建；不能自动视作无异常或忽略。候选长测不改原冻结源码，不替代旧GGUF两个独立长测，也不证明真人设备。
