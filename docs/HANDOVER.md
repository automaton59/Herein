# 此间 / Herein 交接文档

最后更新：2026-06-20
当前阶段：Phase 3D 本地语音第一版已实现
下一阶段：真实 Electron smoke、真实 Live2D renderer 选型、云语音 provider 评估

## 1. 当前状态

此间（Herein）已从 Phase 1 JSON 桌面聊天应用，进入 Phase 2 的 SQLite-first 本地长期陪伴应用。当前产品方向不是“工作台”，也不是 SillyTavern 式剧情工具，而是一个本地优先的私人 IM 陪伴应用：用户打开后应当像进入一段稳定的聊天关系，而不是进入一套复杂的设定编辑器。

已落地能力：

- Electron + Vite 开发流程可用，`npm start` 会启动 Vite 并打开 Electron 应用。
- 浏览器开发模式仍可用于有限前端调试；Phase 2 完整数据能力以 Electron 为主。
- SQLite `app.db` 成为长期主数据源，Electron main process 持有数据库，renderer 通过 IPC 访问。
- 首次启动会把 Phase 1 `config.json`、`chat-history.json`、`api-profiles.json` 迁移进 SQLite，并保留旧 JSON 备份。
- 支持多 API profile，profile 与 key 配对保存，下次启动可直接选择。
- Electron 下 API key 使用 `safeStorage` 加密，密文保存进 SQLite。
- 支持多角色；每个角色收敛为一条主聊天时间线。
- 支持发送、撤回并打断请求、编辑消息、重新生成、删除后续。
- 默认聊天体验是完整回复出现，不做逐字流式展示。
- 主聊天不显示 thinking/reasoning，也不显示裸露的情绪标签。
- 聊天请求会优先通过 Phase 2 context assembly 拼装角色、总结、记忆和内部回复规则。
- 助手回复后按全局阈值后台触发会话总结和结构化记忆抽取；失败不会阻断聊天。
- 聊天侧有正式记忆面板，可查看当前总结、“下次回复会参考”、禁用记忆，并手动新增/禁用/置顶。
- 设置页有记忆设置，可切换全局记忆模型 profile 和触发阈值；聊天、总结、抽取 prompt 均由产品内部维护，不作为用户配置项暴露。
- 角色设置支持此间内部角色档案导出、完整角色归档导出和路径导入。
- 数据设置支持完整备份 zip 导出/恢复，默认排除 API key 密文。
- UI 已调整为更接近私人 IM：联系人列表、聊天气泡、角色状态、底部输入栏、柔和亮暗主题。
- 主界面已收敛为“一角色一联系人一主聊天”。联系人列表替代角色下拉选择器；角色名是默认显示名，本地备注只影响 UI，不进入 prompt。
- 聊天顶栏的头像/名称是联系人资料入口；资料抽屉可编辑备注、上传头像、进入角色卡设置和清空当前聊天。
- 已加入独立应用设置页，支持应用、API、角色、记忆、数据五个设置面。
- Phase 3A 第一版已实现：聊天顶栏视频通话入口、应用内大通话窗、mini 悬浮窗、单 active call session、切联系人自动 mini、第二通话确认结束当前通话。
- 联系人资料抽屉已加入“形象与表情”，支持上传静态立绘差分并绑定 `neutral/happy/sad/angry/shy/excited/worried` emotion。
- `assets.metadata_json` 已进入 schema v2；`character_presentation_profiles` 已进入 schema v4。expression、video、live2d 资产 metadata 和角色展示 profile 可随 SQLite、全量备份和完整角色归档保存/恢复。
- Phase 3B 展示配置已实现：每个角色可保存默认立绘、fallback emotion 和 emotion -> asset 显式映射；联系人资料抽屉可编辑立绘 label、emotion、priority，并可把某张立绘绑定为指定情绪表情。
- Phase 3C 动态形象已实现第一版：支持导入本地视频循环为 `asset.kind = video`，支持导入 Live2D `.model3.json` 所在包目录为 `asset.kind = live2d`，并在 presentation profile 保存 `dynamicAssetId` 和 `preferredRenderer`。
- Phase 3D 本地语音已实现第一版：通话窗口可用系统 TTS 朗读当前字幕、停止朗读、开启自动朗读；运行环境支持 `SpeechRecognition` 时可把语音识别结果填入通话输入框，再走同一 primary timeline 发送链路。
- 通话窗口复用主聊天发送链路，消息仍写入同一 primary timeline；AI 回复作为字幕显示，并根据最新 assistant message 的 `emotion` 选择立绘差分，缺失时回退头像/占位。
- 通话展示选择已优先读取 presentation profile：动态视频优先渲染为 `<video>` 循环；Live2D 当前显示 adapter 占位并保留静态回退；静态立绘按显式映射、emotion/priority、fallback emotion、默认立绘和 neutral 顺序回退。
- 联系人资料抽屉可上传视频动态形象、导入 Live2D 入口文件、选择动态形象和渲染偏好；删除动态资产会清理 profile 引用。
- 完整角色归档会保存 expression/video/live2d 资产 metadata，导入时重映射 `defaultAssetId`、`emotionAssetMap` 和 `dynamicAssetId`，并保留 Live2D 包目录里的附属文件。

