# P0 进度与证据

最后更新：2026-10-21

## 已完成

| ID | 任务 | 结果 |
|---|---|---|
| P0-01 | 仓库分层 | 新增 `packages/core`（公开契约）；`private/` 已进 `.gitignore`；新增 `scripts/check-core-boundaries.mjs` 和 `npm run check:core` |
| P0-02 | 增量消息持久化 | 新增 `messages.sync` + `phase2:timeline:sync-messages`；`savePersistentChatHistory` 从“逐条 IPC”改为“一次事务同步”；插入/更新/删除/清空都有测试 |
| P0-04 | Observation / Experience / Sync schema | schema v6：`channel_accounts`、`identity_links`、`observations`、`experiences`、`activity_sessions`、`sync_ops`；`memory_items` 增加 audience/importance/provenance/supersedes/source_observation_ids/recall 字段 |
| P0-04 | 最小仓储 | `channelAccounts`、`identityLinks`、`observations`、`experiences`、`syncOps` 的插入/查询；带 dedupe、audience/provenance 测试 |
| P0-03 | Core daemon | `electron/core/server.ts`：独立 HTTP 服务，复用 SQLite；`/health`、characters、timeline messages/sync、memory、observations、experiences、sync ops、SSE `/v1/events`；token、CORS、优雅关闭 |
| P0-03 | Core 启动方式 | `npm run core:serve`；`HEREIN_CORE_HOST/PORT/TOKEN`、`HEREIN_DATA_DIR`、`HEREIN_DB_PATH`；非 loopback 必须设 token |
| P0-03 | 模型网关 | `electron/core/llm.ts` + `POST /v1/chat`：OpenAI-compatible、私钥文件、超时、usage；真实 `llm.json` 冒烟 1 次通过（3.7s，`persist:false`） |
| P0-03 | 聊天上下文 | `buildCoreChatPrompt`：角色/关系/最近总结/记忆预算/回复形态拼进 `/v1/chat`；群聊排除 private 记忆；2 个测试 |
| P0-10 | Android 壳 + APK | Capacitor 8.5.3 + `android/`；`MobileApp.tsx` 移动聊天页；JDK 21 + Android SDK 36 已装；APK `exports/herein-debug.apk`（4,493,192 bytes，SHA256 `30DC6DA1...B3F5`） |
| P0-13 | Android 状态 | 聊天页系统状态芯片/抽屉；每 20s 轮询 `/v1/status`；展示 Core/DB/模型/声音/插件 |
| P0-13 | Android SSE | 监听 `core` 事件：`chat.completed`/`timeline.synced`/`assistant.proactive` 后重拉时间线 |
| P1a | 已读状态 | schema v10 `timeline_read_state`；Core `GET/POST /v1/read-state/:characterId`；Android 刷新后标记最后一条已读 |
| P1a | 离线发送 | schema v11 `chat_idempotency`；Core `/v1/chat` 支持 `clientMessageId` 去重；Android localStorage outbox + “待发送” + online/重开自动补发；详见 `docs/OFFLINE.md` |
| P1a | 桌面增量同步 | Core `/v1/timeline/:id/apply`：`upserts` + 显式 `deletes`，不 prune 其他消息；桌面用 localStorage 指纹差量，只发变化和删除 |
| P0-10 | 连接页 UX | “换地址”不再清 Token；保留地址/Token；粘贴 Token、显示/隐藏、清除记录（显式确认）；关闭自动大写/纠错 |
| P1b | 移动聊天基础版 | 手机填 `http://192.168.1.3:8787` + token，拉历史、发消息、走 Core `/v1/chat`；浏览器可用 `?mobile=1` 预览 |
| P1a | 桌面 Core 路径 | `coreClient.ts` + 设置页 Core 地址/Token；聊天走 Core `/v1/chat`（含关系/记忆上下文），记录同步走 Core HTTP，失败回退本地 API；`parseAssistantMetadata` 提取 emotion/voice |
| P3 | B 站只读适配器 | `adapters/bilibili`：WBI、nav（兼容 -101）、view/rcmd/conclusion/player、搜索、分P、字幕原文、限速、错误类型；7 个测试；真实 rcmd 5 条通过，view 当前 IP 412 |
| P3 | 字幕优先 | `searchVideos` + `getSubtitleText`：优先 ai-zh/zh-CN/zh，抓 `subtitle_url` 正文，过滤“字幕by”署名；空/只有署名标记 empty，调用方可跳过 |
| P3 | B 站 Activity | `scanBilibiliFeed`：推荐流 → observations + activity_sessions；Core `/v1/bilibili/scan`、`/v1/activity`；重复扫描按天去重 |
| P4 | 网易云匿名适配器 | `adapters/netease`：搜索/歌曲/歌词/歌单/榜单/公开推荐、限速、错误类型；3 个测试；匿名实测 64 榜单、37 搜索结果、歌词可用 |
| P4 | ContentProfile | `packages/core/src/content.ts`：LRC 取 hook（跳过作词/作曲等 credit）、歌名/歌手/专辑映射、按 type+id 去重；3 个测试 |
| P4 | 推荐闸门 | `packages/core/src/recommendation.ts`：用户低落/冷却/轮次/7 天重复闸门 + JSON 决策校验；4 个测试 |
| P4 | 推荐服务 | `electron/services/contentRecommender.ts`：读私有 prompt、替换变量、走 Core LLM、JSON 解析、闸门短路；Core `POST /v1/recommend`；2+1 个测试 |
| P4 | 候选池 | `electron/services/neteaseCandidates.ts`：搜索/榜单→歌单→ContentProfile；Core `POST /v1/netease/candidates`；3+1 个测试 |
| P4 | 真实端到端 | 网易云 3 首候选 → Core `/v1/recommend` → 真实 LLM：`shouldRecommend:true`，理由“这首 evening 名字就写着夜晚…”，4.5s |
| P4 | 聊天内推荐 | 移动端识别“想听歌/好无聊/推荐首歌”，拉候选 → Core 推荐 → 歌卡；45 分钟冷却 + 7 天重复本地记录；意图/冷却单测 |
| P4 | 服务端状态 | schema v8 `recommendation_events`；`/v1/recommend` 无 gate 时读服务端冷却/7 天重复；推荐成功落库；`/v1/recommend/feedback`、`/v1/recommendations` 仍在 |
| P4 | 随手转发 | 移动端改成“短句 + 歌曲卡片”：去掉“推荐一首”标签和喜欢/跳过按钮；显式“想听歌”之外，低频主动分享（75 分钟冷却/18% 概率/低落抑制）；prompt 的 reason 改为 ≤20 字随口话；封面来自 NetEase 专辑图 |
| P4 | 后台低频分享 | `ProactiveShareScheduler`：90 分钟一次、服务端冷却/7 天去重、落库、`song.shared` SSE；Core `POST /v1/proactive/share/run`；移动端 EventSource 收到后插卡；`HEREIN_PROACTIVE_SHARE=1` 开启 |
| P4 | 离线推送 | `electron/services/ntfy.ts`：分享时 POST ntfy；`HEREIN_NTFY_URL/TOPIC/TOKEN/CLICK`；APP 关闭时靠 ntfy app 收通知；`docs/PUSH.md` |
| P4 | 候选/反馈打磨 | 移动端默认走中文榜单，不再用“夜晚”关键词搜出俄语歌；`likedItemIds/skippedItemIds` 进入 taste，prompt 明确不推 skipped |
| P3 | 参考 dsh-bili-scroll | 采纳字幕优先/空字幕判空/素材非指令/只读工具面；不采纳 Python MCP、扫码登录、发评论；笔记在 `docs/research/dsh-bili-scroll-notes.md` |
| P1c | 远程访问 | Caddy 80 `/herein` + SSH `-R` 到本机 Core；token 保护；实测无 token 401、带 token 200；酒馆 8000 仍 401；`npm run tunnel` + `docs/REMOTE.md` |
| P0-11/P5 | QQ 适配器骨架 | `adapters/qq`：token 缓存、gateway、群/私聊被动文本、事件归一化、identify payload、WS 心跳/READY/事件分发/可选重连；5 个测试；凭证后置 |
| P0-11/P5 | QQ listener 落库 | `electron/services/qqListener.ts`：配置加载、fake/真实 gateway、归一化→observations、停止清理；Core `HEREIN_QQ_ENABLED=1` 启动；2 个测试 |
| P0-11/P5 | QQ 被动回复 | `responder` 接线：@群消息/私聊 → 被动 `msg_id` 文本回复；默认关闭；`createQQResponder` 用 Core 上下文生成并剥标签；测试覆盖 |
| P0-11/P5 | QQ 语音接收 | `attachments[].voice_wav_url` + `asr_refer_text` → observation.media；空 content 用 ASR 文本；测试覆盖；发送 SILK 仍未做 |
| P0-11/P5 | QQ 语音发送 API | URL 上传 `file_type=3` → `file_info` → `msg_type=7` 被动语音；群/私聊方法；测试覆盖；本地 SILK/分片上传未做 |
| P0-05 | 记忆 v2 持久化 | schema v7：audience/importance/provenance/supersedes/source_observation_ids/recall 字段落库；`memories.search` 用 FTS5 + LIKE fallback；测试覆盖写入/读取/audience 过滤 |
| P0-05 | 记忆预算/受众 | `contextAssembly` 增加 audience 过滤、importance/pinned 排序、`memoryBudgetTokens`（默认 1200）；群聊排除 private；pinned 可超预算 |
| P0-06 | Prompt 引擎 | `packages/core/src/prompts.ts`：L0–L6、`PromptRegistry`、`compilePrompt`、变量校验；3 个测试 |
| P0-06 | Prompt 内容 | `private/prompts/v0/` 10 个文件齐：safety/character/relationship/chat/group/memory_extract/summary/experience/content_recommend/moderation |
| P0-07 | 角色包 | `packages/core/src/character.ts`：`CharacterPackManifest` + `validateCharacterPack`；3 个测试；私有 `private/characters/haishixiang/character.json` |
| P0-09 | Avatar 契约 | `packages/core/src/avatar.ts`：`AvatarRenderer` / `AvatarLoadOptions` / 工厂类型 |
| P0-09 | Live2D 渲染 | Pixi 7 + Cubism 2 `Live2DStage`；Core `/assets`；`?live2d=1` 演示页；实际加载 Shizuku 成功（canvas 1，模型 624×672）；`docs/LIVE2D.md` |
| P2 | Live2D 接入 | `CallWindow` 已接 `Live2DStage`（Core assets + presentation entry）；APP 右上角“形象”打开全屏 Live2D；手机朗读 RMS 驱动口型已接，桌面口型/正式蓝蓝模型/通话实机未验证 |
| P0-08 | TTS 横评脚本 | `scripts/benchmark_tts.mjs` + `npm run bench:tts`：延迟/音频时长/RTF，支持自定义 endpoint/text |
| P0-08 | TTS 实测 | `D:\AI\tools\qwen_tts\venv`（torch 2.11+cu128/CUDA）+ CustomVoice 1.7B：平均 **4.8s/句，RTF 3.70**；0.6B：**4.87s/句，RTF 3.28**；能出声，未实时。详见 `docs/TTS.md` |
| P0-08/P2 | 手机朗读 | Core `POST /v1/tts` 代理；移动端助手消息“▶ 朗读”；本地 38KB/5.1s，远端 `/herein/v1/tts` 30KB/3.9s |
| P0-08/P2 | 手机口型 | 手机朗读时 Web Audio RMS → `PARAM_MOUTH_OPEN_Y`；tsc 通过，真机未验证 |
| P0-12 | 插件宿主 | schema v9 `plugin_registry` / `plugin_audit`；manifest、注册表、启停/配置/健康/审计、网络权限白名单；Core `/v1/plugins*`；`plugins/weather` + 内置 `bilibili`/`netease`/`qq`；`AgentProvider` 契约 + `/v1/agents*`；15 个插件测试 |
| P0-13 | 状态与控制台 | Core `/v1/status`：Core/DB/LLM/TTS/plugins/agents/relay；桌面新增“系统”控制台；Android 状态芯片/抽屉；weather E2E；通用插件配置表单 |
| P1a | Core 记忆管线 | `CoreMemoryRunner`：`/v1/chat` 与 timeline sync 后触发；按上次 summary.messageCount 只跑新消息；失败不覆盖旧 summary；桌面使用 Core 时不再本地跑 memory |
| P1a | 同步防截断 | Core timeline sync 默认 `prune:false`；普通全量快照不会删除另一台设备后写入的消息；显式删除需 `prune:true` |
| P0-14 | 主动性策略 | `InitiativeEngine`：免打扰/每日上限/冷却/最小空闲/材料判断；LLM 返回 shouldSpeak；写入主时间线 + SSE `assistant.proactive`；Core `/v1/initiative/run`；可选 `InitiativeScheduler`（`HEREIN_INITIATIVE_AUTO=1`）；可选 ntfy 推送；桌面可手动运行；6 个测试 |
| P0-15 | 白蓝设计 | 全 `src` rose/cream 色系切到 sky/白/深海蓝；body/暗色背景、聊天气泡、设置、记忆、通话、Android 统一；`rose-` 残留 0 |

