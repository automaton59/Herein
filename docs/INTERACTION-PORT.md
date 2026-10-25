# InteractionPort

最后更新：2026-10-24

产品只有一个 C：Live2D、麦克风、VAD、ASR、TTS、口型、表情、打断都在 C 里。A 的窗口/HTTP endpoint/SSE 已退役，它的 Python worker 和音频算法作为内部模块迁到 `electron/voice/` 与 `src/voice/`，不再单独启动进程。

## 语音链路

- `src/voice/PresenceVoice.ts`：C presence 自己抓麦克风、跑 VAD、播放 PCM、驱动 `mouthOpen`。
- `electron/voice/service.ts`：主进程管理 ASR/TTS worker 子进程，`speak()` 把 PCM 通过 IPC 推给 presence。
- `electron/voice/transcriptFilter.ts`：过滤静音、短片段、Whisper 幻觉、媒体字幕和重复文本。
- Core 通过本地 `InteractionPort` 发声，不再连 A endpoint。
- 默认**不自动监听**：点 presence 的“开始听”或按 `Ctrl+Shift+Space` 进入监听；90 秒没有有效对话自动停止。
- 语音消息写入独立的 `voice` timeline，不进入聊天主 timeline；记忆仍从 voice timeline 抽取。

## 输入门禁

- PTT：presence 按钮 / `Ctrl+Shift+Space`。
- 默认关闭常驻麦克风，避免风扇、直播、系统媒体直接触发。
- ASR 返回 `noSpeechProb` / `avgLogprob` / `compressionRatio`，超阈值直接丢弃。
- 已知幻觉/字幕短语黑名单；重复 8 秒内同文本丢弃。
- VAD 阈值 0.01，`minSpeechMs` 120ms，`endSpeech` 500ms。

## 当前模式

本机默认 `HEREIN_VOICE_MODE=off`：presence 是纯文本输入、气泡和 Live2D，不启动语音。下文语音链路只在 `HEREIN_VOICE_MODE=legacy` 时使用。

语音回复的 LLM 与文字聊天分开：

- 文字聊天/Core：`private/credentials/llm.json`（API）。
- 语音即时回复：`startLocalLlm()` 生成 `.herein-data/voice/voice-llm.json`，指向本机 `llama-server` + Qwen3.5-4B。
- TTS：桌面默认调 9881 的 Qwen3-TTS 0.6B CustomVoice；`VoiceService` 只保留 ASR/SAPI worker。
- 语音消息写独立 `voice` timeline，不进入聊天。

## 契约

```ts
interface InteractionPort {
  speak(request: SpeakRequest): Promise<SpeakResult>;
  stop?(): Promise<void>;
  setPresence?(presence: PresenceState): Promise<void>;
  health?(): Promise<InteractionHealth>;
}

interface SpeakRequest {
  text: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  priority?: 'ambient' | 'normal' | 'urgent';
  interruptible?: boolean;
  source?: 'chat' | 'initiative' | 'system';
  turnId?: string;
}

interface SpeakResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}
```

## HTTP 形态（A 可实现这个，也可以进程内实现）

| Method | Path | 作用 |
|---|---|---|
| POST | `/speak` | 朗读 `SpeakRequest` |
| POST | `/stop` | 停止当前朗读 |
| POST | `/presence` | 更新在场/表情/状态 |
| GET | `/health` | A 的语音/渲染健康 |

C 启动时设置：

```powershell
$env:HEREIN_INTERACTION_URL = "http://127.0.0.1:9890"
$env:HEREIN_INTERACTION_TOKEN = "<token>"
```

## A 的 standalone runtime

A 的桌面运行时用另一套路径（`/v1/speech`、`/v1/cancel`、`/health`），并在数据目录写 `endpoint.local.json`。C 已支持直接读这个文件：

```powershell
$env:HEREIN_INTERACTION_ENDPOINT = "D:\Herein\tmp\interaction-data\endpoint.local.json"
```

- 每次请求重新读文件，A 重启后端口/token 变了也能跟上。
- `speak` 映射到 `POST /v1/speech`（`text/emotion/instruct/turnId`）；
- `stop` 映射到 `POST /v1/cancel`；
- `health` 要求 `ready && asr && tts`，缺一项就 degraded/unavailable。
- C 也会订阅 A 的 `GET /v1/events`，处理 `transcript` / `presence` / `interrupted`。

## C → A 语音对话

配置 `HEREIN_INTERACTION_ENDPOINT` 后，C 默认开启语音对话：

1. A 的 `transcript final` 进入 `VoiceConversation`；
2. C 用当前角色、时间线、记忆和人格 prompt 调模型；
3. user transcript 与 assistant 回复写入主时间线，并广播 `chat.completed`（`source:'voice'`）；
4. C 通过 A 的 `/v1/speech` 朗读回复，回传 A 的 `turnId`，用于端到端计时；
5. A 的 `interrupted` 会让 C 丢弃已过期的朗读，不再读旧回复。

关闭 / 指定角色：

```powershell
$env:HEREIN_VOICE_ENABLED = "0"          # 只做主动消息发声，不接麦克风对话
$env:HEREIN_VOICE_CHARACTER_ID = "herein-default"
```

边界：C 不保存 A 的原始音频或识别文本之外的内容；transcript 文本会作为普通 user 消息进入时间线。

## C 现在怎么用

- 主动消息写入主时间线、发 SSE、发 ntfy 后，会 best-effort 调 `InteractionPort.speak`。
- 语音对话的 assistant 回复会写入时间线并朗读；A 的 `interrupted` 会阻止过期回复继续朗读。
- 语音失败不影响时间线、推送和聊天；C 只记 warn。

## 边界

- A 不决定“要不要说、说什么”；C 把 text/emotion/voiceInstruct/priority/turnId 交给 A。
- A 负责打断、音频设备、口型、表情、渲染；C 不碰音频图。
- A 的 `speak` 必须可被打断；C 的 `source:'initiative'` 默认 `interruptible:true`。

## 实现位置

- `electron/core/interaction.ts`：`InteractionPort`、`InteractionDispatcher`、`HttpInteractionPort`、`AInteractionPort`。
- `electron/core/aInteractionSession.ts`：A `/v1/events` SSE 客户端与事件解析。
- `electron/core/voiceConversation.ts`：transcript → 模型 → 时间线 → A speech。
- `electron/core/server.ts`：`HEREIN_INTERACTION_URL` / `HEREIN_INTERACTION_ENDPOINT` 接入。
- `/v1/status` 的 `interaction` 组件显示 A 的健康（未配置为 unknown）。
- 测试：dispatcher 软失败、HTTP speak/health、A endpoint/speech/health、SSE 解析/连接、语音对话/打断、initiative `onSpoken`、Core status。