Phase 2 现在可以视为核心功能基本收尾，Phase 3A/3B/3C/3D 已有可测试实现。继续后续真实 Live2D renderer 或云语音 provider 前，建议先做一次真实 Electron smoke 和打包验证，把当前底座从“自动测试通过”推到“可作为后续稳定底座”。

Phase 3 后续展开仍以 `docs/PHASE3-HANDOVER.md` 为准。

## 2. 如何运行

安装依赖：

```bash
npm install
```

启动 Electron 开发版：

```bash
npm start
```

仅启动浏览器开发服务器：

```bash
npm run dev
```

`npm start` 会先执行 `npm run native:rebuild:electron`，确保 `better-sqlite3` 的 native module 与 Electron ABI 匹配。`npm run test:run` 会先 rebuild Node ABI。频繁在 Electron 和 Node 测试之间切换时，如果又出现 native module 版本不匹配，先重新跑对应脚本。

构建前端：

```bash
npm run build
```

编译 Electron 主进程：

```bash
npm run electron:compile
```

当前 `electron:compile` 使用 `tsconfig.electron.json`，避免了早期 `tsc electron/main.ts ...` 与 `tsconfig.json` 冲突导致的 TS5112 问题。

## 3. 数据位置与安全

Electron 版本的数据不写入仓库目录，而是写入 Electron 的 `userData` 目录：

```text
%APPDATA%\herein\data\
```

当前长期数据：

- `app.db`：SQLite 主数据库。
- `assets/`：头像、表情、视频动态形象、Live2D 包等大文件目录。
- `backups/`：默认备份导出目录。
- `exports/`：默认角色档案导出目录。

Phase 1 迁移输入和备份文件：

- `config.json`：角色、当前角色、当前 API profile id、主题等应用配置。
- `chat-history.json`：会话和消息记录。
- `api-profiles.json`：API profile 列表。API key 字段不会以普通明文保存。

SQLite 已覆盖 API profiles、设置、角色、主时间线、消息、关系、记忆、总结、记忆任务日志和资产索引。大文件资产留在文件系统，SQLite 保存引用和 metadata。

API key 处理方式：

- Electron 下优先使用 `safeStorage.encryptString()`，保存为 base64，并标记为 `safe:v1`。
- 如果 `safeStorage` 不可用，会降级为 `plain:fallback`。这主要用于开发或特殊环境，不建议作为长期真实使用方式。
- Phase 2 使用 `safeStorage`，密文保存进 SQLite。

仓库已在 `.gitignore` 中兜底忽略：

- `data/`
- `secrets/`
- `*.local.json`
- `api-profiles*.json`
- `config.local.json`
- `chat-history.local.json`
- 后续应继续忽略本地 SQLite 数据库、SQLite journal/WAL 文件、assets、backup 包。

提交前仍建议搜索一次真实 key 前缀，确认没有被写入源码、测试数据或文档。

## 4. Phase 1 已完成能力

### 4.1 API Profile

- 新建、选择、保存、删除 profile。
- profile 包含 provider、baseURL、model、temperature、maxTokens、lastConnectedAt 等字段。
- 支持测试连接和拉取模型列表。
- 当前 `llmConfig` 从 active profile 派生，不再把 key 散落在普通配置里。

### 4.2 本地存储

- Electron IPC 存储桥：`storage:read`、`storage:write`、`storage:delete`。
- Electron secret 桥：加密和解密 API key。
- 浏览器模式用 localStorage 模拟文件存储，保持有限开发可用。
- 首次启动会兼容迁移旧的 localStorage 数据，旧数据不会被自动删除。

### 4.3 聊天行为

