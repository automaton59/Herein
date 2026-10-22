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

也可 `npm start -- --config=<absolute-config-path>`。模型只从本机 manifest 指定的目录加载。构建产物在仓库 `tmp/interaction-dist`；不会打包或复制模型。配置模板没有真实模型或凭据。

首次点“开始监听”后会保存监听偏好；下一次运行自动监听。配置 `autoListen:true` 可用于无人值守验收。`Ctrl+Shift+Space` 显示/隐藏、`Ctrl+Shift+X` 打断、`Ctrl+Shift+M` 切换监听。关闭窗口隐藏到托盘，托盘“退出运行时”才退出。拖形象移动位置，点击触发 manifest 的 tap 动作。窗口会保存位置并在屏幕配置变化后收回可见区域。

开机启动由托盘显式切换，使用本运行时的 Electron 入口和配置路径。当前未通过真实重启验收；路径移动后需重新配置。多屏与休眠恢复有实现，仍需要相应硬件与真实电源周期验收。

## 声音与性能

- `tts.provider=sapi`：离线 Windows 中文系统声，持久 worker 输出 24kHz 单声道 PCM。作为可用性降级；音色不是正式蓝蓝，不能表达 Qwen 的情绪指令。
- `tts.provider=qwen`：独立 Python worker，不改已有 Qwen 服务和安装包。通过 scoped forward hook 获取完整 codec frame、重解码前缀、保留两帧 lookahead，提供实际增量 PCM；generation stopping criteria 可取消生成。当前 PyTorch 0.6B 实测 RTF >3，会欠供，**尚未达到实时质量**。0.6B 上游不支持 instruct；1.7B 需分别测量。
- `tts.provider=qwen-gguf`：可选本地 Vulkan llama.cpp + ONNX DirectML 路径。冻结版本的十句文本→软件首声 571–974ms、RTF 0.37–0.77，欠供 0；扬声器回环首声 924ms、停止余音 50ms。它依赖另行安装的私有推理代码、模型和 DLL；详细步骤见下文。固定 fixture 静默预热后才报告 TTS ready。不同长文本、1.7B 与模型情绪需另测，不能把十句短测当全天候通过。
- ASR：faster-whisper 离线识别，单 worker、有限请求、最长 15 秒语音；内存中处理 PCM。浏览器 AEC/降噪用于扬声器回声抑制，设备能力不等于实测通过。
- 播放：AudioWorklet 4 秒环形缓冲、主线程 3.5 秒水位与 ACK 背压；自然音色起播缓冲 240ms，SAPI 60ms。取消同时静音 gain、清空环形缓冲、丢弃过期 generation 并取消合成。
- 身体：Cubism 2/4 按 manifest 选择，口型在 `beforeModelUpdate` 写入；库原生 idle/眨眼/视线配合 manifest 参数、表情、点击/拖动动作。正式模型需要自带授权 core、贴图与动作。
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

不完整分句在标点、60 字符上限或 `end` 时进入 TTS；真正上游 LLM 延迟由 C 负责。固定回复演示是用户显式勾选的测试模式，不是主动性策略或人格实现。

## 验证与证据

从仓库根目录执行：

```powershell
node --test apps/interaction/tests/*.test.mjs
npm run check:core
node apps/interaction/verify-runtime.mjs <interaction-data-dir>
node apps/interaction/verify-stream.mjs <interaction-data-dir>
node apps/interaction/verify-replacement.mjs <interaction-data-dir>
node apps/interaction/verify-lifecycle.mjs <interaction-data-dir>
node apps/interaction/soak.mjs <interaction-data-dir> 8
```

前两项验证关键状态/缓冲/边界与真实 SAPI 取消。运行验证发出 10 句测试声音，检查首声、播放结束、取消后静音及鉴权；它**不等于真实用户麦克风 10 句验收**。增量验证检查两句播放和待播分句取消；replacement 验证生成中替换。lifecycle 需要 `diagnostics:true`，模拟挂起/恢复、隐藏/显示、ASR/renderer 故障和并发麦克风启动；不是实际休眠或设备拔插。长测保存 health、Electron 与 ASR/TTS 进程内存、总 GPU 显存、fps、音频轨/上下文/欠供、buildId；监测进程存活和最终 `soak-summary.local.json` 才能确认长测完成。

`metrics.jsonl` 只保存允许字段的计时、计数和状态，8MiB 轮转，写队列上限 256；不保存输入音频、识别文本、发声文本、任意错误消息、token 或聊天记录。辅助 benchmark 可生成**固定测试音频**到 gitignored `tmp/`。`diagnostics:true` 可启用页面截图和模拟 lifecycle 接口；截图留在本机私有验收目录，关闭时不可调用。

真实验收还需：耳机/扬声器下连续 10 句、播放中插话、静音环境误触发、切换输入输出设备、模型替换、多屏拔插、休眠唤醒和重启自启。以实际日志和观察报告为准。进度及限制见 `docs/agents/A-interaction-report.md`。
