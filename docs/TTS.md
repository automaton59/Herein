# 本地 TTS（Qwen3-TTS）

> 当前桌面默认是纯文本模式，不启动 TTS。本文保留本地语音栈的配置，供
> `HEREIN_VOICE_MODE=legacy` 或后续开源版本使用。

## 现成环境

- venv：`D:\AI\tools\qwen_tts\venv`
- Python：3.11.16
- torch：`2.11.0+cu128`，CUDA 可用，RTX 4060 Laptop
- 包：`qwen_tts` / `soundfile` / `fastapi` / `uvicorn` / `transformers`
- 模型：
  - `D:\Herein\tmp\models\qwen3-tts-0.6b-customvoice`（当前语音用，官方 PyTorch bf16）
  - `D:\Herein\tmp\models\qwen3-tts-customvoice`（1.7B，音质更好但显存/延迟更高，备选）

## 应用启动时的 TTS

桌面端默认启动 **一份** 9881 的 `qwen3_tts_service.py`，使用官方 PyTorch bf16 的 0.6B CustomVoice。C 的 `VoiceService` 通过 HTTP 调 `/tts`，拿到 WAV 后切成 PCM 交给 presence 播放和口型。

- 这样不会同时加载 9881 和 `qwen-worker` 两份 0.6B；
- speaker 由 `HEREIN_VOICE_SPEAKER` 控制，默认 `vivian`；
- 第一声要等整句合成完（0.6B 当前约数秒），不是逐 token 流式；qwen-worker 的流式路径仍保留，但不是桌面默认。

- 模型：`tmp\models\qwen3-tts-0.6b-customvoice`
- Python：`D:\AI\tools\qwen_tts\venv\Scripts\python.exe`
- 关闭 9881：`HEREIN_TTS_SERVICE=0`（此时语音 TTS 不可用）
- 覆盖：`HEREIN_VOICE_SPEAKER`、`HEREIN_TTS_MODEL`、`HEREIN_TTS_PORT`

## 启动 9881 服务（移动端/调试）

```powershell
D:\AI\tools\qwen_tts\venv\Scripts\python.exe scripts/qwen3_tts_service.py `
  --mode custom_voice `
  --model tmp/models/qwen3-tts-customvoice `
  --host 127.0.0.1 --port 9881 --device cuda:0 --no-flash-attn
```

## 0.6B 对比

`tmp/models/qwen3-tts-0.6b-customvoice`（1.8GB + speech tokenizer 682MB）实测：

```text
平均 4.87s/句，RTF 3.28
```

比 1.7B 的 4.8s/句、RTF 3.70 略快，但**首句延迟没降**；当前服务用 0.6B，省显存。

## 实测（2026-10-22）

`node scripts/benchmark_tts.mjs --runs 1 --warmup 1`

| 文本 | 延迟 | 音频 | RTF |
|---|---:|---:|---:|
| 咋啦。 | 3424ms | 0.88s | 3.89 |
| 嗯，我在。 | 7556ms | 2.08s | 3.63 |
| 你今天怎么这么晚。 | 5457ms | 1.52s | 3.59 |
| 别急，慢慢说。 | 4978ms | 1.36s | 3.66 |
| 这个不错。 | 2674ms | 0.72s | 3.71 |

- 平均延迟：**4.8s/句**
- 平均 RTF：**3.70**（>1，慢于实时）
- 这是 batch `/tts`，不是流式 TTFA。

## Core 代理与手机朗读

Core 新增 `POST /v1/tts`，转发到 `HEREIN_TTS_URL`（默认 `http://127.0.0.1:9881`），返回 `audio/wav`。

- 手机聊天里助手消息有“▶ 朗读”按钮。
- 手机 → Core `/v1/tts` → 本机 TTS 服务。
- 本地实测：`咋啦。` 38KB WAV，5.1s。
- 远端实测：`http://147.224.56.120/herein/v1/tts`，30KB WAV，3.9s。
- TTS 服务要开着；Core 默认指向 9881。

## 结论

- 1.7B CustomVoice 现在能出声、音色/情绪可用，但**通话级实时还不够**。
- 下一步优先级：
  1. 0.6B CustomVoice + `--int8`/流式 `/tts/stream`；
  2. 或 C 引擎（0.6B int8，CPU 也可能接近实时）；
  3. 先把 batch 接进语音回复，通话再等流式。
- 不切云 TTS。
