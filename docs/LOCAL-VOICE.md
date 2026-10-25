# 语音专用本地模型（legacy / opt-in）

最后更新：2026-10-24

> 本机目前**默认关闭语音**，桌面是纯文本 + Live2D。只有显式设置
> `HEREIN_VOICE_MODE=legacy` 才会走下面这条本地语音链路；语音代码保留作为
> 开源/后续可选模块。

## 边界

- **文字聊天、主动性、记忆抽取**：Core 继续使用 `private/credentials/llm.json` 的 API。
- **语音即时回复**：`VoiceConversation` 使用 `voice-llm.json` 指向本地 Qwen3.5-4B。
- **TTS**：C 通过 HTTP 调本机 9881 的 `qwen3_tts_service.py`，模型是官方 Qwen3-TTS 0.6B CustomVoice（PyTorch bf16/CUDA）。只加载一份模型。
- **ASR**：faster-whisper small。
- 语音消息写独立 `voice` timeline，不进聊天；记忆仍从 voice timeline 抽取。

## 启动链路

```text
start-herein.cmd
  -> 9881 qwen3_tts_service（0.6B CustomVoice，单份）
  -> C 主进程
     -> startLocalLlm()：llama-server + Qwen3.5-4B-Q4_K_M
     -> VoiceService：ASR worker + HTTP TTS 客户端
     -> Core：llm.json（文字 API）
     -> C presence：麦克风/VAD/播放/口型
```

## 文件/端口

- `tmp/models/Qwen3.5-4B-Q4_K_M.gguf`
- `tmp/llama-vulkan/llama-server.exe`（或 `HEREIN_LLAMA_SERVER`）
- `http://127.0.0.1:8080/v1`，OpenAI 兼容
- `.herein-data/voice/voice-llm.json`
- `.herein-data/voice/voice-config.json`
- TTS 服务：`scripts/qwen3_tts_service.py`，`http://127.0.0.1:9881`
- TTS 模型：`tmp/models/qwen3-tts-0.6b-customvoice`
- ASR worker：`electron/voice/asr-worker.py`

## 环境变量

- `HEREIN_VOICE_LLM=api`：关闭本地语音 LLM，改走文字 API（不推荐，会烧 API）。
- `HEREIN_VOICE_LLM_MODEL`：覆盖 GGUF 路径。
- `HEREIN_LLAMA_SERVER`：覆盖 llama-server 路径。
- `HEREIN_VOICE_LLM_PORT`：默认 8080。
- `HEREIN_VOICE_LLM_CTX`：默认 4096。
- `HEREIN_VOICE_LLM_GPU_LAYERS`：默认 99。
- `HEREIN_VOICE_LLM_MAX_TOKENS`：默认 192。
- `HEREIN_VOICE_LLM_FALLBACK_API=1`：本地不可用时允许回 API；默认不 fallback。
- `HEREIN_INTERACTION_TTS_PROVIDER=qwen`：保留给 worker 路径；桌面默认走 9881 HTTP。
- `HEREIN_INTERACTION_QWEN_MODEL`：覆盖 TTS 模型路径。
- `HEREIN_VOICE_SPEAKER`：默认 `vivian`。
- `HEREIN_TTS_SERVICE=0`：不启动 9881；此时语音 TTS 不可用。默认启动。

## 显存

目标峰值：

- 4B Q4 权重 ~3.0GB
- 4K KV ~0.5GB
- Qwen3-TTS 0.6B bf16 ~1.2–1.5GB
- ASR ~0.5–0.8GB
- Live2D/Electron ~0.5GB

总计约 5.7–6.3GB。若 `nvidia-smi` 峰值超过 7.5GB，退 2B 或把 ASR 放 CPU，不要让 4B 溢出到系统 RAM。

## 降级

- 本地 LLM 未就绪：语音默认关闭，不静默回 API；仅显式 `HEREIN_VOICE_LLM_FALLBACK_API=1` 才回退。
- TTS worker 崩溃：重启 worker；连续失败降级 SAPI。
- 9881 服务不是桌面语音的默认路径。
