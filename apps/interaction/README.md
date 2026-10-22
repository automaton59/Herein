# Herein interaction runtime

Agent A 的独立桌面运行时。它接收 C 的发声、文本增量和身体命令，并上报用户语音、presence、状态与打断。它不打开 Core 数据库、不装配人格或记忆、不决定主动发言，也不改桌面控制台或 Android。

## 安装与启动

需要 Windows、仓库根目录的 Node/Electron/Pixi/Vite 依赖、本地 faster-whisper 环境与离线模型。GPU ASR 需要匹配的 CUDA/cuDNN DLL；CPU 可用 `int8`，延迟需另测。

```powershell
cd <checkout>\apps\interaction
npm ci --ignore-scripts --legacy-peer-deps
npm run build
# 从 config.example.json 和 avatar.example.json 创建自己的 *.local.json。
$env:HEREIN_INTERACTION_CONFIG = '<absolute-path>\interaction-config.local.json'
$env:HEREIN_INTERACTION_DATA_DIR = '<absolute-path>\temporary-interaction-data'
npm start
```

也可 `npm start -- --config=<absolute-config-path>`。模型只从本机 manifest 指定的目录加载。构建产物在仓库 `tmp/interaction-dist`；不会打包或复制模型。配置模板没有真实模型或凭据。并行验证可用 `node apps/interaction/build.mjs --out-dir=tmp/<isolated-dist>`，在本地配置设置绝对 `rendererDir`，避免覆盖长测版本的静态资源。`silentOutput:true` 保持 PCM/口型链路运行但将最终输出 gain 设为 0；这种验证不证明扬声器发声。

首次点“开始监听”后会保存监听偏好；下一次运行自动监听。配置 `autoListen:true` 可用于无人值守验收。`Ctrl+Shift+Space` 显示/隐藏、`Ctrl+Shift+X` 打断、`Ctrl+Shift+M` 切换监听。关闭窗口隐藏到托盘，托盘“退出运行时”才退出。拖形象移动位置，点击触发 manifest 的 tap 动作。窗口会保存位置并在屏幕配置变化后收回可见区域。

开机启动由托盘显式切换，使用本运行时的 Electron 入口和配置路径。当前未通过真实重启验收；路径移动后需重新配置。多屏与休眠恢复有实现，仍需要相应硬件与真实电源周期验收。

## 声音与性能

- `tts.provider=sapi`：离线 Windows 中文系统声，持久 worker 输出 24kHz 单声道 PCM。作为可用性降级；音色不是正式蓝蓝，不能表达 Qwen 的情绪指令。
- `tts.provider=qwen`：独立 Python worker，不改已有 Qwen 服务和安装包。通过 scoped forward hook 获取完整 codec frame、重解码前缀、保留两帧 lookahead，提供实际增量 PCM；generation stopping criteria 可取消生成。当前 PyTorch 0.6B 实测 RTF >3，会欠供，**尚未达到实时质量**。0.6B 上游不支持 instruct；1.7B 需分别测量。
- `tts.provider=qwen-gguf`：可选本地 Vulkan llama.cpp + ONNX DirectML 路径。冻结版本的十句文本→软件首声 571–974ms、RTF 0.37–0.77，欠供 0；扬声器回环首声 924ms、停止余音 50ms。它依赖另行安装的私有推理代码、模型和 DLL；详细步骤见下文。固定 fixture 静默预热后才报告 TTS ready。不同长文本、1.7B 与模型情绪需另测，不能把十句短测当全天候通过。
- ASR：faster-whisper 离线识别，单 worker、有限请求、最长 15 秒语音；内存中处理 PCM。浏览器 AEC/降噪用于扬声器回声抑制，设备能力不等于实测通过。
- 播放：AudioWorklet 4 秒环形缓冲、主线程 3.5 秒水位与 ACK 背压；自然音色起播缓冲 240ms，SAPI 60ms。取消同时静音 gain、清空环形缓冲、丢弃过期 generation 并取消合成。
- 身体：Cubism 2/4 按 manifest 选择，确定动作索引、循环/单次动作和执行状态映射；动作预加载，PCM 开合平滑，取消立即闭嘴；待机表情的嘴不被 PCM 覆盖。点击与拖动分开触发，单次反应后回到当前执行状态；指针离开后视线回中。正式模型需要自带授权 core、贴图与动作。
- 显示时 60fps，手工可降至 30fps；隐藏时 10fps。实际帧率记录在 metrics。禁用 Electron 遮挡节流以保持桌面在场。

