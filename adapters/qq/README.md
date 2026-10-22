# @herein/adapter-qq

QQ 官方 Bot API 的最小客户端。只走官方 API，不用 NapCat，不碰个人 QQ 号。

## 已实现

- `getAccessToken()`：`bots.qq.com/app/getAppAccessToken`，按 `expires_in` 缓存。
- `getGateway()`：`/gateway`。
- `sendGroupMessage(groupOpenId, content, msgId?)`：被动回复群消息。
- `sendC2CMessage(openId, content, msgId?)`：被动回复私聊。
- `normalizeQQEvent()`：
  - `GROUP_MESSAGE_CREATE` / `GROUP_AT_MESSAGE_CREATE` → group observation；
  - `C2C_MESSAGE_CREATE` → dm observation；
  - audience/provenance/dedupeKey 都带上。
- `buildIdentifyPayload()`：WebSocket op 2。

## 已实现

- `QQGateway`：WebSocket 连接、identify、HELLO 心跳、`s` 序列、READY、事件分发、可选自动重连、优雅关闭。
- 单测用 fake socket 验证 identify/心跳/事件分发。

## 还没实现

- 语音接收（`voice_wav_url`）和 SILK 语音发送。
- 群模式、频控、审核、`identity_links`、被动回复 5 分钟/5 次限制。
- 需要 `private/credentials/qqbot.json` 才能实测。

## 鉴权

请求头是 `Authorization: QQBot <access_token>`，不是 Bearer。  
AppSecret 只放本机 `private/credentials/qqbot.json`，不要贴聊天。

## 边界

- 只用官方 Bot API。
- 个人主体 bot 不能公开，只能加到自己/哥们的群。
- 全量群消息需要群主在最新手机 QQ 开“接收全量消息”。