## 验证

- `npx tsc --noEmit` → 0
- `npx tsc -p tsconfig.electron.json --noEmit` → 0
- `npx vitest run` → **54 files / 214 tests passed**
- `npm run check:core` → core boundary ok（10 files）
- `npm run build:core` → 0
- `node scripts/benchmark_tts.mjs --help` → 0
- `npm run core:serve` + `GET /health` 冒烟通过（临时 dataDir，未碰真实数据）
- Core HTTP 已测：`/health`、`/v1/status`、`/v1/plugins*`、`/v1/characters`、timeline messages/sync、observations、token 鉴权
- Core `/v1/chat` 真实 LLM 冒烟：HTTP 200，“在的”，3.7s
- `npm run build` → 0；vite 2241 modules
- Android `assembleDebug` → BUILD SUCCESSFUL；APK `exports/herein-debug.apk`（4,493,192 bytes），SHA256 `30DC6DA1...B3F5`
- Live2D 演示：`?live2d=1`，Electron 中 canvas=1，模型尺寸 624×672；截图受无显示桌面限制
- 远程：`http://147.224.56.120/herein/health` → 无 token 401，带 token 200；`:8000` 酒馆 401

## 尚未完成

| ID | 任务 | 说明 |
|---|---|---|
| P0-03 | 队列/调度 | Core HTTP + 模型网关已有；队列、主动行为调度、桌面 UI 接 Core 还没做 |
| P0-05 | 混合召回 | FTS/LIKE + importance 已做；embedding/触发词/recency 混合排序待做 |
| P0-08 | TTS 实时化 | 1.7B batch RTF 3.70 已实测；还缺 0.6B/流式/C 引擎对比，未接语音通话 |
| P2 | 实时语音/Live2D | Live2D 渲染已通；手机朗读口型已接；桌面口型、正式模型、TTS 实时化未做 |
| P0-10 | 真机验证 | APK 已出；还没装到手机/平板实测 |
| P0-11 | QQ listener | 配置/连接/心跳/归一化/落库/被动回复接线已做；语音、频控、审核、默认回复策略待做，等 `qqbot.json` |
| P1a | Core 双端一致性 | 记忆/已读/离线幂等/桌面增量 apply 已进 Core；跨端实时 read/outbox 未做；本地 IPC 仍写本地 DB，删除已能通过 apply 传播 |
| P0-12 | 插件接入面 | `weather`/`bilibili`/`netease`/`qq` 已是 native plugin；`AgentProvider` 契约已就绪，真实 DSH provider 等 B 交付 |
| P0-13 | 状态完整性 | `/v1/status` 覆盖 Core/DB/LLM/TTS/plugins/agents/relay；Android 后台限制、Agent 能力操作 UI 还没接 |
| P0-14 | 主动性 | 策略/手动/自动调度/时间线/SSE/ntfy 已有；A 的 InteractionPort、App 内通知/在场信号未接 |
| P0-15 | 设计系统 | 调色板已 sweep；语义 token、对比度审计、视觉回归/真机截图未做 |
| P1c | 远程稳定性 | 隧道已通；还没做开机自启/断线自动重连/TLS |
| P3 | B 站 Experience/UI | 适配器已有；ActivitySession、每日摘要、UI“她今天看了什么”未接 |
| P4 | 推荐打磨 | 歌卡/反馈/服务端冷却已有；还缺中文候选过滤、反馈影响排序 |

