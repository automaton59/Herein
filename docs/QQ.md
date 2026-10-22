# QQ 官方 Bot

只用官方 Bot API，不用 NapCat，不碰个人 QQ 号。

## 配置

`private/credentials/qqbot.json`：

```json
{
  "appId": "机器人 AppID",
  "appSecret": "机器人 AppSecret",
  "mode": "websocket",
  "devTestUsers": ["你的QQ号"]
}
```

- AppID/AppSecret：QQ 开放平台 → 机器人 → 开发设置。
- 群聊不需要 `devTestUsers`；单聊才需要。
- 不要提交/截图/贴聊天。

## 启动

```powershell
$env:HEREIN_QQ_ENABLED = "1"
$env:HEREIN_QQ_CONFIG = "D:\Herein\private\credentials\qqbot.json"
npm run core:serve
```

或者直接用隧道脚本：`npm run tunnel` 发现 `qqbot.json` 会自动开 QQ listener。

## 现在能做什么

- token 获取/缓存；
- gateway 连接；
- identify / HELLO 心跳 / READY / 事件分发 / 可选重连；
- `GROUP_MESSAGE_CREATE` / `GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE` 归一化；
- 写入 `observations`（audience/provenance/dedupeKey）。
- 被动回复接线：`GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE` 可交给 `responder`，用被动 `msg_id` 发文本。
- 默认没有自动回复策略；需要显式传 `responder`，避免 bot 在群里乱说话。
- 默认 QQ 回复器 `createQQResponder`：用 Core 的角色/关系/群级记忆 + 最近 12 条 observation 生成一句，自动剥 emotion/voice 标签。
- 开启方式：

```powershell
$env:HEREIN_QQ_AUTO_REPLY = "1"
```

默认关闭；只对 @群消息/私聊回复，不接全量群消息。

## 还没做

- 语音发送 API 已做：URL 上传（`file_type=3`）→ `file_info` → `msg_type=7` + 被动 `msg_id`；群/私聊各有方法。
- 还没做：本地 WAV → NT-SILK 编码、分片上传、ffmpeg 转码；目前需要先把语音放到可公网访问的 URL。
- 语音接收已做：`attachments[].voice_wav_url` + `asr_refer_text` 落 observation.media；空 content 时用 ASR 文本。
- 群模式 observer/participant/active。
- 被动回复 5 分钟/5 次、主动 60 qpm/20 qpm per group/1000 per group/day。
- 审核、审计、identity_links。
- 真机联调（需要 bot 进群 + 群主开“接收全量消息”）。

## 权限

- 个人主体 bot 不能公开，只能加到你/哥们的群。
- 全量群消息：群主在最新手机 QQ 开「接收全量消息」。
- 主动推送：群主开「主动推送消息」。