- 用户发送后，角色状态进入“正在输入...”。
- 发送中的用户消息支持撤回，撤回会 abort 当前请求并移除该消息。
- 请求成功后追加完整助手消息，状态回到“在线”。
- 请求失败时保留用户消息并标记失败，同时显示错误。
- 支持用户和助手消息编辑。
- 支持从用户消息或助手消息重新生成。
- 支持删除某条消息之后的全部后续消息。
- 切换会话时 pending 状态不再跨会话显示。
- thinking/reasoning 只作为底层解析信息，不作为聊天正文展示。
- 情绪标签会从文本里剥离，只作为 `emotion` 元数据保留，用于表情立绘选择，并为后续真实 Live2D renderer 和更细展示状态准备。

### 4.4 角色与主时间线

- 支持多角色。
- 每个角色默认只有一条主聊天时间线。
- Phase 1 同角色多会话迁移时会保留为主时间线和历史归档。
- 角色卡目前是内部结构化资料，不走世界书或复杂设定集方向。
- 角色设置已加入此间内部角色档案导入/导出入口。
- 关系档案和资产索引已有底层 schema，后续 UI 可继续增强。

### 4.5 UI 与主题

- 主界面已从工作台感调整为私人聊天空间。
- 左侧已经是联系人列表，不再暴露“新聊天/主聊天”概念。
- 角色卡和设置不抢主聊天视线；角色卡预览不再常驻左侧底部，改从联系人资料进入设置。
- 头像上传走 Phase 2 资产链路：本地文件复制到 `data/assets/<characterId>/`，SQLite 保存 `avatarAssetId` 和 assets metadata。
- 独立设置页包含应用、API、角色、记忆、数据设置。
- 支持 `system`、`light`、`dark`。
- 主题会同步到 Electron `nativeTheme.themeSource`。
- 原生下拉框已替换为 `SelectMenu`，风格和暗色模式统一。

## 5. 架构地图

Electron：

- `electron/main.ts`：窗口创建、菜单处理、存储 IPC、secret IPC、主题 IPC。
- `electron/preload.ts`：向渲染进程暴露受控的 `window.electron` API。
- `src/types/electron.d.ts`：Electron preload 类型定义。

存储与配置：

- `src/services/storage/index.ts`：Phase 1 JSON 迁移和浏览器有限 fallback 的兼容包装；长期数据已由 SQLite IPC 服务承接。
- `src/services/apiProfiles.ts`：API profile 的创建、保存、加密、解密、迁移。
- `src/services/config/index.ts`：应用配置的默认值、归一化、保存。
- `src/services/chatHistory.ts`：会话和消息历史持久化。
- `src/services/theme.ts`：主题解析、应用、系统主题监听、Electron 主题同步。

LLM：

- `src/services/llm/index.ts`：LLM service 工厂。
- `src/services/llm/openai.ts`：OpenAI-compatible 适配器，请求、abort、reasoning 抽取、情绪标签剥离。
- `src/services/llm/modelDiscovery.ts`：模型列表发现。
- `src/services/llm/http.ts`：HTTP 辅助逻辑。
- `src/services/llm/endpoints.ts`：常见 provider endpoint。

状态：

- `src/stores/settings.ts`：配置、profile、角色、主题、连接测试等状态。
- `src/stores/chat.ts`：主时间线消息、pending 请求、撤回、重新生成、删除后续；调用 LLM 前接入 Phase 2 上下文装配，回复后触发后台记忆更新。

UI：

- `src/components/Chat/`：聊天窗口、消息列表、单条消息、输入栏。
- `src/components/Character/CharacterCard.tsx`：角色卡展示，主聊天不再常驻展示它。
- `src/components/Settings/`：API、角色、应用设置页。
- `src/components/UI/SelectMenu.tsx`：自定义下拉菜单。
- `src/index.css`：主题变量、布局、气泡、暗色模式等全局样式。

## 6. 当前遗留问题

这些不是当前核心阻塞项，但接手继续开发前应当心里有数：

- 仍需要跑一次真实 Electron smoke：空数据启动、旧 JSON 迁移、发消息、记忆面板、备份导出/恢复、上传立绘、发起/最小化/恢复视频通话。
- Electron 打包为正式 exe 的发布流程还没有完整跑通。
- 浏览器开发模式会用 localStorage fallback 保存数据，API key 安全性弱于 Electron；Phase 2 后浏览器不再是完整产品目标。
- `better-sqlite3` 同一份 `node_modules` 会在 Node ABI 和 Electron ABI 之间切换；项目脚本已经分别封装 rebuild，但手工跑命令时要注意当前 ABI。
- 关系档案 schema 已有，但 UI 仍主要集中在角色卡和记忆层，关系档案编辑面可继续增强，也可纳入 Phase 3 的存在感状态来源。
- 结构化记忆目前是基础 CRUD/上下文装配，后续可继续做去重、合并、状态演进策略和搜索。
- 角色资产目录、assets 表和 presentation profile 已用于头像、Phase 3A/3B 静态立绘差分，以及 Phase 3C 视频循环/Live2D 导入元数据。Phase 3D 已加入本地系统 TTS 和可用时 ASR。真实 Live2D renderer、云语音 provider 和更完整的动态动作控制仍待后续增强。
- reasoning 虽然被隐藏，但底层字段仍存在，后续需要明确哪些数据应保存、哪些只用于一次响应诊断。

