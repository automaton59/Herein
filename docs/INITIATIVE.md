# 主动性

最后更新：2026-10-24

## 现在有什么

- `electron/core/initiative.ts`：`InitiativeEngine` + 可独立测试的策略函数。
- 策略闸门：
  - 免打扰时段（默认 01:30–08:00，支持跨午夜；深夜仍允许低频短句）；
  - 每日主动消息上限（默认 3）；
  - 冷却（默认 90 分钟）；
  - 最小空闲（默认 20 分钟，用户刚说话不打扰）；
  - 注意力预算（默认 10；每条文本 2，连续被无视 3 次暂停）；
  - 是否有值得说的材料。
- 主动性 prompt 先注入固定人格：`persona.identity`（安全/人格核心）+ `persona.relationship` + 角色说话的称呼/形态/语气示例。主动消息必须用她自己的语气，不是通用助手。
- 输入包含最近对话、总结、经历、插件材料（`MaterialService.block()` 生成的“她刚翻到的”）、没接住的线头（open_loops），以及“她自己的生活/最近经历”。
- 主动消息可以由三类由头触发：
  - **承接**：open_loop 到期（`kind = continuation`）；
  - **插件材料**：B 站/网易云/天气的新鲜内容（`kind = share`）；
  - **单纯想说话**：没有外部材料时，允许她用自己的低风险日常/念头起头（`kind = idle_thought`），但禁止“在”“在吗”“干嘛呢”这类索取注意力的试探。
- 主动消息由 LLM 决策：返回 `{shouldSpeak, reason, message}`；默认不说。
- 决定说时：写入主时间线，`sourceConversationId = 'initiative'`，并发布 SSE `assistant.proactive`。
- Core `POST /v1/initiative/run`；桌面“系统”控制台可手动运行一次。
- 默认自动调度：嵌入式 Core 启动后 20 秒先跑一次，之后每 10 分钟检查；`HEREIN_INITIATIVE_AUTO=0` 可关闭，`HEREIN_INITIATIVE_INTERVAL_MS` 可调，`HEREIN_INITIATIVE_QUIET_START/END` 可改免打扰窗口。
- 桌面形象窗口订阅 SSE：收到 `assistant.proactive` 直接弹气泡，点击进入聊天并定位消息。
- 可选 ntfy 推送：配置 `HEREIN_NTFY_*` 后，主动消息会同时发一条“角色”通知；默认不推系统通知。
- 可选 `InteractionPort`：配置 `HEREIN_INTERACTION_URL` 后，主动消息 best-effort 交给语音层朗读；失败不影响时间线/推送。
- Android 应用内：收到 `assistant.proactive` 时显示顶部“角色：…”横幅，8 秒自动消失，点击滚到底部。
- 测试覆盖：跨午夜免打扰、用户在场、冷却、每日上限、注意力预算、模型拒绝、成功写入 + SSE、调度器 tick、ntfy 推送、InteractionPort、材料注入、open_loops 注入、人格注入。

## 后台运行与触发边界

- 调度器运行在嵌入 Core 的主进程里，不在渲染窗口里；关闭主窗口进入托管后仍继续跑。
- 触发节奏在 Core，不在插件。插件只产出材料/observation；主动性每 10 分钟读取一次材料，所以“插件出现新鲜内容”最多延迟一个 tick，不是插件直接发消息。
- 没有对话历史时不会主动起头（冷启动保护）：先由用户发起第一轮，之后才进入主动链路。
- 她主动说话时，用户可能正在忙；闸门、预算、免打扰、回执学习共同限制打扰频率。

## 现在没有什么

- A 的独立 runtime 已退役；语音链路已并入 C，A → C 的 transcript/presence/interrupted 只保留兼容入口。
- 在场信号：还没有接桌面空闲、Android 前台、通话状态；目前用“最后一条用户消息时间”近似。
- 渠道选择：目前只写主时间线 + presence/Android SSE + 可选 ntfy，不发 QQ/其他 channel。
- 真正的机会驱动（打开 App、免打扰结束、用户刚结束情绪）仍是 10 分钟轮询；没有事件总线级的 `opportunity` 触发。

## 边界

- C 决定“为什么说、什么时候说、说什么、对谁说”。
- A 负责“怎么说、用什么声音/表情说、能不能打断”。
- 插件只提供能力/材料；不自己决定主动发消息。

## 验证

- `electron/core/initiative.test.ts`：11 个测试，含人格注入、材料注入、open_loops、冷启动跳过、调度器 tick。
- `electron/core/interaction.test.ts`：3 个测试。
- `electron/core/server.test.ts`：`/v1/initiative/run` 端到端。
- 2026-10-24：`npm run test:electron` 见 [ALIVENESS-PROGRESS.md](./ALIVENESS-PROGRESS.md)。
