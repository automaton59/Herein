# 此间

本地优先的私人陪伴桌面应用。用 Electron + React + TypeScript 搭建，数据全部留在本机。

不是角色扮演工作台，也不是 SillyTavern 的轻量版。打开它就应该是打开一个熟悉的在场者：一个由私有 persona 包固定的角色、一个已经待在桌面上的 Live2D 形象、一段有连续记忆的私密对话。

---

## 它解决什么

通用聊天机器人每一轮都从零开始。此间把三件事做成了长期状态：

- **人格是装备，不是提示词。** persona pack 定义身份、语气、边界和关系框架，启动时编译进 system prompt，聊天页没有角色选择器。
- **记忆是数据结构，不是聊天记录拼接。** 消息、摘要、结构化记忆分层存储，按预算召回，你可以查看、编辑、停用、固定每一条。
- **在场是常态，不是功能开关。** 桌面形象独立于聊天窗口存在，关掉主窗口它还在，托盘托管整个 Core。

## 能力

### 对话

固定单一角色，流式输出。支持编辑重发、重新生成、撤回、删除后重来。`thinking` 区块折叠不展示，情绪标签被解析成元数据而不是可见文本——它驱动形象表情和语音语气，不污染正文。

### 记忆

三层结构：

| 层 | 内容 |
|---|---|
| 消息 | 原始对话，可编辑重生成 |
| 摘要 | 后台按窗口滚动生成的叙事版本 |
| 记忆条目 | 抽取出的偏好、事实、状态变化、共同经历，带来源和置信度 |

召回按 token 预算分段落打包，不是把历史整段塞进上下文。记忆面板支持逐条查看、编辑、停用、固定、手动添加。

### 桌面形象

Live2D（Cubism 2 与 4）透明窗口，独立于主窗口。可置顶、可拖动、位置记忆。表情随对话情绪切换，口型跟随语音幅度。关主窗口退到托盘时形象继续在线。

### 语音

本地 TTS（Qwen3 系列）与 ASR 走独立服务进程，需要自备模型权重。语音对话有一条独立的交互运行时，与文字聊天共用同一条时间线。

### 主动性

不是定时推送。主动性会读当前关系状态、未完成的话题和最近的情绪，判断这时该不该开口，再用人格自己的语气说出来——主动消息和回复共用同一份 persona。

### 插件

插件是能力扩展点，不是脚本注入。每个插件声明自己的 `kind`、`permissions`（网络域名、凭据、发送、安装、文件系统）和 `configSchema`，设置面板据此自动生成表单、做字段校验、显示健康状态。

| 插件 | 类型 | 说明 |
|---|---|---|
| 天气 | tool | Open-Meteo，无需 key |
| 表情包 | tool | 按情绪从本地套组选图 |
| B 站 | source | 直播/动态作为上下文素材 |
| 网易云 | source | 只读：搜索、歌词、公开歌单 |
| QQ Bot | channel | 单聊与群 @ 收发 |
| DSH | agent | 桥接 DeepSeek Harness |

全部手动配置，不依赖模型去猜。逐项字段和验证步骤见 [docs/PLUGIN-SETUP.md](docs/PLUGIN-SETUP.md)。

### 多端

桌面是主形态。内嵌 Core 是一个独立的 HTTP 服务（`npm run core:serve` 可单独跑），Android 客户端通过局域网连它，带 token 鉴权。Android 目前是实验性的。

## 架构

```text
┌─ Electron 主进程 ────────────────────────────────┐
│  窗口 / 托盘 / 桌面形象 / IPC / 单实例             │
│  ┌─ 内嵌 Core（HTTP + SSE） ───────────────────┐  │
│  │  对话编排 · 上下文组装 · 记忆读写 · 主动性    │  │
│  │  插件注册表 · 素材路由 · 凭据解密             │  │
│  └──────────────────────────────────────────────┘  │
│  适配器（B站 / 网易云 / QQ / DSH，动态 import）      │
└───────────────────────────────────────────────────┘
                    ↕ IPC
┌─ 渲染层（React + Zustand + Tailwind） ────────────┐
│  聊天 · 记忆面板 · 设置 · 系统 · 桌面形象渲染       │
└───────────────────────────────────────────────────┘
```

`src/` 不能直接引用 `electron/` 的实现，只能走 preload 暴露的 IPC 契约——`npm run check:core` 守这条线。

Core 单独成层的原因：它要能被手机、被第二个进程、被未来的别的壳复用，而不是和 BrowserWindow 绑死。

## 快速开始

### 环境

Node.js 22+。**Electron 固定 42.4.0**，不要升级——新版没有 `better-sqlite3` 的预编译产物。

### 安装

```bash
npm install
```

`postinstall` 会把 `better-sqlite3` 编到 Electron 的 ABI。

### 准备私有层

这一步需要自己建。仓库里是引擎，不是人格：`private/` 被 `.gitignore` 排除是有意的，因为 persona pack、Live2D 素材和凭据属于个人内容，不是源码。

```bash
cp -r examples/persona-minimal private/persona/my-companion
# 改 manifest.json 与 character.json 的 id，两处必须一致
npm run check:persona
```

没有 pack 时应用会明确报错，而不是悄悄退回某个内置角色——这是故意的。

API 密钥、QQ Bot 凭据、同步服务器配置放在 `private/credentials/`，模板见 [`examples/credentials/`](examples/README.md)。persona pack 的契约见 [docs/PERSONA.md](docs/PERSONA.md)。

### 启动

```bash
npm start
```

首次启动会进入设置页，新建一个 OpenAI-compatible API profile 后才能聊天。

### 构建

```bash
npm run build                # 边界检查 + 对比度检查 + tsc + vite build
npm run electron:compile     # 编译主进程
npm run electron:build:dir   # 免安装目录，输出到 ../Herein-Releases
```

## 数据与隐私

数据落在 `%APPDATA%\herein\data\`：

```text
app.db          # SQLite：消息、记忆、关系、插件注册表
assets/         # 导入的角色素材、表情包
backups/        # 完整备份
exports/        # 角色档案导出
```

- API key 用 Electron `safeStorage` 加密后存库，不落明文。
- 完整备份默认排除密钥密文。
- 所有网络请求都由你自己的 profile 配置发起，项目本身不上报任何数据。
- 只读查看：见 [docs/local-data-and-secrets.md](docs/local-data-and-secrets.md)。

## 文档

**使用**

- [persona pack 契约](docs/PERSONA.md) — 人格怎么定义、有哪些变量
- [插件配置](docs/PLUGIN-SETUP.md) — 每个插件的字段、命令、验证、排错
- [测试怎么跑](docs/TESTING.md)
- [数据落盘与密钥](docs/local-data-and-secrets.md)
- [示例模板](examples/README.md)

**设计**

- [项目背景与路线](docs/PROJECT-BACKGROUND-AND-ROADMAP.md)
- [架构与核心决策](docs/HANDOVER.md)
- [在场感设计](docs/DESKTOP-PRESENCE.md)
- [桌面形象与 Live2D](docs/LIVE2D.md)
- [插件系统](docs/PLUGINS.md)
- [主动性](docs/INITIATIVE.md)
- [语音与 TTS](docs/TTS.md) · [本地语音](docs/LOCAL-VOICE.md) · [交互端口](docs/INTERACTION-PORT.md)

**其他**

- [贡献指南](CONTRIBUTING.md)
- [内部记录](docs/internal/README.md) — 阶段进度与自检报告，会过期

## 许可

MIT，见 [LICENSE](LICENSE)。