## 下一步顺序

1. P0-12：接 DSH provider（B 的工作流完成后）。
2. P1a：补 SSE chat/read/outbox、删除传播；桌面从全量快照迁到增量 append。
3. P0-14：接自动调度、A 的 InteractionPort、ntfy/Android 通知和在场信号。
4. P0-13：Android 后台限制；控制台补 Agent 能力操作 UI。
5. 真机装 APK，验证 LAN 聊天、状态芯片、天气插件。
6. P0-08：TTS 实时化（A 的工作流）。
7. P1c：隧道开机自启/断线重连 + TLS/Tailscale。

## Core HTTP

启动：

```powershell
$env:HEREIN_DATA_DIR = "D:\Herein\tmp\core-data"
$env:HEREIN_CORE_HOST = "127.0.0.1"
$env:HEREIN_CORE_PORT = "8787"
npm run core:serve
```

接口：

| Method | Path | 作用 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/v1/characters` | 角色列表 |
| POST | `/v1/chat` | 聊天；支持 `clientMessageId` 幂等重试 |
| GET | `/v1/timeline/:characterId/messages?limit=100` | 主时间线消息 |
| POST | `/v1/timeline/:characterId/sync` | 批量同步消息 `{title,messages}` |
| POST | `/v1/timeline/:characterId/apply` | 增量 `{upserts,deletes,title}`，不 prune 其他消息 |
| GET | `/v1/memory?characterId=&timelineId=&q=&limit=` | 记忆列表/搜索 |
| GET/POST | `/v1/observations` | Observation 读写 |
| GET | `/v1/experiences?limit=20` | Experience 列表 |
| GET/POST | `/v1/sync/ops` | E2EE oplog 读写 |
| GET | `/v1/events` | SSE 事件流 |
| GET | `/v1/status` | Core/DB/LLM/TTS/plugins 健康状态 |
| GET | `/v1/plugins` | 插件清单 + 汇总 |
| POST | `/v1/plugins/install` | 安装插件 `{id}` |
| POST | `/v1/plugins/:id/enable` / `disable` | 启停插件 |
| PATCH | `/v1/plugins/:id/config` | 更新插件配置 `{config}` |
| POST | `/v1/plugins/:id/invoke` | 调用插件 `{action,input}` |
| DELETE | `/v1/plugins/:id` | 卸载插件 |
| GET | `/v1/plugins/audit?limit=100` | 插件审计 |
| POST | `/v1/initiative/run` | 手动运行一次主动策略 `{characterId?}` |
| GET | `/v1/read-state/:characterId` | 读取已读状态 |
| POST | `/v1/read-state/:characterId` | 标记已读 `{lastReadMessageId?}` |
| GET | `/v1/agents` | AgentProvider 列表 + capabilities |
| GET | `/v1/agents/:provider/health` | provider 健康 |
| POST | `/v1/agents/:provider/:capability/:action` | install/enable/disable/remove/rollback/invoke |

非 loopback 绑定必须设置 `HEREIN_CORE_TOKEN`，请求带 `Authorization: Bearer <token>`。

## 边界

- `private/` 不进公开仓库。
- `packages/core` 不 import `src/`、`apps/`、`adapters/`、`private/`、`electron/`。
- 公开仓库不放 demo 角色；只放 schema/空模板/引导。
