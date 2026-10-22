# 离线发送与幂等

最后更新：2026-10-22

## 现在有什么

- Android 端本地 outbox：`localStorage['herein-mobile-outbox']`。
  - 发送失败（网络/服务不可达）时，把消息留在本地，气泡显示“待发送”。
  - 头部显示“待发送 N”。
  - 恢复 `online` 事件或重新打开 App 时自动重试。
  - 本地最多保留 20 条。
- Core `/v1/chat` 支持 `clientMessageId`。
  - schema v11 `chat_idempotency` 缓存首次响应。
  - 同一 `clientMessageId` 重试时直接返回缓存，不重复调 LLM，也不重复写时间线。
- 成功补发后，Android 重新拉时间线，待发送气泡被服务端消息替换。

## 边界

- 这是**客户端 outbox**，不是服务端消息队列。Core 不可达时消息只在手机上。
- 只保证“同一条重试不重复”；如果用户手工重发相似内容，仍会产生新消息。
- 4xx 也会进 outbox，可能反复失败；后续应按错误类型区分可重试/不可重试。
- 桌面端已走增量 `/apply` + 显式删除，不再全量 prune；但桌面离线发送未接 outbox。
- QQ/其他 channel 没有 outbox。

## 验证

- `electron/core/server.test.ts`：同一 `clientMessageId` 两次请求，LLM 只调用一次，时间线只有两条消息。
- Android UI：发送失败 → 待发送；联网/重开 → 自动补发。