## 7. Phase 2 实现摘要

Phase 2 命名为：人格、关系、记忆与角色资产。

它合并了早先拆开的“记忆系统”和“角色管理”方向。二者的真实产品目标一致：让聊天对象在长期聊天中保持稳定人格、持续关系感、可追溯共同经历，以及可迁移角色资料。

Phase 2 不应做成世界书或设定集系统。这个项目不是剧情跑团工具；如果用户想玩复杂剧情，SillyTavern 已经是更合适的工具。

完整设计文档：

- `docs/superpowers/specs/2026-06-19-phase2-personality-relationship-memory-assets-design.md`

### 7.1 SQLite-first 数据底座

- 使用 `better-sqlite3`。
- 数据库只在 Electron main process 打开。
- Renderer 通过 IPC 调用数据服务。
- 开启 `WAL`、`foreign_keys`。
- 使用正式 migrations，不靠临时脚本改结构。
- API profiles、设置、角色、消息、关系、记忆、总结、资产索引全部进入 SQLite。
- Phase 1 JSON 数据启动时迁移进 SQLite，旧 JSON 保留成备份。
- 浏览器模式不再承担完整运行目标。

主要文件：

- `electron/data/schema.ts`
- `electron/data/database.ts`
- `electron/data/repositories.ts`
- `electron/data/migratePhase1.ts`
- `electron/data/archive.ts`
- `src/services/phase2/*`

### 7.2 单角色单主时间线

角色是联系人，不是剧情卡存档。

- 每个角色默认只有一条主聊天时间线。
- 长聊天靠分页、搜索、时间分段和总结管理。
- Phase 1 同角色多会话迁移成历史归档。
- 如果要重新开始，提供明确动作：重置关系、清空记忆、复制角色为新角色。

### 7.3 人格、关系与角色资料

目标不是堆设定，而是让角色像一个稳定联系人。

建议数据包括：

- 基本资料：姓名、称呼、头像、简介、默认语气。
- 人格核心：稳定价值观、表达习惯、边界、关系态度。
- 互动偏好：用户喜欢的聊天密度、称呼、玩笑尺度、回复长度。
- 关系状态：熟悉程度、重要共同经历、当前关系基调。
- 角色资源：头像、未来表情图、Live2D 或视频聊天资产目录。
- 内部 prompt 与上下文装配字段：哪些信息长期进入系统提示，哪些按上下文动态进入；用户设置页不提供 prompt 编辑器。

### 7.4 记忆与上下文

Phase 2 使用双层记忆：

- 会话总结：承接大篇幅对话，是长聊天主要压力阀。
- 结构化记忆：记录重要事实、偏好、状态变化、关系事件和共同经历。

记忆类型至少包括：

- `state`：所在地、工作、作息、当前生活状态。
- `event`：礼物、争执、约定、某次重要聊天。
- `preference`：称呼、聊天方式、边界、话题偏好。
- `relationship`：两人之间的重要事件、承诺、习惯、共同梗。
- `profile`：用户基础资料。

记忆不是静态事实库，而是会随生活和关系自然发展的档案。状态型记忆应有当前值和历史脉络；事件型记忆进入时间线，不被覆盖。

必须提供的能力：

- 自动总结和结构化抽取。
- 用户可查看、编辑、删除、禁用、置顶、手动新增记忆。
- 记忆来源可追溯到消息或时间。
- 上下文装配可解释，避免把过期或错误记忆反复塞进 prompt。
- 失败的总结或抽取不能覆盖旧的好结果。

### 7.5 自动总结与记忆模型

已确认：

- 按消息数、字数或 token 阈值主动总结。
- 不等上下文快满再总结。
- 不弹每次确认的草稿流。
- 允许自动结果直接入库，但必须在记忆面板可见可改。
- 全局记忆/总结 API profile：默认跟随聊天模型，可单独选择一个全局 profile。
- 不做每角色单独记忆模型设置。
- 总结和抽取用内部独立 prompt、低温度、结构化 JSON 输出和校验。

