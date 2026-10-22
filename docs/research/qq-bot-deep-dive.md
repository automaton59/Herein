# QQ AI Bot 接入技术调研（2025–2026）

> 目标场景：**自主 AI 陪伴系统**以同一 AI 身份接入 QQ（次要平台），能进群、潜水读全量群消息、理解陪伴对象的生活、主动发消息 / 语音 / 动态。
>
> 调研截止：**2026-10-21**（北京时间）。所有结论标注证据等级：
> - **【官方】** = QQ 机器人官方文档 / 官方 FAQ 明确写明
> - **【源码】** = 直接读取协议端开源仓库源码得到的事实（可复现）
> - **【社区】** = 第三方博客 / 论坛 / 群组消息，未经官方确认
> - **【推测】** = 笔者基于以上材料的推断，需实测验证

---

## 0. 结论先行（TL;DR）

| 问题 | 结论 |
|---|---|
| 官方能不能读群内**全部**消息？ | **能**，2025 年后新增 `GROUP_MESSAGE_CREATE`（全量模式）事件。**不需要申请 intent 权限位**，而是由**群主在手机 QQ 添加机器人时点「设置权限」→ 开启「接收全量消息」**。【官方】 |
| 官方能不能发**语音**？ | **能**。`msg_type=7` 富媒体 + `file_type=3`（语音），支持 silk/mp3/wav/ogg。这是 2025 年后最大的能力变化，很多老教程仍说"官方不支持语音"，**已过时**。【官方】 |
| 官方能不能发**动态（说说/Qzone）**？ | **不能**。官方 API v2 全部端点中不存在任何 QQ 空间 / 说说 / 相册发布接口，这是硬边界。【官方（文档结构可证）】 |
| 非官方能不能发动态？ | **能**，且已工程化。NapCat v4.18.41 内置 `send_qzone_msg` action，底层打 `emotion_cgi_publish_v6` + `cgi_upload_image`，依赖 `skey/p_skey → bkn(g_tk)`。【源码】 |
| 官方能不能拉**历史消息** / **群成员列表**？ | 历史消息：**无任何接口**（只有实时事件）。群成员列表：**有接口但"内邀接入中"**，个人开发者拿不到。【官方】 |
| 非官方能不能拉历史 / 成员？ | 能。`get_group_msg_history`（go-cqhttp 兼容扩展，非 OneBot 11 标准）、`get_group_member_list`（标准 API）。【源码】 |
| 推荐路线 | **官方 Bot 为主通道（合规、稳定、可发语音），NapCat 小号为"感知增强"旁路**（仅当确实需要历史消息、群成员真实 QQ 号、说说时才上）。**不要**把主身份放在非官方通道上。 |
| 最大的坑 | ① 官方 `openid` 是 per-bot 的，**拿不到 QQ 号**，跨平台身份对齐困难；② 官方主动消息可被用户/群管**一键关闭**（`C2C_MSG_REJECT` / `GROUP_MSG_REJECT`），你的"主动陪伴"可能被静默掐断；③ 个人主体**不能公开发布**机器人，只能拉进自己是群主的群。 |

---

## 1. 官方 QQ Bot 开放平台

### 1.1 主体、创建与"沙箱"的变迁