## 本机接口

只绑定 `127.0.0.1`，默认随机临时端口；不会启动或停止 Core/TTS/tunnel。启动后在独立数据目录生成 `endpoint.local.json`（URL、每次随机 token、PID、启动时间），C 读取该文件发现运行时。除 renderer/模型静态资源外，请求带 `Authorization: Bearer <token>`。不应将 endpoint 文件提交或转发。

| 方法与路径           | 内容                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `GET /health`        | runtime/ASR/TTS 就绪、播放与渲染指标、进程内存                                             |
| `GET /v1/events`     | SSE；`transcript`、`presence`、`interrupted`；最多 8 个连接                                |
| `POST /v1/speech`    | `{text,emotion?,instruct?,turnId?}`；替换当前发声；text ≤500 字符                          |
| `POST /v1/cancel`    | `{}`；取消当前合成、播放、待播文本                                                         |
| `POST /v1/text`      | `{op,turnId,text?,emotion?}`；op 为 begin/delta/end；单轮累计 ≤500 字符，最多 8 个待播分句 |
| `POST /v1/avatar`    | `{emotion?,motion?}`；motion 是 manifest 中的键                                            |
| `POST /v1/listening` | `{enabled:boolean}`；启动/暂停持续监听                                                     |

`transcript` 内容 `{type:"transcript",text,final:true,generation,turnId}`。C 自行选择是否回复与回复内容，将 `turnId` 回传给 speech/text 命令；运行时据此记录用户停止说话到首个非静音输出采样的延迟。文本在 SSE 内存传递，默认不落盘。`begin` 替换当前轮次；过期 turn 的 delta/end 被忽略。C 应等待 ASR/TTS ready，维护自己的重连与主动性策略。

`health`/endpoint 带 `apiVersion:1` 与 `buildId`。长测必须匹配同一 buildId；`ready` 表示 renderer 接口已启动，C 还需检查 `asr`、`tts`。`POST /v1/speech` 返回接收的 generation，发声是异步的；SSE `speech.started`、`speech.completed`（合成完成，播放器可能仍有缓冲）、`speech.failed` 带 generation/turnId，错误只给固定类别。重启 token/port 变化，必须重新读 endpoint。

`avatarReady` 在模型完成加载后才为 true；模型配置错误时 renderer 仍可运行，但 avatarReady=false、renderErrors>0，C 与长测应检查该字段。neutral 取消额外表情立即清掉淡出队列；新 emotion 命令在 interrupted 状态也能正常显示。

`avatar` 的 emotion/motion 必须存在于当前 manifest，否则 400；只传 motion 会保留表情。身体按实际 ASR/TTS/播放状态执行 thinking/speaking/idle，发声完成或取消后恢复中性。C 仍决定表达内容与情绪，也可显式传动作命令。

## 可替换身体与蓝鱼技术验证