### 7.6 记忆 UI 与设置页

Phase 2 应提供两层入口：

- 聊天侧记忆面板：实际使用时查看“她记住了什么”。可查看当前总结、关键记忆、关系状态、最近自动更新、下次回复会参考的内容，并可编辑。
- 设置里的记忆页：配置记忆开关、触发阈值、全局记忆 API profile 和输出失败处理；不暴露总结 prompt 或抽取 prompt 编辑器。

### 7.7 角色档案、资产与导入导出

角色卡导入导出要做，但以此间内部格式为主，不做 SillyTavern 兼容目标。

建议区分：

- 角色档案：适合分享或迁移角色本体，默认不包含私人关系、聊天记录、记忆。
- 完整角色归档：适合自己的私密迁移，包含角色档案、资产、关系状态、记忆、阶段总结、主时间线。

资产文件要有明确目录和引用方式，底层使用稳定 id，避免头像、表情、Live2D 资产因角色改名而断引用。

### 7.8 备份、恢复与迁移

Phase 2 必须补上：

- 数据 schema version。
- migration table。
- 从 Phase 1 JSON 数据迁移到 SQLite。
- 备份导出 zip，包含 `manifest.json`、`app.db`、`assets/`。
- 备份恢复。
- 迁移失败的回滚或保留旧数据策略。
- 敏感字段过滤，导出包默认不包含 API key，除非用户明确选择。

## 8. Phase 3 方向

Phase 3 建议聚焦：角色存在感与视频聊天。新的详细交接文档是：

- `docs/PHASE3-HANDOVER.md`
- `docs/superpowers/specs/2026-06-20-phase3-video-call-presence-design.md`

一句话方向：Phase 3 不再继续堆角色卡字段，而是把 Phase 2 形成的联系人、关系、记忆、资产和 `emotion` metadata 发展成一套“角色能被看见、被听见、状态能被感知”的展示层。主聊天仍是产品中心；视频聊天式界面、表情、Live2D 和语音都应围绕当前联系人展开。

当前 Phase 3A/3B/3C/3D 已完成第一版应用内视频通话式存在感：静态立绘差分、字幕、mini 窗、单通话状态、展示 profile、视频循环动态形象、Live2D adapter 占位、本地系统 TTS 和可用时 ASR-to-draft。后续优先级建议是先做真实 Electron smoke 与视觉打磨，再评估真实 Live2D renderer、云语音 provider 和是否需要 Electron 独立窗口。

## 9. Phase 4+ 功能池

Phase 4 之后不建议写成“统一打磨阶段”。质量、测试、安全、文档每个版本都要做。

后续功能池可以包括：

- 正式打包和发布：Windows exe、macOS dmg、Linux AppImage。
- 移动端聊天：PWA、React Native、Capacitor 或原生方案再评估。
- 工具调用：天气、时间、日程、网页搜索、本地文件等。
- 主动聊天：在用户可控和低打扰的前提下做。
- 插件或技能系统。
- 云同步或多端同步，但默认仍保持本地优先。
- 更完整的导入导出和数据可视化。

## 10. 接手检查清单

接手开发前建议跑一遍：

- `npm install`
- `npm run build`
- `npm run electron:compile`
- `npm start`
- 新建一个 API profile，测试连接，拉取模型。
- 重启应用，确认 profile 和 key 仍可用。
- 发送消息、撤回、重新生成、删除后续、编辑用户消息。
- 新建角色、切换联系人，确认每个角色只进入自己的主时间线，pending 状态不串台。
- 切换 `system/light/dark`，确认 UI 和 Electron 原生主题同步。
- 检查 `%APPDATA%\herein\data\` 下数据是否符合预期。
- 继续开发前，优先验证 SQLite 迁移、备份、恢复和记忆面板真实 Electron smoke。
- 提交前搜索真实 API key，确认没有进入仓库。

## 11. 文档优先级

当前以这些文档为准：

- `docs/PROJECT-BACKGROUND-AND-ROADMAP.md`
- `docs/HANDOVER.md`
- `docs/PHASE3-HANDOVER.md`
- `docs/superpowers/specs/2026-06-20-phase3-video-call-presence-design.md`
- `docs/superpowers/plans/2026-06-20-phase3-video-call-presence-implementation.md`
- `docs/superpowers/specs/2026-06-19-phase2-personality-relationship-memory-assets-design.md`

早期计划、早期 self-check 和 Phase 1 状态文档可能仍有历史价值，但不再代表当前产品路线。
