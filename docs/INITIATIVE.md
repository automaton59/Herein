# 主动性

最后更新：2026-10-22

## 现在有什么

- `electron/core/initiative.ts`：`InitiativeEngine` + 可独立测试的策略函数。
- 策略闸门：
  - 免打扰时段（默认 23:30–08:00，支持跨午夜）；
  - 每日主动消息上限（默认 3）；
  - 冷却（默认 90 分钟）；
  - 最小空闲（默认 20 分钟，用户刚说话不打扰）；
  - 是否有值得说的材料。
- 主动消息由 LLM 决策：返回 `{shouldSpeak, reason, message}`；默认不说。
- 决定说时：写入主时间线，`sourceConversationId = 'initiative'`，并发布 SSE `assistant.proactive`。
- Core `POST /v1/initiative/run`；桌面“系统”控制台可手动运行一次。
- 可选自动调度：`HEREIN_INITIATIVE_AUTO=1` 开启，默认每 30 分钟检查一次；`HEREIN_INITIATIVE_INTERVAL_MS` 可调。
- 测试覆盖：跨午夜免打扰、用户在场、冷却、每日上限、模型拒绝、成功写入 + SSE、调度器 tick。

## 现在没有什么

- A 的 `InteractionPort`：还没有把主动消息变成桌面语音/口播；当前只写时间线 + SSE。
- 推送：还没有把主动消息接到 ntfy/Android 通知。
- 在场信号：还没有接桌面空闲、Android 前台、通话状态。
- 渠道选择：目前只写主时间线，不发 QQ/其他 channel。

## 边界

- C 决定“为什么说、什么时候说、说什么、对谁说”。
- A 负责“怎么说、用什么声音/表情说、能不能打断”。
- 插件只提供能力/材料；不自己决定主动发消息。

## 验证

- `electron/core/initiative.test.ts`：5 个测试。
- `electron/core/server.test.ts`：`/v1/initiative/run` 端到端。
- 2026-10-22：全量测试 53 files / 208 tests passed（见 P0-PROGRESS）。
