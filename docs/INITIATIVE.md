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
- 可选 ntfy 推送：配置 `HEREIN_NTFY_*` 后，主动消息会同时发一条“蓝蓝”通知。
- 可选 `InteractionPort`：配置 `HEREIN_INTERACTION_URL` 后，主动消息 best-effort 交给 A 朗读；失败不影响时间线/推送。
- Android 应用内：收到 `assistant.proactive` 时显示顶部“蓝蓝：…”横幅，8 秒自动消失，点击滚到底部。
- 测试覆盖：跨午夜免打扰、用户在场、冷却、每日上限、模型拒绝、成功写入 + SSE、调度器 tick、ntfy 推送、InteractionPort。

## 现在没有什么

- A 的真实语音/渲染服务：C 的契约、HTTP adapter、env 已就绪，等 A 实现。
- 在场信号：还没有接桌面空闲、Android 前台、通话状态。
- 渠道选择：目前只写主时间线 + ntfy + InteractionPort，不发 QQ/其他 channel。

## 边界

- C 决定“为什么说、什么时候说、说什么、对谁说”。
- A 负责“怎么说、用什么声音/表情说、能不能打断”。
- 插件只提供能力/材料；不自己决定主动发消息。

## 验证

- `electron/core/initiative.test.ts`：6 个测试。
- `electron/core/interaction.test.ts`：3 个测试。
- `electron/core/server.test.ts`：`/v1/initiative/run` 端到端。
- 2026-10-22：全量测试 55 files / 218 tests passed（见 P0-PROGRESS）。