用户指定的 [dsh-live2d](https://github.com/lrplrplrp/dsh-live2d) 提交 `1ba6522a18408716a5c71a81575503ddad9b96be` 包含 Cubism 4 蓝鱼模型。它只用来跑通技术路线和积累经验，后续会替换。无需安装 DSH 插件；把 checkout 放在本机 `private/` 或 gitignored `tmp/`，从 `avatar.dsh.example.json` 创建自己的 manifest，并将 root 改为 checkout 的绝对路径。项目标注 MIT；checkout 中 Cubism Core 文件头另列 Live2D 专有许可，保留原许可。模型、贴图、core 与原始截图均不纳入提交或打包。

manifest 的 `motions` 兼容旧字符串组名，也可使用 `{group,index,loop}`。例如 `thinking:{group:"Anima",index:2,loop:true}` 与 `speaking:{group:"Anima",index:0,loop:true}` 共享组但固定不同索引；`thinkEnd` 使用 index 1、loop false。`states` 将运行状态映射到动作键；`interactions` 配置 tap/drag 的 `{motion,emotion?}`；`expressions` 的 `neutral:null` 表示恢复默认表情，其他值为模型中的表情名。不同模型只调整 manifest 和本地资源。

蓝鱼已有 happy/happy2/puzzled/relax/unhappy 5 个表情、idle/speak/thinking/thinkend 4 个动作。映射 happy/excited/puzzled/relaxed/sad；不编造模型没有的表情。原待机动作前几秒本身有笑眼/微笑，neutral 是去掉额外表情后恢复该模型原待机；不能用笑眼参数必须为 0 验收。嘴部在 motion 更新前清零，防止前动作缺失嘴部曲线时留下半张嘴；表情随后贡献、PCM 只在实际说话时最后覆盖。淡出表情队列最多 4，连续指令只保留最新待应用表情。

资源复查显示原 `relax.exp3.json` 的参数全部为 Add 0，它是恒等操作，不能声称 relaxed 有独立可见效果。happy/puzzled/excited/sad 有实际参数变化；neutral 与 happy 在 idle 的笑眼阶段可能相近。保留原素材，后续换模型由 manifest 映射新的表情。`inspect-avatar.mjs` 的本地报告包含 `expressionEffects` 和 `identityOnly`，帮助区分加载成功与实际表达能力。

替换模型时同一离线审计还会检查 expression 名称、motion 组和索引，列出动作时长、原循环标记/manifest 覆盖、嘴/眼曲线、EyeBlink/LipSync 组与命中区域。蓝鱼 idle/speaking/thinking 各 12.717 秒、thinkEnd 1.717 秒；除 speaking 外的动作没有嘴曲线，因此切换前清嘴与 PCM 驱动有必要。该模型 LipSync 组为空且没有 HitAreas；当前口型通过 manifest 的 mouth 参数，点拖以运行时形象区域处理。DisplayInfo 只作可选元数据参考，不能代替 renderer 对 moc 真实参数的验证。审计不改变资源或运行时，也不保证新素材的主观表演质量。

`inspect-avatar.mjs <local-manifest> <local-report>` 检查模型引用的资源与路径边界，并给出本地 SHA-256 指纹。`verify-avatar.mjs <data-dir>` 验证 9 次表情切换/复位、4 个动作索引、模拟 tap/drag、视线回中和 PCM 口型/取消；`verify-avatar-stress.mjs <data-dir>` 验证 200 次快速切换与队列回收。它们需要 diagnostics，模拟反应不代替实际 Windows 点按/拖动验收。演示窗口提供表情/动作选择与恢复待机按钮。

先启动 `soak.mjs <data-dir> 8` 后，可另跑 `endurance.mjs <data-dir> <local-config>`。它必须使用 silentOutput=true/diagnostics=true 的独立配置，按同一 soak deadline 运行，每分钟轮换模型动作/表情并检查复位，每 15 轮测试固定静音发声、交替取消。它是一段验收负载脚本，不是运行时的主动性策略。计数与状态留在 `endurance-summary.local.json`，是否真正完成仍看实际 deadline、失败和进程趋势。

如独立实例通过 Chromium `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<fixed-fixture.wav>` 循环合成输入，并设 autoListen=true，可给 endurance 加 `--synthetic-input`：保持伪麦克风监听、统计 ASR 请求，固定发声测试期间暂时关伪麦克风以免下段 fixture 干扰，随后恢复。该标志仅适用于确认使用假音频设备的隔离实例，不能用于真人麦克风或声称真实连续监听通过。

`diagnostics:true` 时，鉴权 `GET /v1/diagnostics/avatar` 读取当帧模型参数、动作索引、表情与队列；`POST` 同路径只接受 tap/drag/focus/center 四个固定诊断动作，明确标记 simulated。没有启用任意 renderer 脚本接口。

## 私有 GGUF 环境复现

运行时只提供适配代码，不分发第三方推理包、DLL 或模型。已测试 [Qwen3-TTS-GGUF](https://github.com/HaujetZhao/Qwen3-TTS-GGUF) 提交 `74feb581bc8cefb835fc608107e857036d7580a1`（MIT）及 [llama.cpp b10621](https://github.com/ggml-org/llama.cpp/releases/tag/b10621) Windows Vulkan。上游 ctypes ABI 与这个 llama.cpp 版本绑定，不宜随意混版本。保留各自许可证；模型和 Cubism core 许可另行遵守。

在独立、gitignored 目录准备上游 checkout。将 b10621 Vulkan 发布包中的 llama/ggml DLL 和 `llama-quantize.exe` 放到上游 `qwen3_tts_gguf/inference/bin`。使用自己的 Python 3.11 环境；转换需要 torch/CUDA、safetensors、transformers、gguf、sentencepiece、onnx、onnxscript、onnxruntime-directml。运行 worker 需要 numpy、tokenizers、sounddevice 与 onnxruntime-directml。可把额外包安装到私有 `--target` 目录，通过 `ggufDependencies` 设置；多个目录使用 Windows 分号分隔。不改变用户正在用的 venv。

已有本地 0.6B CustomVoice 后运行（不下载模型）：

```powershell
python -X utf8 apps/interaction/export-gguf.py `
  --source '<private-upstream-checkout>' `
  --model '<existing-0.6B-CustomVoice-folder>' `
  --output '<new-empty-private-export-folder>' `
  --dependencies '<private-extra-python-packages>'
```

转换输出 talker q5_k、predictor q8_0、状态化 decoder fp16、tokenizer 和 embeddings。配置 `qwenModel` 指向输出目录、`qwenPython` 指向自己的 Python、`ggufSource` 指向上游 checkout、`ggufDependencies` 指向额外包目录、`ggufDecoder:"DML"`。`--resume-decoder` 只重跑 decoder 导出/精度转换。8GB 显存机器建议 0.6B；1.7B 未验证。CUDA/CPU decoder 保留可选，但本机比较未优于 DirectML。

GGUF worker 在导入上游前禁用其文件日志；只在内存保留 PCM 和当轮上下文。取消在 codec frame 边界停止计算，播放器立即清空。下一句等待前一轮计算退出，防止同一 context 并发使用。固定种子用于可复现验收，声音偏好的调整由后续产品配置处理。

单次 speech 仍接受至 500 字符。GGUF 先按句末或邻近分句标点切成最多 60 字的有界片段，在同一 generation 下连续输出 PCM；取消会停止剩余片段。每片段的生成预算为 max(300, 字符数×15) 帧；触顶作为失败上报，避免把截断音频标成成功。worker 使用 90 秒无进展超时，持续生成/播放的长内容不受 90 秒总时限截断。长文中每段声线衔接的主观质量仍需真人听测。

不完整分句在标点、60 字符上限或 `end` 时进入 TTS；真正上游 LLM 延迟由 C 负责。固定回复演示是用户显式勾选的测试模式，不是主动性策略或人格实现。

## 验证与证据

从仓库根目录执行：

```powershell
node --test apps/interaction/tests/*.test.mjs
npm run check:core
node apps/interaction/verify-runtime.mjs <interaction-data-dir>
node apps/interaction/verify-stream.mjs <interaction-data-dir>
node apps/interaction/verify-replacement.mjs <interaction-data-dir>
node apps/interaction/verify-replacement-burst.mjs <isolated-silent-data-dir>
node apps/interaction/verify-long-speech.mjs <interaction-data-dir>
node apps/interaction/verify-lifecycle.mjs <interaction-data-dir>
node apps/interaction/soak.mjs <interaction-data-dir> 8
node apps/interaction/sample-processes.mjs <interaction-data-dir>
# 等真实 deadline 到达后，审计原始采样，不以 summary.status 单独判断通过。
node apps/interaction/audit-soak.mjs <interaction-data-dir> --require-finished
```

前两项验证关键状态/缓冲/边界与真实 SAPI 取消。运行验证发出 10 句测试声音，检查首声、播放结束、取消后静音及鉴权；它**不等于真实用户麦克风 10 句验收**。增量验证检查两句播放和待播分句取消；replacement 验证生成中替换。lifecycle 需要 `diagnostics:true`，模拟挂起/恢复、隐藏/显示、ASR/renderer 故障和并发麦克风启动；不是实际休眠或设备拔插。长测保存 health、Electron 与 ASR/TTS 进程内存、总 GPU 显存、fps、音频轨/上下文/欠供、buildId；监测进程存活和最终 `soak-summary.local.json` 才能确认长测完成。

`verify-long-speech.mjs` 需要 diagnostics；检查固定 145/500 字语音的 PCM 时长、超过原 24 秒上限后的持续生成、欠供、结束复位、长文取消与替换。它不保存 PCM，不证明文字逐字完整或实际扬声器音质。Python 分段回归可用 `python -B -m unittest discover -s apps/interaction/tests -p 'test_*.py'`；不需要模型。

`sample-processes.mjs` 作为独立采样器运行至同一 soak deadline；确认 runtime 命令行属于该数据目录，收集实际全进程树的私有内存、工作集、句柄、线程和创建时间，不保存命令行或配置。它不会重启运行时。`audit-soak.mjs` 检查 8 小时时间窗、采样缺口、uptime/PID/build 连续性、音频资源、渲染与恢复错误，并汇总一小时预热后的内存斜率；每小时大于 10MiB 的增长列为复查项，不据此自动断定泄漏。审计通过后仍须人工审阅趋势及完成真实硬件验收。

审计的每个进程带 `hourlyWindows`（按起点小时的 min/median/max、样本数和覆盖分钟）与预热后时间窗后半段的斜率，帮助检查增长是否趋稳。补充采样单独报告起点/截止覆盖与采样缺口，超过 90 秒的缺口列为问题；句柄或私有内存增长即使未反映在工作集也会列入人工复查。单个小时仍可能含预热或活动波动，斜率/统计不自动作泄漏结论。

`metrics.jsonl` 只保存允许字段的计时、计数和状态，8MiB 轮转，写队列上限 256；不保存输入音频、识别文本、发声文本、任意错误消息、token 或聊天记录。辅助 benchmark 可生成**固定测试音频**到 gitignored `tmp/`。`diagnostics:true` 可启用页面截图和模拟 lifecycle 接口；截图留在本机私有验收目录，关闭时不可调用。

合成麦克风链路可用 `make-voice-fixture.ps1 -Output <gitignored-fixture.wav>` 生成十句固定 SAPI 音频，再用 Electron 的 `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<absolute-fixture.wav>%noloop` 启动独立临时运行时，配置 autoListen false、silentOutput true。立即启动 `verify-synthetic-voice.mjs <data-dir>`：先订阅 SSE、等待 worker ready，再开启伪麦克风，固定回复“听到了。”并关联 turnId；保存计时/计数，不存识别文字。它证明 AudioWorklet→VAD→ASR→SSE→TTS→PCM 的合成输入闭环，不证明真人准确率、AEC 或物理扬声器首声。

真实验收还需：耳机/扬声器下连续 10 句、播放中插话、静音环境误触发、切换输入输出设备、模型替换、多屏拔插、休眠唤醒和重启自启。以实际日志和观察报告为准。进度及限制见 `docs/agents/A-interaction-report.md`。

逐项验收顺序与现有/缺失证据见 [ACCEPTANCE.md](./ACCEPTANCE.md)。`verify-synthetic-barge.mjs <data-dir>` 使用 fresh autoListen=false 的静音 fake-device 实例：先播放固定长句，开启含前导静音/固定插话的伪麦克风，确认取消先于 ASR 完成、闭嘴回 idle、旧轮次不 completed、新句能播放。报告的 microphone-enable-to-cancel 包含 fixture 前导静音，不是实际人声起点到余音停止时间。

插话 fixture 可运行 `powershell -NoProfile -File apps/interaction/make-voice-fixture.ps1 -Output <gitignored-barge.wav> -BargeIn`；它含 2 秒静音、一句固定 SAPI 输入、6 秒尾部静音。启动独立实例时通过 `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<absolute-fixture.wav>%noloop` 指定它，再运行插话 verifier。输出配置必须 silentOutput=true，不能在夜间真人麦克风实例上运行。

`verify-replacement-burst.mjs` 在独立静音、autoListen=false 的实例中串行发出 5 轮、每轮 10 次立即替换与 1 个最终短句。按 generation 核查只有最终轮次产生软件首声，旧轮次不复活、无欠供、模型在实际动画帧后闭嘴回 idle。它会替换当前声音，不能对正在进行的长测或真人实例运行。

`verify-body-during-speech.mjs <isolated-silent-data-dir>` 在固定长句 PCM 播放期间模拟 tap/drag，检查一次性反应结束后回到 speaking、恢复原表情、口型继续变化；连续 20 次反应后在动作中取消，确认旧动作结束事件不再恢复说话。30fps 可用配置单独验证；该脚本需要 diagnostics，不能对正在长测的实例运行，也不证明真实鼠标点拖。