| 项目 | 现状（2026-10） | 证据 |
|---|---|---|
| 注册入口 | `https://q.qq.com/#/app/bot`（新版管理端）；另有一键扫码创建入口 `https://q.qq.com/qqbot/openclaw/login.html`，点一下即创建成功并私聊你一条消息 | 【官方】[启动接入](https://bot.qq.com/wiki/develop/api-v2/dev-prepare/getting-started.html)、[Agent 接入](https://bot.qq.com/wiki/agent-qqbot/) |
| 主体类型 | 个人认证 / 企业认证。**个人主体：最多 5 个机器人；企业主体：10 个（同主体共用名额，上限 50）** | 【官方】[FAQ](https://bot.qq.com/wiki/bot_FAQ/) |
| 公开使用 | **企业主体**已开放公开使用；**个人主体暂不支持公开使用**。个人主体的机器人只能由创建者本人拉进**自己是群主/管理员**的群；私聊需在管理端「开发设置」里加"开发体验用户号码" | 【官方】[FAQ](https://bot.qq.com/wiki/bot_FAQ/) |
| 沙箱环境 | **新版管理端已取消沙箱概念**：管理员账号直接可用，无需配置沙箱群/频道（旧版管理端的沙箱群配置已不支持）。`4914 机器人已下架，只允许连接沙箱环境` 这类错误码仍保留在 WebSocket 错误表中 | 【官方】FAQ + [WebSocket 方式](https://bot.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html) |
| 上架审核 | 旧版管理端**已停止**审核上架；所有机器人在新版管理端管理使用范围 | 【官方】FAQ |

> **对陪伴系统的含义**：如果你只是想"AI 待在我自己拉的群里"，**个人主体完全够用**，不需要企业资质、不需要上架、不需要沙箱。这是官方路径成本最低的形态。

### 1.2 凭证体系（重要：Token 已废弃）

| 凭证 | 用途 | 现状 |
|---|---|---|
| `AppID` | 机器人 ID | 必须 |
| `AppSecret` | 请求签名 / 换 AccessToken | 必须 |
| `Token` | 旧版开放接口鉴权 | **已废弃**，勿再使用 |
| `AccessToken` | 调用 OpenAPI 的唯一凭证 | 现行方案 |

**获取 AccessToken**（【官方】[获取访问凭证](https://bot.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)，页面更新 2026-09-16）：

```
POST https://api.bot.qq.com/app/getAppAccessToken
Content-Type: application/json

{"appId":"APPID","clientSecret":"CLIENTSECRET"}
→ {"access_token":"...","expires_in":"7200"}
```

- 有效期 **7200 秒**；有效期内重复获取返回**同一个值**；
- 过期前 **60 秒**内再获取会拿到新 token，旧 token 在这 60 秒内仍有效 → 天然支持"无缝轮换"；
- 调用时请求头：`Authorization: QQBot {ACCESS_TOKEN}`；
- 注意坑：**失败时 HTTP 仍返回 200**，必须判 `code`（`100007 appid invalid` / `100016 invalid appid or secret` / `100001 Too many requests`）。

**域名统一**：2026-08-10 起所有接口域名统一为 `api.bot.qq.com`（此前文档里 `api.sgroup.qq.com` 等旧域名应视为历史）。【官方】[变更记录](https://bot.qq.com/wiki/develop/api-v2/changelog.html)

**IP / 端口白名单**：
- 【官方】Webhook **回调地址允许的端口号仅 80 / 443 / 8080 / 8443**，且必须是 HTTPS。这是硬限制，不是建议。
- 【官方】管理端可"设定回调地址、监听事件"。
- 【推测/需确认】API 侧 IP 白名单：2026 版 API 文档未在正文单列该能力，管理端「开发设置」历史上提供过 IP 白名单配置。**这一项建议你在管理端自行确认后再写进架构文档**，不要按"一定有"来设计。

### 1.3 通信方式：Webhook vs WebSocket

**通用 payload 结构**（两条通道一致，【官方】[通用数据结构](https://bot.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/payload.html)）：

```json
{"id":"event_id","op":0,"d":{},"s":42,"t":"GATEWAY_EVENT_NAME"}
```

OpCode：`0 Dispatch` / `1 Heartbeat` / `2 Identify` / `6 Resume` / `7 Reconnect` / `9 Invalid Session` / `10 Hello` / `11 Heartbeat ACK` / `12 HTTP Callback ACK`（webhook 回包）/ `13 回调地址验证`（webhook）。

#### Webhook（HTTP 回调）

- 配置入口：`https://q.qq.com/qqbot/#/developer/webhook-setting`；端口仅 80/443/8080/8443。
- **回调地址验证**：平台 POST `op=13`，body 中 `d = {plain_token, event_ts}`，Header 带 `User-Agent: QQBot-Callback`、`X-Bot-Appid: <appid>`。你需返回：

```json
{"plain_token":"<原样回传>","signature":"<hex>"}
```

签名算法（【官方】[Webhook 方式](https://bot.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html)，更新 2026-09-11）：

```
seed = AppSecret 重复拼接至 32 字节 → seed[:32]
priv = ed25519.GenerateKey(seed).private
msg  = event_ts + plain_token        // 注意顺序：时间戳在前
signature = hex(ed25519.Sign(priv, msg))
```

- 收到正常事件后按 `op=12`（HTTP Callback ACK）回包。

#### WebSocket（长连接）

- 先取网关：`/gateway` 或 `/gateway/bot`（带分片）→ `wss://api.bot.qq.com/websocket/`；
- 连上先收 `op=10 Hello`（`heartbeat_interval`，示例 45000ms）；
- 发 `op=2 Identify`：

```json
{"op":2,"d":{"token":"QQBot {AccessToken}","intents":513,"shard":[0,4],
  "properties":{"$os":"linux","$browser":"my_library","$device":"my_library"}}}
```

- 鉴权成功下发 `READY`（含 `session_id`）；之后按周期发 `op=1 Heartbeat`（`d` = 最近收到的 `s`，首连为 `null`），收 `op=11 ACK`。
- 断线重连用 `op=6 Resume`（`session_id` + `seq`）补发遗漏事件，补完下发 `RESUMED`。
- **分片**：`shard_id = (guild_id >> 22) % num_shards` —— 注意这是按 **频道（guild）** 哈希的规则，QQ 群场景基本用 `[0,1]` 单分片即可。
- 关键错误码：`4914 已下架只能连沙箱`、`4915 已封禁`（均不可重试）；`4009` 可 resume；`4008` 发太快需重连。

> **选型建议**：官方文档没有明说"哪种更好"，但【官方】消息概述里有一句关键约束——**频道**场景"发送消息接口要求机器人接口需要连接到 WebSocket 上保持在线状态"。群/单聊虽未见同样表述，但为了**主动消息**稳定推送，实践上 WebSocket 常驻更省心；Webhook 更适合 serverless/公网入口受限场景。两者可同时开（事件会重复投递，需按 `id` 去重）。

### 1.4 Intents 与事件全景

Intents 是位掩码，位与事件类型对照（节选与 QQ 群/单聊强相关的部分，【官方】payload 页）：

| Intents | 位 | 事件 | 说明 |
|---|---|---|---|
| `GUILDS` | `1<<0` | `GUILD_CREATE/UPDATE/DELETE`、`CHANNEL_*` | 基础，默认有权限 |
| `GUILD_MEMBERS` | `1<<1` | `GUILD_MEMBER_ADD/UPDATE/REMOVE` | 基础，默认有权限 |
| `GUILD_MESSAGES` | `1<<9` | `MESSAGE_CREATE`（频道**全量**）、`MESSAGE_DELETE` | **仅私域**机器人可设 |
| `PUBLIC_GUILD_MESSAGES` | `1<<30` | `AT_MESSAGE_CREATE`、`PUBLIC_MESSAGE_DELETE` | 公域频道 @ 消息 |
| `GROUP_AND_C2C_EVENT` | `1<<25` | **QQ 群与单聊的全部事件**（见下） | 本项目核心 |
| `INTERACTION` | `1<<26` | `INTERACTION_CREATE` | 按钮回调 |
| `MESSAGE_AUDIT` | `1<<27` | `MESSAGE_AUDIT_PASS/REJECT` | 主动消息审核结果 |
| `PUBLIC_GUILD_MESSAGES` 系列 | — | 频道相关 | 非本次重点 |

`GROUP_AND_C2C_EVENT (1<<25)` 展开：

- `C2C_MESSAGE_CREATE` —— 用户单聊机器人
- `FRIEND_ADD` / `FRIEND_DEL`
- `C2C_MSG_REJECT` / `C2C_MSG_RECEIVE` —— 用户在资料卡关/开"主动消息"推送开关
- `GROUP_AT_MESSAGE_CREATE` —— 群里 **@机器人**
- **`GROUP_MESSAGE_CREATE`** —— 群里**全量消息**（不限于 @，见 1.5）
- `GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT` —— 机器人被拉入/移出群
- `GROUP_MSG_REJECT` / `GROUP_MSG_RECEIVE` —— **群管理员**关/开通知

> 官方原文：除 `GUILDS`、`PUBLIC_GUILD_MESSAGES`、`GUILD_MEMBERS` 是"基础事件默认有权限"外，其他特殊事件"都需要经过申请才能够使用"，无权限时 WebSocket 直接报错断连（`4014 intent 无权限`）。**但对 `1<<25` 的群/单聊事件，实际所有可用机器人都能订阅**——真正的开关在**群主侧的群权限**里，而不是开发者侧的 intent 申请。这是文档与实践的差异点，务必注意。【官方 + 实践观察】

### 1.5 关键：如何拿到"群内全部消息"

这是本次调研最重要的发现。

**事件定义**（【官方】[群消息（全量模式）](https://bot.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)，页面更新 **2026-10-21**）：

- 事件名：`GROUP_MESSAGE_CREATE`
- Intent：`GROUP_AND_C2C_EVENT (1<<25)`
- 官方原文：**"当机器人开启了『接收所有消息』功能后，群里的每一条消息（不限于 @ 机器人）都会推送此事件。各字段含义与 `GROUP_AT_MESSAGE_CREATE` 完全一致。"**

**怎么"开启"？**（【官方】[FAQ](https://bot.qq.com/wiki/bot_FAQ/) 明确写了三步）——**群主在手机 QQ 里加机器人时点「设置权限」**：

1. **设置接收全量消息能力** → 机器人可收到群内**所有成员**的发言；
2. **设置主动推送消息能力** → 机器人可主动在群内发言（定时任务等）；
3. **设置机器人撤回成员消息能力** → 机器人被设为**群管理员**后可撤回成员消息。

> 前提：**用最新版手机 QQ**，且用**群主身份**添加机器人。旧版手机 QQ 会提示"该机器人当前服务状态异常"。

**事件体关键字段**（比老版丰富很多，直接决定了"能不能理解生活"）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 消息 ID，用于**被动回复**与撤回 |
| `author` | User | `member_openid`、`username`、`member_role`（`member`/`admin`/`owner`）、`bot` |
| `content` | string | 文本；@ 成员替换为 `<@member_openid>`，@全体为 `<@all>` |
| `group_openid` | string | 群 OpenID |
| `timestamp` | string | RFC3339 |
| `message_type` | int | `0` 文本 / `3` 结构化卡片 / `101` 并行消息 / `102` 聊天记录 / `103` 引用消息 |
| `attachments[]` | array | `url`、`filename`、`width/height`、`size`、`content_type`（`voice` / `image/jpeg` / `image/png` / `image/gif` / `video/mp4` / `file`）、**`voice_wav_url`**、**`asr_refer_text`** |
| `mentions[]` | array | 被 @ 的用户列表 |
| `ark_data` | object | 卡片：`ark_type`（`tuwen`/`feed`/`miniapp`/`map`/`contact_card`/`video_share`/`music_together`/`picture`）、`fields{title,desc,jump_url,preview,...}` |
| `msg_elements[]` | array | **嵌套/引用结构**：`msg_idx`、`author`、`message_type`、`content`、`attachments`、`ark_data`（支持递归） |
| `message_scene` | object | `source`（`default`）、`ext[]`（`msg_idx=`、`ref_msg_idx=`、`auth_token=`） |

**两个"陪伴系统"级别的红利**：

1. **`asr_refer_text`** —— 语音消息的**平台侧 ASR 参考结果**。也就是说对方发语音，你**不用自己跑 ASR**就能拿到文本。配合 `voice_wav_url`（平台把 SILK 转成 WAV 的下载链接）可做二次精修。
2. **`msg_elements` 递归结构** —— 能解析"引用回复"和"聊天记录合并转发"，这对重建对话上下文极其关键。

### 1.6 发消息 API

**群聊**（【官方】[发送群聊消息](https://bot.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)，更新 2026-09-03）：

```
POST https://api.bot.qq.com/v2/groups/{group_openid}/messages
Authorization: QQBot {ACCESS_TOKEN}
接口频控：100 QPS
```

请求体字段：

| 字段 | 说明 |
|---|---|
| `msg_type` | `0` 文本(`content`) / `2` Markdown(`markdown`) / `7` 富媒体(`media`) |
| `content` | 文本；传了 `markdown` 则此字段**必须为空** |
| `markdown` | `{content, template_id(已废弃), custom_template_id(已废弃), force_verify_image_resource}` |
| `keyboard` | 按钮：短形式 `{id}` 或长形式 `{content:{rows:[{buttons:[...]}]}}` |
| `msg_id` | **被动回复**的消息 ID（来自事件 `d.id`），**5 分钟内有效** |
| `event_id` | 被动回复的事件 ID，与 `msg_id` 二选一；仅支持 `INTERACTION_CREATE`、`GROUP_ADD_ROBOT`、`GROUP_MSG_RECEIVE` |
| `msg_seq` | 回复序号，同一 `msg_id+msg_seq` 重复发送会失败（去重机制），递增可多次回复 |
| `media.file_info` | `msg_type=7` 时用，来自 `POST /v2/groups/{group_openid}/files` |
| `message_reference` | 引用回复：`{message_id}`（别人的消息取 `message_scene.ext` 里的 `msg_idx`；自己发的取响应 `ext_info.ref_idx`） |

**按钮（keyboard）细节**：`render_data{label(≤10字符), visited_label, style(0灰/1蓝/3白底红字/4蓝底白字)}`；`action.type`：`0` 跳转(http/小程序)、`1` 回调后台、`2` 指令按钮（自动在输入框插入 @bot + data）；`action.permission.type`：`0` 指定用户 / `1` 管理员 / `2` 所有人；`modal{content≤40字, confirm_text≤4, cancel_text≤4}` 二次确认。指令按钮还支持 `enter`（直接发送）、`reply`（带引用）、`anchor=1`（唤起手 Q 选图器，仅手机端 8983+ 单聊）。

**单聊**：`POST /v2/users/{user_openid}/messages`，另有**流式消息** `POST /v2/users/{user_openid}/stream_messages`（群消息**不支持**流式参数）。

**消息类型能力矩阵**（【官方】[消息类型](https://bot.qq.com/wiki/develop/api-v2/server-inter/message/type/overview.html)，更新 2026-07-23）：

| 类型 | 单聊 | 群聊 | 频道 |
|---|---|---|---|
| 文本 | 收发 ✅ | 收发 ✅ | 收发 ✅ |
| Markdown | 发 ✅ / 收 ❌ | 收发 ✅ | 发 ✅ / 收 ❌ |
| 图片 | 收发 ✅ | 收发 ✅ | 收发 ✅ |
| 视频 | 收发 ✅ | 收发 ✅ | 收发 ✅ |
| **语音** | **收发 ✅** | **收发 ✅** | **收发 ✅** |
| 文件 | 收发 ✅ | 收发 ✅ | ❌ |
| 结构化卡片(ark) | 发 ❌ / 收 ✅ | 发 ❌ / 收 ✅ | 发 ❌ / 收 ❌ |
| Embed | ❌ | ❌ | 发 ✅ / 收 ❌ |
| 表情表态 | ❌ | ❌ | 收发 ✅ |
| 引用消息 | 收 ✅ | 收 ✅ | 收 ✅ |

> 注意：**发送侧只有 `msg_type = 0/2/7`**（聊天记录里可能提到 `3`，但群/单聊的 ark 发送是关闭的）。**群聊不能发 ark 卡片**——想做"富文本卡片"只能用 Markdown + keyboard。

### 1.7 主动 vs 被动：窗口、次数与配额（最容易翻车的地方）

【官方】[消息收发概述](https://bot.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)：

| 消息类型 | 特征 | 说明 |
|---|---|---|
| 主动消息 | 无条件 | 用户可在客户端关闭"允许主动发送"，关闭后**必然失败** |
| 互动召回消息 | `is_wakeup=true` | 用户对话后 30 天内，分 4 个周期（当天 / 1–3 天 / 3–7 天 / 7–30 天），**每周期 1 条** |
| 被动消息（回复用户） | 带 `msg_id` | — |
| 被动消息（响应事件） | 带 `event_id` | — |

**被动回复时效与次数**：

| 场景 | 有效期 | 每条消息可回复次数 |
|---|---|---|
| 单聊 | **60 分钟** | **4 次** |
| 群聊 | **5 分钟** | **5 次** |
| 频道 | 5 分钟 | — |

**主动消息频控（HTTP）**：

| 认证 | 场景 | Bot 维度 | 单关系维度 | 每日上限 |
|---|---|---|---|---|
| 企业认证 | 单聊 | 10 qps | 20 qpm | 1000 条/用户 |
| 个人认证 | 单聊 | 10 qps | 20 qpm | 1000 条/用户 |
| 未认证 | 单聊 | 5 qps & 30 qpm | 20 qpm | 1000 条/用户 |
| 企业/个人 | **群** | **60 qpm** | **20 qpm** | **1000 条/群** |
| 未认证 | 群 | 30 qpm | 20 qpm | 1000 条/群 |

> 频道：主动消息默认每子频道 20 条/天，每天最多推 2 个子频道；主动/被动均限 5 条/秒；频道私信 2 条/用户/天、200 条/天总量。

**去重与撤回**：相同 `msg_id` 可能多次推送，需按 `msg_seq` 去重；**自己发的消息 2 分钟内可撤回**（`DELETE /v2/groups/{group_openid}/messages/{message_id}`）。

**"群聊是否必须 @" 的准确答案**：**不是**。只要有**主动推送消息能力**（群主授权），就能直接发群消息，不需要 @。但被动回复（带 `msg_id`）必须是对某条消息的回复；而且**不带 `msg_id` 的发送会走主动消息配额**。所以策略应是：能蹭 `msg_id` 就蹭（免费、不受配额限制、可 5 次），蹭不到再走主动消息。

### 1.8 发语音（官方，重点）

【官方】[富媒体消息概述](https://bot.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html)：

| 类型 | 格式 | 软限制 | 硬限制 |
|---|---|---|---|
| 图片 `file_type=1` | png/jpg | 20 MB | 200 MB |
| 视频 `file_type=2` | mp4 | 30 MB | 200 MB |
| **语音 `file_type=3`** | **silk**（概述另称支持 silk/mp3/wav/ogg） | **20 MB** | 200 MB |
| 文件 `file_type=4` | 任意 | 200 MB | 200 MB |

> ⚠️ **文档内部不一致**：格式表只写 `silk`，正文概述写"支持 silk/mp3/wav/ogg"。**建议以 silk 为准做兜底，其余格式先小流量实测**。

**两条上传路径**：

**A. URL 上传（整文件，最快接入）**

```
POST /v2/groups/{group_openid}/files
{"file_type":3,"url":"https://your-cdn/voice.silk"}
→ {"file_info":"AE86C5D3..."}
```

**B. 分片上传（推荐，本地文件/大文件）** 四步：

```
1) 预上传  POST /v2/groups/{group_id}/upload_prepare
           → upload_id + block_size + 各分片预签名 URL
2) 分片 PUT 逐片 PUT 到 presigned_url
3) 确认分片 POST /v2/groups/{group_id}/upload_part_finish
4) 合并     POST /v2/groups/{group_openid}/files  {upload_id} → file_info
```

细节：`md5_10m`（前 10002432 字节 MD5）可用于**秒传判断**；默认分片 5MB，并发/重试由 `upload_config` 下发；上传接口超时建议 ≥ 5 秒。

**发送**：

```json
POST /v2/groups/{group_openid}/messages
{"msg_type":7,
 "msg_id":"ROBOT1.0_xxx",        // 被动回复，5 分钟内
 "msg_seq":2,
 "media":{"file_info":"AE86C5D3F0E14B238C656C0F6DD1D0479C"}}
```

另有捷径：上传时带 **`srv_send_msg=true`** 可直接发送、省一次调用，**但会占用主动消息频次**。

**关键隔离规则**：单聊与群聊上传接口**互不通用**。
- 单聊：`/v2/users/{user_openid}/files`、`/v2/users/{user_id}/upload_prepare`
- 群聊：`/v2/groups/{group_openid}/files`、`/v2/groups/{group_id}/upload_prepare`

**接收侧语音**：`attachments[].content_type = "voice"`，附 `voice_wav_url`（平台把 SILK 转 WAV 给你）与 `asr_refer_text`（平台 ASR 文本）。**不需要自己解 silk**。

**语音与 TTS 的关系**（澄清常见混淆）：
- 官方**不提供 TTS**。TTS 由你自己选（火山/阿里/微软/Azure/本地 GPT-SoVITS 等）。
- 官方**接受** silk/mp3/wav/ogg，所以你有两种做法：
  1. TTS 直接输出 **mp3/wav** → 上传（若实测可行，最省事）；
  2. TTS 输出 wav → **ffmpeg 转 silk**（最稳，见 2.5 的编码细节）。
- 官方也**不做**"语音转文字 API"，只是在事件里**附带** `asr_refer_text`。

### 1.9 发动态：官方能力边界（明确的"不能"）

**官方 API v2 的全部一级分区只有三类：消息收发 / 机器人 / 群聊管理 / 频道管理**（外加起步指南、变更记录）。**不存在**：QQ 空间、说说、Qzone、相册、朋友圈、日志、留言板 相关的任何端点。

**可验证的边界结论**：
- 官方**没有**"发布说说"API；
- 官方**没有**"QQ 空间图片上传"API；
- 官方**没有**"读取好友动态"API（连好友关系都拿不到，只有 `FRIEND_ADD/DEL` 事件）；
- 频道侧有"帖子（Forum）"能力，但 **`FORUMS_EVENT` 仅私域机器人可订阅**，与 QQ 群/空间无关，且个人主体不可用。

> **结论**：官方路径下"发动态"只有两种替代方案：
> 1. **降级为"群内图文卡片"**（Markdown + 图片 `msg_type=7`）——本质是群消息，不是空间动态；
> 2. **走非官方 Qzone 接口**（见 2.6），或**人工/半自动**（生成文案+图，推送给你手动发）。
>
> 如果你的产品语义里"发动态"必须是 QQ 空间说说，那么**官方路径直接出局**，这是必须向用户明确的产品约束。

### 1.10 群管理接口（2026 年新增不少）

【官方】群聊管理分区（`/v2/groups/{group_openid}/...`）：

| 接口 | 路径 | 备注 |
|---|---|---|
| 获取群基本信息 | `GET /v2/groups/{group_openid}/info` | |
| 获取机器人群内状态 | `GET /v2/groups/{group_openid}/bot_state` | |
| **获取群成员列表** | `GET /v2/groups/{group_openid}/members?cursor=` | **每次最多 30 条**，游标分页；**"该能力正在内邀接入中"**；错误码 `11253` 说明"仅白名单机器人可用" |
| 获取群成员信息 | `GET /v2/groups/{group_openid}/members/{member_openid}` | 同上，内邀 |
| 群成员批量移除 | `POST .../batch_remove_members` | 2026-09-03 新增 |
| 群黑名单查询/操作 | `.../member_blacklist` | 2026-09-03 新增 |
| 查询/设置群禁言 | `.../restrict_chat_setting` | 2026-08-10 新增 |
| 入群申请列表/审批 | `.../join_request_list`、`.../approval_join_request/{member_openid}` | 2026-08-10 新增 |
| 入群自动审批策略 | `.../join_approval_strategy/...` | 含白名单号码管理 |

> **群成员列表是"内邀"**，这对"理解群里都有谁"是硬伤。官方只给你 `member_openid`（在事件里）+ `username`，且 **openid 是按 bot 隔离的**，你无法把它对应到真实 QQ 号，也无法跨 bot 复用。

### 1.11 官方能力边界汇总

| 能力 | 官方支持 | 说明 |
|---|---|---|
| 群内全量消息（实时） | ✅ | `GROUP_MESSAGE_CREATE`，需群主授权 |
| **历史消息回溯** | ❌ | 无任何接口，只能自己落库 |
| 群成员列表 | ⚠️ 内邀 | 30 条/页，白名单 |
| 真实 QQ 号 | ❌ | 只有 per-bot `openid` / `member_openid`；`union_openid` 需邮件申请且限同主体 |
| 好友列表 / 好友关系 | ❌ | 无接口 |
| 主动群消息 | ✅ | 60 qpm / 20 qpm / 1000 条/群/天，可被群管关闭 |
| 语音收发 | ✅ | `file_type=3` |
| 表情回应 | ❌（群/单聊） | 仅频道 |
| 群文件 | ⚠️ | 可收发"文件"类型消息，但**无群文件系统浏览接口** |
| 撤回他人消息 | ⚠️ | 需被设为群管理员 + 群主授予"撤回成员消息"能力 |
| QQ 空间 / 说说 | ❌ | 完全无 |

---

## 2. 非官方协议路径

### 2.1 谱系与 2026 年现状

时间线（【社区】[我与 NapCat 二三事](https://wesley-young.github.io/2026-02-21-biography-of-napcat) + 【源码/仓库】核验）：

```
CKYU/CQHTTP (2017) ──► OneBot 11 标准 (2019-2021)
        │
        ├─ Mirai / MiraiGo ──► go-cqhttp（Go，已停更）
        │
        └─ NTQQ 时代（2022+，PC QQ 基于 Electron）
                 │
                 ├─ Chronocat（早期 Hook）
                 ├─ LLOneBot ──改名──► LuckyLilliaBot（JS 注入 / LiteLoaderQQNT）
                 ├─ NapCatQQ（无头 Hook，V3 起 Native Hook 直接收发 packet）
                 └─ Lagrange.Core（纯 C# 协议实现，不需要客户端）
```

| 项目 | 架构 | 最新版本 / 活跃度（2026-10-21） | 状态 |
|---|---|---|---|
| **NapCatQQ** | **NTQQ 客户端 Hook + Native Hook**（TypeScript，无头，内存 50–100MB） | **v4.18.41**（2026-10-21 发布）；11.2k star；当日仍在提交 | 最活跃，事实标准 |
| **LuckyLilliaBot**（原 LLOneBot） | JS 注入 NTQQ（依赖 LiteLoaderQQNT/QGUI 环境） | **v8.3.2**（2026-10-12）；3.7k star | 活跃；支持 OneBot 11 / Satori / Milky |
| **Lagrange.Core** | **纯协议实现**（C#，NTQQ 协议，无需客户端） | 只有 `nightly` tag；最后提交 2026-09-07；3.0k star | 活跃但节奏较慢；已支持 **Milky** |
| **go-cqhttp** | MiraiGo（旧协议） | **v1.2.0（2023-10-09）**，README 明写"无力继续维护" | **已死**，勿用 |
| **NoneBot2** | 应用框架（不是协议端） | 活跃 | 通过 OneBot 11 适配器对接上述协议端 |

**go-cqhttp 的死亡证明**（README 原文）：

> "由于QQ官方针对协议库的围追堵截, 不断更新加密方案, 我们已无力继续维护此项目。建议Bot开发者尽快迁移至无头NTQQ项目。"

**NapCat 的架构演进（决定了它能干什么）**（【社区】+【源码】）：
- V1：全局 `WrapperSession` + `setTimeout` 等待 QQ 加载，质量差；
- V2（2024-08 重构）：去副作用/循环依赖，构造器注入；
- **V3：引入 Native Hook** —— 不再局限"调用 PC QQ 已封装好的 API"，而是**直接构造/收发 QQ 数据包**，因此能做 PC 端原生做不到的事（如设置群成员专属头衔、发 AI 语音、发说说）。

> 这正是 `send_qzone_msg`、`send_group_ai_record` 这类"客户端都没有的功能"能出现在 NapCat 里的原因。

### 2.2 OneBot 11 标准（准确版）

**通信方式**（4 种，可组合）：
- HTTP API（应用 → 实现，POST/GET）
- HTTP POST（实现 → 应用，事件上报）
- 正向 WebSocket（应用连实现）
- 反向 WebSocket（实现连应用）
- 鉴权：`Authorization: Bearer <token>` 或 `access_token` 查询参数

**事件模型**（4 大类）：

| 类别 | `post_type` | 典型事件 |
|---|---|---|
| 消息 | `message` | `message_type=private`（`sub_type=friend/group/other`）、`message_type=group`（`sub_type=normal/anonymous/notice`） |
| 通知 | `notice` | `group_upload`、`group_admin`、`group_decrease`、`group_increase`、`group_ban`、`friend_add`、`group_recall`、`friend_recall`、`group_card`、`offline_file`、`client_status`、`essence`、`notify`（`poke`/`lucky_king`/`honor`） |
| 请求 | `request` | `friend`、`group`（`add`/`invite`） |
| 元事件 | `meta_event` | `lifecycle`（`enable/disable/connect`）、`heartbeat` |

**消息段**（`message` 数组格式）：`text`、`face`、`image`、`record`、`video`、`at`、`rps`、`dice`、`shake`、`poke`、`anonymous`、`share`、`contact`、`location`、`music`、`reply`、`forward`、`node`、`xml`、`json`。字符串格式即 CQ 码：`[CQ:record,file=http://x/1.mp3]`。

**公开 API（标准内，节选）**：

```
send_private_msg(user_id, message, auto_escape) -> {message_id}
send_group_msg(group_id, message)               -> {message_id}
send_msg(message_type, user_id|group_id, message)
delete_msg(message_id)
get_msg(message_id) -> {time, message_type, message_id, real_id, sender, message}
get_forward_msg(id) -> {message: [node...]}
send_like(user_id, times)                        // 每天最多 10 次
set_group_kick / set_group_ban / set_group_whole_ban / set_group_admin
set_group_card / set_group_name / set_group_leave / set_group_special_title
set_friend_add_request / set_group_add_request
get_login_info / get_stranger_info / get_friend_list
get_group_info / get_group_list
get_group_member_info / get_group_member_list
get_group_honor_info
get_cookies(domain) / get_csrf_token() / get_credentials(domain)
get_record(file, out_format)   // 需 ffmpeg；out_format: mp3/amr/wma/m4a/spx/ogg/wav/flac
get_image(file)
can_send_image / can_send_record
get_status / get_version_info / set_restart / clean_cache
```

**隐藏 API** 只有一个：`.handle_quick_operation(context, operation)`。

> ⚠️ **重要纠偏**：**`get_group_msg_history` 不属于 OneBot 11 标准**。它和 `upload_group_file`、`set_msg_emoji_like`、`send_poke` 一样，是 **go-cqhttp 扩展**。
> 【源码证据】NapCat 仓库中它们就放在 `packages/napcat-onebot/action/go-cqhttp/` 目录下：`GetGroupMsgHistory.ts`、`UploadGroupFile.ts`、`GetGroupRootFiles.ts`、`GetGroupFileSystemInfo.ts`、`SetGroupPortrait.ts`、`SendForwardMsg.ts`、`GetGroupAtAllRemain.ts` 等。选型时必须确认目标实现是否兼容这批扩展。

**OneBot 12 的状态**：仍是**"候选"（Candidate）**，站点标题就写着 `OneBot 12 标准（候选）`（[12.onebot.dev](https://12.onebot.dev/)）。它把接口按 Private/Group/Guild/File 分层、动作改名为 `send_message`/`get_group_member_list` 风格、通信规范改为 OneBot Connect（含 HTTP Webhook）。**2026 年生产环境仍应押 OneBot 11**。

**另一个 2026 年的新变量：Milky**。Lagrange.Core 与 LuckyLilliaBot 都在加 Milky 支持（`[Milky] Support suppressing self-generated message events` 等提交）。Milky 是比 OneBot 11 更现代的标准，但生态成熟度远不如 OneBot 11，**现在不建议作为主协议**。

### 2.3 实现对比（选型表）

| 维度 | NapCatQQ v4.18.41 | LuckyLilliaBot v8.3.2 | Lagrange.Core (nightly) | go-cqhttp v1.2.0 |
|---|---|---|---|---|
| 原理 | NTQQ 客户端 Hook + Native Hook | JS 注入 NTQQ | **纯协议重实现** | 旧 MiraiGo 协议 |
| 需要图形界面 | ❌ 无头 | ⚠️ 早期需要，现已改善 | ❌ | ❌ |
| 能否跑在无 QQ 客户端的服务器 | ✅（自带精简 NTQQ） | ⚠️ 较麻烦 | ✅ **最干净** | ✅ |
| 部署难度 | 低（有一键/Docker/WebUI） | 中 | 中（需自己写宿主） | 低 |
| 内存 | 50–100MB | 中 | 低 | 极低（15MB） |
| OneBot 11 覆盖 | **最全**（标准 + go-cqhttp 扩展 + 大量自有扩展） | 高 | 高 | 中 |
| **发说说（Qzone）** | ✅ `send_qzone_msg` | ❌（未见） | ❌ | ❌ |
| **AI 语音** | ✅ `send_group_ai_record` / `get_ai_record` | ❌ | ❌ | ❌ |
| 语音 ASR | ✅ `fetch_ptt_text` | ❌ | ❌ | ❌ |
| 协议检测风险 | 中（走真实客户端，流量特征最像真人） | 中 | **较高**（纯协议，易被指纹识别）【推测】 | 已失效 |
| 维护状态 | 极活跃 | 活跃 | 活跃但慢 | **死亡** |

### 2.4 如何"看群聊"（非官方）

**全量消息**：OneBot 11 的 `message` 事件**天然就是全量的**——只要协议端在线，群内每条消息都会以 `post_type=message, message_type=group` 上报，**不需要 @，不需要管理员，不需要群主授权**。这是相对官方最大的结构性优势。

典型事件体（关键字段）：

```json
{
  "post_type":"message","message_type":"group",
  "sub_type":"normal","message_id":123456,"group_id":987654321,
  "user_id":10001000,
  "anonymous":null,
  "message":[{"type":"text","data":{"text":"早上好"}},
             {"type":"at","data":{"qq":"10001000"}}],
  "raw_message":"早上好",
  "font":14,
  "sender":{"user_id":10001000,"nickname":"小明","card":"","role":"member"},
  "time":1750000000,
  "self_id":10000000
}
```

**历史消息**：`get_group_msg_history`（go-cqhttp 扩展，NapCat 已实现）：

```json
{"action":"get_group_msg_history",
 "params":{"group_id":987654321,"message_seq":0,"count":20,"reverseOrder":false}}
→ {"status":"ok","data":{"messages":[ ... ]}}
```

> 注意：`message_seq` 游标语义各实现略有差异（有的用 `message_id`），需要实测。**历史消息只能从"协议端登录之后"的范围内拉，且受服务端限制**，不是无限回溯。

**群成员列表**：`get_group_member_list`（标准 API），返回 `user_id`（**真实 QQ 号**）、`nickname`、`card`、`role`、`join_time`、`last_sent_time`、`level`、`title` 等。

> 这是官方完全给不了的东西：**真实 QQ 号 + 群名片 + 入群时间 + 最后发言时间**，对"理解陪伴对象的生活"价值极高（能判断谁活跃、谁是新来的、谁改过名片）。

**群文件**：`get_group_root_files`、`get_group_files_by_folder`、`get_group_file_system_info`、`get_group_file_url`、`upload_group_file`、`delete_group_file`、`create_group_file_folder`、`move_group_file`/`rename_group_file`/`trans_group_file`（NapCat 扩展）。

**其他有价值的 NapCat 扩展**（【源码】action registry）：
- `get_recent_contact` 最近会话
- `get_group_notice` / `send_group_notice` / `del_group_notice` 群公告
- `get_group_essence` / `set_essence_msg` 群精华
- `set_msg_emoji_like` / `fetch_emoji_like` / `get_emoji_likes` **表情回应**
- `send_poke` / `group_poke` / `friend_poke` 戳一戳
- `set_input_status` "正在输入…"（拟人化神器）
- `get_qun_album_list` / `upload_image_to_qun_album` 群相册
- `get_profile_like` 名片赞
- `set_online_status` / `set_diy_online_status` 自定义在线状态
- `get_rkey` / `get_rkey_ex` 媒体直链（下载图片/语音/视频必需）
- `mark_msg_as_read`、`get_group_shut_list`、`get_group_at_all_remain`（@全体剩余次数）

### 2.5 如何发语音（非官方，深入）

**消息段**：

```json
{"type":"record","data":{"file":"http://example.com/1.mp3"}}
// CQ 码: [CQ:record,file=http://example.com/1.mp3]
```

`record` 段参数：`file`（文件名 / `file://` 绝对路径 / `http(s)://` / `base64://`）、`magic`（`0` 普通 / `1` **变声**）、`url`（收）、`cache`、`proxy`、`timeout`。

**SILK 编码链路**（【源码】`packages/napcat-core/helper/audio.ts`）：

```ts
export async function encodeSilk(filePath, temporaryDirectory, logger) {
  const converted = !(await FFmpegService.isSilk(filePath));
  const pttPath = converted ? path.join(temporaryDirectory, randomUUID()) : filePath;
  if (converted) {
    logger.log(`语音文件${filePath}需要转换成silk`);
    await FFmpegService.convertToNTSilkTct(filePath, pttPath);  // ← 转成"腾讯 NT 版 silk"
  }
  const duration = await FFmpegService.getDuration(pttPath);
  return { converted, path: pttPath, duration };
}
```

关键点：
- **不是普通 SILK**，而是 **NTQQ 版 SILK（`convertToNTSilkTct`）**——带腾讯自定义头（`#!SILK_V3` + 0x02 控制头 + 建议 1 秒静音前导）。自己用 `silk-wasm`/`pilk` 编码时**必须用 NT 变体**，否则手机端播放异常/时长显示错误；
- `FFmpegService` 有**三种适配器**：`ffmpeg-addon`（原生 .node，win32-x64/darwin-arm64/linux-x64 等预编译）、`ffmpeg-exec`（调用系统 ffmpeg）、`download-ffmpeg`（自动下载）→ **部署时可以完全不装系统 ffmpeg**；
- 采样率/声道：QQ 语音惯例 24000Hz / 单声道 / 低码率（社区通行参数）【社区】；
- 时长通常限制在 **60 秒**以内（超出会被截断或发送失败）【社区/推测，需实测】。

**AI 语音（QQ 自带的"AI 声聊/角色语音"）** —— 这是 NapCat 独有的能力，很多人不知道：

```json
// 1) 列出可用 AI 角色
{"action":"get_ai_characters","params":{"group_id":987654321,"chat_type":1}}

// 2) 只取语音 URL（不发送）
{"action":"get_ai_record",
 "params":{"character":"ai_char_1","group_id":987654321,"text":"你好"}}
→ "http://.../ai_voice.silk"

// 3) 直接以 AI 角色音色发送到群
{"action":"send_group_ai_record",
 "params":{"character":"ai_char_1","group_id":987654321,"text":"你好"}}
→ {"message_id":0}   // 注意：拿不到真实 message_id
```

底层是 `PacketApi.pkt.operation.GetAiVoice(groupId, character, text, AIVoiceChatType.Sound)` + `GetGroupPttUrl(...)`。【源码】`group/SendGroupAiRecord.ts`、`group/GetAiRecord.ts`、`packet/entities/aiChat.ts`

> **战略含义**：如果目标是"AI 陪伴"，`send_group_ai_record` 让你**不用自己训 TTS、不用自己转 silk**，直接让 QQ 用内置 AI 音色念你的文本。代价是：音色受腾讯控制、`message_id` 拿不到（无法撤回/引用）、这属于**未公开接口**，随时可能变。

**语音转文字（ASR）**：`fetch_ptt_text`

```json
{"action":"fetch_ptt_text","params":{"message_id":123456}}
→ "识别出的文本"
```

**TTS 接入建议架构**：

```
LLM 回复文本
   ├─► (A) 文本消息 msg_type/send_group_msg      → 即时、必达
   └─► (B) 语音分支
           ├─ 情感/场景判定（值得发语音吗？）
           ├─ TTS（火山/Azure/GPT-SoVITS）→ wav
           ├─ ffmpeg → NT-SILK（或直接用 NapCat 自动转）
           └─ record 段 / send_group_ai_record
```

**并发注意**：语音生成是秒级操作，不要阻塞文本回复。建议"文本先发、语音后补"，且对同一用户做语音频控（避免刷屏式语音轰炸）。

### 2.6 如何发动态（非官方 Qzone，深入）

这是本次调研挖到最深的"底层逻辑"。**NapCat v4 已把这条路工程化**：`send_qzone_msg` / `delete_qzone_msg`。

#### Action 定义（【源码】`extends/SendQzoneMsg.ts`）

```json
{"action":"send_qzone_msg",
 "params":{
   "content":"今天的晚霞很好看",
   "images":["file:///C:/a.jpg","https://x/b.png","base64://..."],
   "ugc_right":1,
   "target_uins":[10001000]
 }}
→ {"tid":"xxxxx"}
```

- `content`：说说正文
- `images[]`：支持 `file://` / `http(s)://` / `base64://`，**自动上传**
- `ugc_right`：`1` 所有人可见 / `4` 好友可见 / `16` 部分好友可见 / `64` 仅自己可见 / `128` 部分好友不可见（**只接受这 5 个值**，源码 `ValidUgcRights` 校验）
- `target_uins`：`ugc_right` 为 `16`/`128` 时**必填**
- 返回 `tid`（说说 ID），可用于 `delete_qzone_msg`

#### 底层 HTTP（【源码】`data/qzone.ts`，注释里直接写明"对齐"的线上地址）

**1) 上传图片**

```
POST https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk={g_tk}
Content-Type: application/x-www-form-urlencoded

uin={uin}&skey={skey}&p_uin={uin}&p_skey={pskey}
&uploadtype=1&albumtype=7&exttype=0&refer=shuoshuo
&output_type=jsonhtml&charset=utf-8&output_charset=utf-8
&upload_hd=1&hd_width=2048&hd_height=10000&hd_quality=96
&backUrls=http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image,...
&base64=1&jsonhtml_callback=callback
&picfile={base64}
&qzreferrer=https://user.qzone.qq.com/{uin}/main
```

响应是 `frameElement.callback({...});</script>` 包裹的 HTML——需要**抠出括号里的 JSON**（这也是为什么要自己写 parser）。返回 `{albumid, lloc, type, height, width}`。

**拼接 `richval`**（源码 `toQzoneRichval`）：

```
,{albumid},{lloc},{lloc},{type},{height},{width},,{height},{width}
```

多张图用 **`\t`** 拼接。

**2) 发布说说**

```
POST https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6
Content-Type: application/x-www-form-urlencoded

syn_tweet_verson=1&paramstr=1&con={正文}&feedversion=1&ver=1
&ugc_right={1|4|16|64|128}&to_sign=0&hostuin={uin}
&code_version=1&format=json
&qzreferrer=https://user.qzone.qq.com/{uin}/main
[&richtype=1&richval={richval}]           // 有图才带
[&allow_uins={uin1|uin2}&who=1]           // 16/128 才带，多个用 | 拼接
```

响应：`{subcode|code, tid, t1_tid, message}`；成功判定 `subcode==0`，`tid` 取 `t1_tid || tid`。

**3) 删除说说**

```
POST .../cgi-bin/emotion_cgi_delete_v6
hostuin={uin}&tid={tid}&t1_source=1&code_version=1&format=json&qzreferrer=...
```

#### 核心密钥：`bkn` / `g_tk` 怎么算

所有 qzone/qun.qq.com 请求都要 `g_tk`（也叫 `bkn`），由 **`skey`（或 `p_skey`，即 qzone 域的 skey）** 算出：

```js
// 来自 QZone 前端 interface_mini.js / qzfl_v8_2.1.65.js
QZONE.FrontPage.getACSRFToken = function(e) {
  var t;
  if ((e = QZFL.util.URI(e)) && e.host &&
      0 < e.host.indexOf("qzone.qq.com") ? t = QZFL.cookie.get("p_skey")
                                          : t = QZFL.cookie.get("skey"), !t)
    try { t = parent.QZFL.cookie.get("p_skey") || "" } catch (e) { t = QZFL.cookie.get("p_skey") || "" }
  for (var n = 5381, o = 0, i = (t = t || QZFL.cookie.get("skey") || QZFL.cookie.get("rv2")).length; o < i; ++o)
    n += (n << 5) + t.charAt(o).charCodeAt();
  return 2147483647 & n
}
```

即 **djb2 变体**：

```python
def bkn(skey: str) -> int:
    n = 5381
    for ch in skey:
        n += (n << 5) + ord(ch)   # 注意：先加再移位，且是 n += n<<5
    return n & 0x7FFFFFFF
```

要点：
- 域名含 `qzone.qq.com` → 用 **`p_skey`**；否则用 **`skey`**；取不到再退化到 `rv2`；
- 结果 `& 2147483647`（清符号位）；
- NapCat 里对应 `getBknFromCookie(cookieObject)`，cookie 通过 `getCookies('qun.qq.com' | 'qzone.qq.com')` 拿。

> **这就是"cookie/gtk/bkn"三件套的完整答案**。但注意：**cookie 来源于已登录客户端**——你必须先有一个登录态的 NTQQ（NapCat）或协议端，才能拿到 skey/p_skey。这就是为什么"发说说"在非官方路径上**必然绑定一个登录态账号**。

### 2.7 风控与封号：真实风险画像

**结构性的**：

1. **违反 ToS**。【官方】[运营规范](https://bot.qq.com/wiki/business/) 5.4「外挂行为」明写："未经腾讯书面许可，不得使用或推荐、介绍使用**插件、外挂或其他违规第三方工具、服务**接入本服务和相关系统。" —— 协议端本身即处在这一条的射程内。
2. **协议端是"未经许可的客户端"**。NTQQ hook 走的是真实客户端流量，特征最接近真人；纯协议实现（Lagrange）需要自己复现登录/加密/心跳，**更容易被设备指纹与协议检测命中**【推测，但社区共识】。

**已发生的恶性事件（最有说服力的封号证据）**：

- **2025-09**：大量暴露在公网的 NapCat WebUI 被扫描（默认监听 `0.0.0.0`、默认 token 固定为 `napcat`、无搜索引擎防护），攻击者通过暴露的 **OneBot 11 API 在 QQ 群发布违法信息**，导致**受波及的 QQ 账号与群聊被永久封禁**。【社区】[我与 NapCat 二三事](https://wesley-young.github.io/2026-02-21-biography-of-napcat)
- **2026-02-21**：NapCat 官方 1/3/4 号群解散（插件供应链问题：某抢红包插件 + 某插件私自加好友发消息）；项目 README 一度公开寻找新维护者。**但项目本身仍在高速迭代**（2026-10-21 仍在发版），"解散群"不等于"停更"。【社区 + 仓库核验】

> 这条给架构的直接教训：**如果你要上非官方通道，绝不能把 OneBot HTTP/WS 端口暴露在公网**，必须 `127.0.0.1` 或内网 + 强 token + 反代白名单。

**具体风控因子**（社区经验汇总）：

| 因子 | 风险 | 缓解 |
|---|---|---|
| 异地/异常 IP 登录 | 高（触发验证码/冻结） | 与账号常用地同城机房/家宽；固定出口 IP |
| 登录态频繁重建 | 中高 | 持久化 session，避免频繁扫码 |
| 设备指纹变化 | 高 | 固定设备型号/版本伪装，不随意升级 |
| 消息频率/相似度 | 高（机器人特征） | 打字延迟、分条发送、随机化、`set_input_status` 拟人 |
| 新号/小号 + 大量加群发消息 | **极高** | 养号 ≥ 2 周；先潜水再发言 |
| 群内被举报 | 高 | 内容安全过滤；避免敏感话题 |
| 纯协议实现（无客户端） | 中高【推测】 | 优先 hook 方案 |

**账号类型的现实做法**（社区通行）：
- **绝不用主号**。主号一旦永封，社交关系链全毁。
- 用**小号/副号**，且最好"有历史"的号（注册 > 6 个月、有好友、有群、有空间内容），新号风控阈值极低。
- 一个协议端实例 = 一个号；**不要一号多端并发**。
- 如果用户坚持"就是我自己那个号"，必须书面告知**永久封号**风险，并做好"随时切换到官方通道"的降级预案。

---

## 3. 底层逻辑总结

### 3.1 链路图

**A. 官方链路**

```
┌──────────────┐   ① 用户/群主在手机QQ里
│ 手机/PC QQ   │      添加机器人 + 授予「全量消息/主动推送/撤回」权限
└──────┬───────┘
       │ ② QQ 后端产生事件
       ▼
┌──────────────────────────────────────────────┐
│ 腾讯 QQ Bot 网关                              │
│  · 鉴权：Authorization: QQBot {AccessToken}   │
│  · 事件序列化 → payload{id,op,s,t,d}          │
│  · 富媒体：file_info(file_type=1/2/3/4)       │
└──────┬──────────────────────────┬────────────┘
       │ Webhook(HTTPS,80/443/     │ WebSocket(wss://api.bot.qq.com)
       │ 8080/8443, ed25519签名)   │ op:10 Hello→2 Identify(1<<25)
       ▼                          ▼   →0 Dispatch / 6 Resume
┌──────────────────────────────────────────────┐
│ 你的 Bot 服务端                                │
│  ③ 事件分发：t=GROUP_MESSAGE_CREATE /          │
│     GROUP_AT_MESSAGE_CREATE / C2C_...          │
│  ④ 消息解析：content + attachments             │
│     (voice_wav_url / asr_refer_text) +         │
│     msg_elements(递归) + ark_data              │
│  ⑤ 身份：group_openid / member_openid（per-bot）│
│  ⑥ 业务：LLM / 记忆 / 情感决策                  │
│  ⑦ 出站：POST /v2/groups/{gid}/messages        │
│     msg_type=0|2|7, msg_id 被动回复            │
│     语音→先 /files 上传得 file_info            │
└──────────────────────────────────────────────┘
       │
       ▼  ⛔ 无 Qzone 通道（能力边界）
```

**B. 非官方链路（NapCat 为例）**

```
┌───────────────────────────────────────────────┐
│ NTQQ 客户端进程（NapCat 自带精简版，无头）        │
│  ┌─────────────────────────────────────────┐  │
│  │ Hook 层                                  │  │
│  │  · JS 层：调用 wrapper.node 封装 API      │  │
│  │  · Native Hook(V3)：直接收发 QQ 数据包    │  │
│  └───────────────┬─────────────────────────┘  │
│                  │ 事件（原生消息对象）          │
│  ┌───────────────▼─────────────────────────┐  │
│  │ OneBot 11 适配层 (packages/napcat-onebot)│  │
│  │  · 事件转换 → post_type=message/notice/... │  │
│  │  · 消息段序列化 → [{type:"record",...}]   │  │
│  │  · Action 路由 (action registry + _async) │  │
│  └───────────────┬─────────────────────────┘  │
└──────────────────┼────────────────────────────┘
     HTTP API │ WS 正向 │ WS 反向 │ HTTP POST
              ▼
┌───────────────────────────────────────────────┐
│ 你的 Bot 服务端（NoneBot2 / 自研）              │
│  · message 事件天然全量                        │
│  · get_group_msg_history 拉历史                │
│  · get_group_member_list 拿真实 QQ 号          │
│  · record 段发语音 → encodeSilk → NT-SILK      │
│  · send_group_ai_record 用 QQ 内置 AI 音色     │
│  · send_qzone_msg → emotion_cgi_publish_v6     │
│      ↳ 需 cookie(skey/p_skey) → bkn/g_tk       │
└───────────────────────────────────────────────┘
```

**两条链路最本质的差异，一句话**：

> **官方是"事件驱动的受限 API"**——平台决定你能看到什么、能发什么，你拿到的是脱敏后的 `openid` 和受限的消息类型；
> **非官方是"劫持一个真实账号"**——你继承了这个 QQ 号的**全部权限与全部风险**，包括它的 cookie、它的设备指纹、它的封号概率。

### 3.2 能力矩阵（三件事 × 两条路）

| 能力 | 官方 QQ Bot | 非官方（NapCat） | 差异本质 |
|---|---|---|---|
| **看群聊：实时全量** | ✅ `GROUP_MESSAGE_CREATE`，**需群主授权** | ✅ `message` 事件**默认全量** | 官方要授权；非官方不需要 |
| **看群聊：历史消息** | ❌ **无接口** | ✅ `get_group_msg_history`（go-cqhttp 扩展） | 官方只能自己落库 |
| **看群聊：语音转文字** | ✅ **事件自带 `asr_refer_text`** | ⚠️ 需主动调 `fetch_ptt_text` | **官方反而更省事** |
| **看群聊：谁在说话** | ⚠️ 只有 `member_openid` + 昵称 | ✅ **真实 QQ 号 + 群名片 + 入群/最后发言时间** | 官方身份是"沙箱内"的 |
| **看群聊：群成员列表** | ⚠️ 内邀（30/页，白名单） | ✅ `get_group_member_list` | 官方对个人基本关死 |
| **看群聊：群文件** | ❌ 无浏览接口 | ✅ 完整群文件 CRUD | — |
| **看群聊：表情回应/戳一戳** | ❌（仅频道） | ✅ `set_msg_emoji_like` / `send_poke` | — |
| **发消息：群内主动** | ✅ 60qpm / 20qpm / 1000 条/群/天，**可被群管关闭** | ✅ 无平台配额，但受风控 | 官方有配额，非官方有封号 |
| **发消息：富文本** | ✅ Markdown + keyboard 按钮 | ⚠️ 仅文本/图片/XML/JSON 卡片 | 官方 UI 能力更强 |
| **发语音** | ✅ `msg_type=7` + `file_type=3`（silk/mp3/wav/ogg，20MB） | ✅ `record` 段 + NT-SILK | **两边都能，官方更合规** |
| **发语音：AI 音色** | ❌ | ✅ `send_group_ai_record`（QQ 内置 AI 声聊） | NapCat 独有 |
| **发语音：变声** | ❌ | ✅ `record.magic=1` | — |
| **发语音：接收** | ✅ `voice_wav_url`（已转 WAV） | ⚠️ 需 `get_record` + ffmpeg 转码 | **官方更省事** |
| **发动态：QQ空间说说** | ❌ **完全无** | ✅ `send_qzone_msg` / `delete_qzone_msg` | **决定性差异** |
| **发动态：带图** | ❌ | ✅ 自动上传 + `richval` | — |
| **发动态：权限控制** | ❌ | ✅ `ugc_right` 5 档 + `target_uins` | — |
| **身份一致性** | ❌ per-bot `openid`，拿不到 QQ 号 | ✅ 就是那个 QQ 号 | 跨平台对齐的关键 |
| **合规性** | ✅ 官方许可 | ❌ 违反运营规范 5.4 | — |
| **稳定性** | ✅ SLA 级 | ⚠️ 随时可能因 QQ 更新失效 | — |
| **封号风险** | 低（封的是机器人，可申诉/重注册） | **高（永久封号，不可恢复）** | — |

### 3.3 推荐架构

**推荐：官方为主 + 非官方为"感知旁路"的混合双通道**

```
                    ┌─────────────────────────────────┐
                    │      AI 陪伴核心（单一身份）      │
                    │  · Persona / 长期记忆 / 情感状态  │
                    │  · 生活事件图谱（谁、何时、说了啥）│
                    │  · 出站决策：文本? 语音? 动态?     │
                    └───────┬──────────────┬──────────┘
                            │              │
              ┌─────────────▼───┐   ┌──────▼─────────────┐
              │ 通道A：官方Bot   │   │ 通道B：NapCat(小号) │
              │ 主通道 / 合规    │   │ 旁路 / 感知增强      │
              │ · 群全量消息     │   │ · 历史消息回溯       │
              │ · 主动/被动发消息 │   │ · 群成员真实QQ号     │
              │ · 语音收发       │   │ · 群文件             │
              │ · Markdown+按钮  │   │ · 发说说(Qzone)      │
              └─────────┬───────┘   └──────┬─────────────┘
                        │                  │
                        └────────┬─────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │ 统一事件总线 + 身份对齐层 │
                    │ openid ↔ QQ号 映射表      │
                    │ 去重 / 时序 / 上下文重建  │
                    └─────────────────────────┘
```

**为什么这样分**：

1. **主身份必须是官方 Bot**。它合规、稳定、"AI 就是 AI"，不会被封；而且官方已经支持群全量消息 + 语音收发 + Markdown 按钮，**覆盖了 80% 的陪伴需求**。
2. **非官方只补官方给不了的 4 件事**：历史消息、真实 QQ 号、群文件、说说。
3. **身份对齐层是必需的**——因为官方 `member_openid` 与非官方 `user_id` 是两套 ID，必须在你的记忆库里维护 `openid ↔ QQ号` 映射（可通过"同一句话在两个通道同时出现"的时间戳+内容指纹做匹配，或让用户主动授权绑定）。
4. **降级开关**：非官方通道随时可能挂，核心陪伴逻辑必须能在"只有官方通道"时完整运行。

**"AI 在群里潜水读消息、偶尔发言"的针对性建议**：

| 决策 | 建议 | 理由 |
|---|---|---|
| 主通道 | **官方 Bot + WebSocket** | 群全量消息已支持；WS 常驻便于主动推送；无需公网 80/443 |
| 潜水 | 官方 `GROUP_MESSAGE_CREATE` 全量接收，**只落库不回复** | 零成本、零风险 |
| 偶尔发言 | 优先**被动回复**（蹭 `msg_id`，5 分钟/5 次，不占配额）；其次主动消息（60qpm） | 配额是硬约束，被动回复几乎免费 |
| 发言触发 | 语义触发（被叫到/话题相关/情绪高点）+ **强频控**（如每群每小时 ≤ 1 条） | 避免"AI 话痨"被踢 |
| 语音 | 官方 `msg_type=7` + TTS→silk | 合规且已支持 |
| 历史/成员 | 只在**确实需要**时上 NapCat 旁路 | 别为了"以防万一"先背上封号风险 |
| 部署 | 官方服务端放云（任意地域）；**NapCat 必须放与账号同城的家宽/固定 IP 机器**，端口只绑 `127.0.0.1` | 异地登录是头号风控因子 |

**部署形态对比**：

| 形态 | 适用 | 优点 | 缺点 |
|---|---|---|---|
| **官方 Webhook** | 有公网域名 + 证书，想 serverless | 无常驻连接、易水平扩展 | 端口限 80/443/8080/8443；需处理 ed25519 验证；有重试/去重负担 |
| **官方 WebSocket** | 单机常驻（**推荐**） | 无需公网入口、天然支持主动推送、Resume 补事件 | 需自己管心跳/重连/分片 |
| **本机客户端 Hook**（NapCat + 本机 NTQQ） | 家里有常开 PC，想最低风控 | 流量最像真人、能拿 cookie 发说说 | 依赖那台机器；断电即掉线；无头部署仍需 Linux/Windows 兼容 |
| **服务器协议端**（Lagrange.Core） | 云服务器、无 GUI | 最干净、可容器化、资源占用低 | **协议检测风险最高**【推测】；功能覆盖不如 NapCat（无说说/无 AI 语音） |

### 3.4 分阶段落地建议

**Phase 1（1–2 周，纯官方，零风险）**
- 个人主体认证 → 创建 Bot → 拿 AppID/AppSecret
- WebSocket 接入，订阅 `1<<25`
- 群主（你自己）用最新版手机 QQ 把 Bot 拉进群，**开启"接收全量消息"+"主动推送消息"**
- 打通：全量消息落库 → LLM → 被动回复 / 主动消息
- 打通语音：TTS → silk → `msg_type=7`
- ✅ 此时已经能实现"潜水读消息 + 偶尔发言 + 发语音"

**Phase 2（按需，1 周，引入旁路）**
- 只在确认"必须要历史消息/真实 QQ 号/说说"时才做
- 小号养 2 周 → NapCat v4.18.41 → 仅内网 → 只读为主
- 建 `openid ↔ QQ号` 映射
- 说说：`send_qzone_msg`，先做"草稿 + 人工确认"再自动发

**Phase 3（可选）**
- 若"发说说"是核心功能 → 必须接受"非官方 + 封号风险"，并做**多小号池 + 自动切换**
- 若企业化 → 转企业主体，解锁公开使用 + 更高额度

---

## 4. 仍需你确认的 8 个关键决策点

1. **"发动态"是硬需求还是 nice-to-have？**
   如果是硬需求 → 官方路径直接出局，必须接受 Non-official + 封号风险，产品叙事要改成"半自动/草稿确认"。
   如果是可选 → 全部走官方，风险归零。**这一条决定整个架构。**

2. **"理解陪伴对象的生活"需要精确到哪个粒度？**
   只需要"群里聊了什么" → 官方 `GROUP_MESSAGE_CREATE` 足够（且自带语音 ASR）。
   需要"这个人是谁、什么时候入群、上次说话是什么时候" → 必须上 NapCat 拿 `get_group_member_list`。**中间没有折中方案。**

3. **能不能接受"AI 的 QQ 身份不是真实 QQ 号"？**
   官方 Bot 的 `openid` 无法反查 QQ 号。如果陪伴对象需要在"别的地方"（如游戏、其他 App）认出这个 AI，或有"加好友"预期 → 官方做不到，只能用协议端。

4. **主号还是小号？封号的止损线在哪？**
   如果用主号：请明确写下"接受永久封号"。
   如果用小号：能否接受"小号被封 → AI 失忆/换号 → 需要重新加群"？换号后的记忆迁移方案要不要做？

5. **群主授权是否可控？**
   官方全量消息**必须群主手动在手机 QQ 上开权限**（且要最新版客户端）。如果群不是你自己建的、或群主不愿意/不会操作，**官方全量消息直接拿不到**，只能退化为"仅 @ 消息"。此时唯一解是协议端。

6. **部署环境在哪？**
   官方：任意云均可（WS 出站即可）。
   NapCat：**强烈建议与账号常用登录地同城**的家宽/固定 IP 机器，且该机器需长期在线。你有没有这样一台机器？

7. **主动消息被关闭时怎么办？**
   用户/群管可在资料卡一键关闭主动消息（`C2C_MSG_REJECT` / `GROUP_MSG_REJECT`）。你的产品是否需要"检测到关闭 → 通知用户/降级为被动回复"的兜底？还是就接受"静默失联"？

8. **语音用谁的音色？**
   自建 TTS（可控、要转 silk、要自己兜音质）vs QQ 内置 AI 音色（`send_group_ai_record`，零成本但音色受控、属未公开接口、拿不到 message_id）。这一条影响"AI 人设一致性"。

---

## 附录：关键来源与核验时间

| 来源 | URL | 页面更新/核验 | 用途 |
|---|---|---|---|
| 通用数据结构 / Intents | https://bot.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/payload.html | 2026-07-21 | OpCode、intents 位表 |
| 群消息（全量模式） | https://bot.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html | **2026-10-21** | `GROUP_MESSAGE_CREATE` 字段 |
| 群@机器人消息 | https://bot.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html | 2026-09-16 | `GROUP_AT_MESSAGE_CREATE` |
| 获取访问凭证 | https://bot.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html | 2026-09-16 | AccessToken/刷新 |
| API 调用指南 | https://bot.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html | 2026-09-17 | 鉴权头、openid、错误码 |
| 消息收发概述 | https://bot.qq.com/wiki/develop/api-v2/server-inter/message/overview.html | 2026-07-21 | 主动/被动、频控表 |
| 发送群聊消息 | https://bot.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html | 2026-09-03 | 端点、字段、错误码 |
| 消息类型 | https://bot.qq.com/wiki/develop/api-v2/server-inter/message/type/overview.html | 2026-07-23 | 收发能力矩阵 |
| 富媒体消息 | https://bot.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html | 2026-07-21 | **语音 file_type=3**、分片上传 |
| 获取群成员列表 | https://bot.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_members.get.html | 2026-09-03 | 内邀、30/页 |
| Webhook 方式 | https://bot.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html | 2026-09-11 | ed25519 验证、端口白名单 |
| WebSocket 方式 | https://bot.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html | 2026-07-30 | Identify/Resume/分片/错误码 |
| 变更记录 | https://bot.qq.com/wiki/develop/api-v2/changelog.html | 2026-10-21 | 域名统一、群管理新增 |
| 常见问题 | https://bot.qq.com/wiki/bot_FAQ/ | 2026-10-21 | **群主三项权限**、个人主体限制、沙箱取消 |
| 运营规范 | https://bot.qq.com/wiki/business/ | 2023-11-09 | 5.4 外挂条款、内容安全 |
| Agent 接入（OpenClaw/Hermes/dsh） | https://bot.qq.com/wiki/agent-qqbot/ | 2026-10 | 官方 AI Agent 生态、`requireMention:false` |
| OneBot 11 标准 | https://github.com/botuniverse/onebot-11 | 核验 2026-10-21 | 事件/API/消息段 |
| OneBot 12（候选） | https://12.onebot.dev/ | 核验 2026-10-21 | 仍是 Candidate |
| NapCatQQ 源码 | https://github.com/NapNeko/NapCatQQ | **v4.18.41 / 2026-10-21** | action registry、qzone、silk |
| └ action registry | `packages/napcat-onebot/action/index.ts` | 核验 2026-10-21 | 全部 action 名 |
| └ Qzone 底层 | `packages/napcat-core/data/qzone.ts` | 核验 2026-10-21 | `emotion_cgi_publish_v6` 等 |
| └ SILK 编码 | `packages/napcat-core/helper/audio.ts` | 核验 2026-10-21 | `convertToNTSilkTct` |
| └ AI 语音 | `packages/napcat-onebot/action/group/SendGroupAiRecord.ts` | 核验 2026-10-21 | `GetAiVoice` |
| LuckyLilliaBot（原 LLOneBot） | https://github.com/LLOneBot/LuckyLilliaBot | **v8.3.2 / 2026-10-12** | OneBot11/Satori/Milky |
| Lagrange.Core | https://github.com/LagrangeDev/Lagrange.Core | nightly / 最后提交 2026-09-07 | 纯协议、已支持 Milky |
| go-cqhttp | https://github.com/Mrs4s/go-cqhttp | **v1.2.0 / 2023-10-09**，README 明写停止维护 | 已死 |
| NapCat 历史与风险 | https://wesley-young.github.io/2026-02-21-biography-of-napcat | 2026-02-21 | 2025-09 封号事件、群解散 |
| bkn/g_tk 算法 | https://www.77bx.com/466.html | 2023-08-24 | QZone 前端 `getACSRFToken` 原文 |

---

*本报告基于 2026-10-21 可公开访问的官方文档与开源仓库源码。官方文档更新频繁（`GROUP_MESSAGE_CREATE` 页面当天仍在更新），落地前请再次核对。*
