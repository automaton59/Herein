# InteractionPort

最后更新：2026-10-22

C 到 A 的最后一跳。C 负责“说什么、什么时候说”，A 负责“怎么说、用什么声音/表情说”。这份契约让两边可以独立交付。

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

## C 现在怎么用

- 主动消息写入主时间线、发 SSE、发 ntfy 后，会 best-effort 调 `InteractionPort.speak`。
- 语音失败不影响时间线、推送和聊天；C 只记 warn。
- 聊天回复暂不自动朗读；等 A 的在场/打断能力稳定后再决定是否自动播报。

## 边界

- A 不决定“要不要说、说什么”；C 把 text/emotion/voiceInstruct/priority 交给 A。
- A 负责打断、音频设备、口型、表情、渲染；C 不碰音频图。
- A 的 `speak` 必须可被打断；C 的 `source:'initiative'` 默认 `interruptible:true`。

## 实现位置

- `electron/core/interaction.ts`：`InteractionPort`、`InteractionDispatcher`、`HttpInteractionPort`。
- `electron/core/server.ts`：`HEREIN_INTERACTION_URL` 接入主动消息。
- `/v1/status` 的 `interaction` 组件显示 A 的健康（未配置为 unknown）。
- 测试：dispatcher 软失败、HTTP speak/health、initiative `onSpoken`、Core status。
