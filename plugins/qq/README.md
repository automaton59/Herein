# QQ Bot

QQ 官方机器人通道：接收全量群消息和私聊消息，可选被动回复。

## 配置

| 字段 | 说明 |
|---|---|
| `configPath` | 凭据 JSON 文件路径。留空时按 `<用户数据目录>/qqbot.json` 找 |
| `autoReply` | 开启后把 @ 消息交给此间的人格生成回复；关闭只接收不回复 |

凭据文件内容：

```json
{ "appId": "...", "appSecret": "..." }
```

在 QQ 开放平台 → 你的机器人 → 开发设置里拿。**AppSecret 等同密码**，泄露后去平台重置。

## 它管什么、不管什么

这个插件只负责协议层：连网关、收消息、发消息。它把收到的每条消息交给 Core，由 Core 落库、决定要不要回复、用哪个人格和模型生成回复。插件自己不碰数据库，也不知道你的 API key。

回复是「被动回复」：必须带着收到的 `msg_id`，在消息发出后一定时间内回复才有效，这是 QQ 官方平台的限制。

## 动作

| action | 说明 |
|---|---|
| `status` | `{ "running": true, "error": null }` |
| `send` | `{ "conversationId": "...", "conversationKind": "group" / "dm", "content": "...", "msgId": "..." }` |

## 排错

| 提示 | 原因 |
|---|---|
| cannot read QQ config | 凭据文件不存在或不是合法 JSON |
| QQ config field "appSecret" must be a non-empty string | secret 复制不全，注意小写 `l` 和大写 `I` |
| 群里没反应 | 群机器人要在手机 QQ 群设置里添加；个人主体只能加自己是群主/管理员的群 |
