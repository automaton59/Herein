# 主动性与活人感：落地进度

最后更新：2026-10-24

对应设计：[ALIVENESS.md](./ALIVENESS.md) 第 10 节路线图。这里只记录已经写进代码的部分和验证证据。

## P0

| 项 | 状态 | 落点 |
|---|---|---|
| prompt v2：决策树 + 不均匀 + 气泡规则 | 完成 | `private/persona/haishixiang/prompts/chat_behavior.md` |
| few-shot 示例（14 组，含 silent / 两气泡 / 长倾诉） | 完成 | 同上「示例」段 |
| AI 味过滤器 | 完成 | `electron/core/replyStyle.ts` |
| 0–2 气泡拆分 + 延迟 | 完成 | `replyStyle.ts`；`/v1/chat` 返回 `bubbles` |
| 气泡分组与逐条出现 | 完成 | `MessageItem.tsx` 按 `bubbles` 拆分；CSS `bubble-in` |
| 文本合流/取消 | 完成 | `chat.ts`：新消息 abort 旧请求，旧 pending 用户消息保留；输入框不再禁用 |
| silent：显式请求 | 完成 | `turnDirector.ts` + `/v1/chat` 不调模型、不写 assistant 消息 |
| silent：模型自选 | 完成 | `<silent/>` 标记 |
| silent 的可见反馈 | 完成 | 「已读 · 在听」状态行 + 头像「…」角标 |
| 消息级已读回执 | 完成 | `Message.readAt`；用户消息下方「已读」 |

## P1

| 项 | 状态 | 落点 |
|---|---|---|
| TurnDirector | 完成（规则版） | `electron/core/turnDirector.ts`：silent / react / reply / elaborate；显式沉默、连续倾诉、裸确认、分析请求 |
| affect_state | 完成 | schema v13 `affect_state`；`electron/core/affect.ts`；聊天与语音 prompt 都注入 |
| 主动 v2：注意力预算 | 完成 | `attentionBudget` + 按渠道计费；预算耗尽 gate 拒绝 |
| 主动 v2：bid 记录 | 完成 | schema v13 `initiative_bids`；每次主动消息落一条 sent bid |
| 主动 v2：回执 | 完成 | 用户回消息标记 replied；24h 未回标记 ignored；连续 3 条 ignored 暂停主动 |
| 材料总线 | 完成 | `materials.ts`：B 站、网易云、天气；自动刷新 + 意图刷新 |
| open_loops | 完成 | schema v13 `open_loops`；`openLoops.ts` 抽取；主动性 prompt 承接 |
| 主动性人格注入 | 完成 | `initiative.ts` 的 `personaFor` 注入 `compilePersona` 的 identity + relationship + 称呼/语气示例；主动消息不再脱离人格 |
| 单纯想说话 | 完成 | 主动性 prompt 增加 `idle_thought` 分支；无插件材料时也可由低风险日常/念头起头 |

## P2

| 项 | 状态 | 落点 |
|---|---|---|
| 口语改写 | 完成 | `electron/core/speechStyle.ts`：去书面连接词、拆短句 |
| 分句语音 | 完成 | `VoiceConversation` 把回复拆成最多 3 段，逐段 `/v1/speech`，用 `speech.completed` 串行 |
| heardUpTo / 打断恢复 | 完成（段级） | `interrupt()` 记录被打断的段落并写入下一轮 `【刚才】` |
| backchannel | 完成（代码） | VAD start 8 秒后播「嗯」，VAD end 取消 |
| L1/L2 插话 | 完成（代码） | VAD 持续 25 秒后播「等等」；`filler:true` 走 SAPI |
| filler 库 | 部分 | 用 SAPI 兜底 `filler:true`；Qwen 预渲染音库未做 |
| 分句流式 TTS | 部分 | A 已经按 PCM 分块推流，C 按段串行；真正 token 级流式仍受 Qwen TTS 4.8s/句限制 |
| 双向 VAD 事件 | 完成 | C presence 自己采集麦克风/VAD；`PresenceVoice` 驱动口型和打断 |
| 语音全部并入 C | 完成 | A 的 ASR/TTS worker 迁到 `electron/voice/`，音频/VAD 迁到 `src/voice/`；不再启动 A 窗口/endpoint/SSE |

## 验证

- `npm run build` 通过（2026-10-24）。
- `npm run check:persona` 通过。
- `npm run test:electron`：**65 files / 300 tests passed**（2026-10-24）。
- `npm run test:interaction`：A 运行时已退役，旧的 30 个测试不再属于主链路。
- 新增测试：`replyStyle`（8）、`turnDirector`（7）、`affect`（3）、`openLoops`（3）、`speechStyle`（4）、`materials`（14）、`transcriptFilter`（5）；voiceConversation 7、server 28。

## 2026-10-24 清理与确认

- 删除了本地测试聊天记录：`messages`、会话总结、narrative、结构化记忆/事件/召回日志、affect、open_loops、initiative bids 均为 0；数据库 `VACUUM` 后不留删除页。
- 删除了开场白「在。」：不再有 `DEFAULT_OPENING_LINE`；persona 首次 seed 和每次 sync 都写空开场白，且 sync 会把旧默认「在。」清掉；聊天页空态显示“还没有消息”，不伪造角色发言。
- 确认插件后台性：Core 启动时恢复已启用插件；B 站/网易云/天气由 `MaterialService` 启动后 8 秒刷新、之后每 45 分钟刷新；QQ 是长驻 listener。插件不自己决定节奏，也不主动发消息。
- 确认人格主动性：Core 启动后 20 秒跑第一次 `initiative`，之后每 10 分钟；输入包含 persona identity/relationship、说话方式、插件材料、open_loops；输出写主时间线 + `assistant.proactive`，presence 直接弹气泡。
- 实机诊断（`HEREIN_DIAG_DIR`）：`initiative auto: on`、`materials auto: on`，8 秒后 B 站/网易云/天气刷新各执行一次；聊天页显示“还没有消息”；presence Live2D 正常在线。

## 已知限制

- P2 的「实时」仍受 Qwen TTS 约 4.8s/句限制；代码已经按段拆短，但没有预渲染音库/真正的 token 级流式。
- filler/backchannel 仍是 A 时代的策略，C presence 目前没有实现 filler 和 backchannel 计时。
- **语音默认不自动监听**：点 presence 的“开始听”或按 `Ctrl+Shift+Space`；90 秒没有有效对话自动停止。这是为了挡风扇/直播误触发。
- ASR 已关闭 faster-whisper 内部 VAD，改在主进程过滤 `noSpeechProb`/`avgLogprob`/`compressionRatio`、媒体字幕黑名单和重复文本；真实声卡/直播声还需要继续调阈值。
- 语音消息写独立 `voice` timeline，不进入聊天主 timeline；记忆仍从 voice timeline 抽取。
- **本机默认关闭语音**：`HEREIN_VOICE_MODE=off`，不再启动 ASR/TTS/本地 LLM/9881；presence 是纯文本输入 + 气泡 + Live2D 四状态，语音代码保留为 opt-in。
- 文字聊天、主动性、记忆抽取继续走 `llm.json` 的 API；聊天页仍是完整记录，presence 气泡只显示 10 秒。
- 本地 4B 语音方案已实现并验证到可运行，但因本机性能/延迟关闭；`HEREIN_VOICE_MODE=legacy` 可恢复。
