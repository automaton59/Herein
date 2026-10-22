# 此间

此间（Herein）是一个本地优先的私人 IM 陪伴应用，使用 React、TypeScript 和 Electron 构建。

它的目标不是做角色扮演工作台，也不是做 SillyTavern 的轻量版。核心体验应该像打开一个熟悉的聊天对象：联系人、聊天气泡、本地历史、稳定人格、持续关系、用户可控的记忆。

## 当前状态

Phase 2 已基本收尾。核心产品链路已经落地，剩余 Phase 2 工作主要是真实 Electron smoke、打包验证和发布前打磨。当前已经具备：

- Electron + Vite 开发启动流程。
- OpenAI-compatible API profile。
- Electron 下通过 `safeStorage` 加密 API key，并保存进 SQLite。
- Electron IPC 访问 SQLite 本地数据底座。
- Phase 1 JSON 数据迁移进 `app.db`。
- 多角色；每个角色一条主聊天时间线。
- 消息编辑、重新生成、撤回打断、删除后续。
- 主聊天隐藏 thinking/reasoning。
- 情绪标签从正文剥离，仅保存为 metadata。
- 基于角色、总结、记忆的上下文装配。
- 后台会话总结和结构化记忆抽取。
- 聊天侧记忆面板与全局记忆设置。
- 此间内部角色档案导入导出。
- 完整备份/恢复 zip，包含 manifest、`app.db` 和 assets。
- Light、Dark、System 主题。

## 快速开始

### 前置要求

- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 启动 Electron 应用

```bash
npm start
```

这是推荐的开发和使用入口。

### 构建检查

```bash
npm run build
npm run electron:compile
```

`npm run dev` 仍可启动 Vite 浏览器开发服务器，用于有限的前端调试。但 Phase 2 的长期数据层是 Electron-first SQLite，浏览器模式不再作为完整产品目标。

## 配置 API

在应用设置中：

1. 新建 API profile。
2. 选择 OpenAI-compatible provider。
3. 填写 API key、model，必要时填写 base URL。
4. 测试连接。
5. 回到聊天界面开始使用。

此间应尽量保持 API 中立。OpenAI、DeepSeek、OpenRouter、AnyRouter、OpenCode 或其他兼容端点都应通过 profile 和 adapter 消化差异，而不是把 provider 逻辑散落在 UI 里。

## 数据与隐私

Electron 数据位于：

```text
%APPDATA%\herein\data\
```

当前长期数据：

- `app.db`
- `assets/`
- `backups/`
- `exports/`

Phase 1 JSON 文件（`config.json`、`chat-history.json`、`api-profiles.json`）现在只作为迁移输入和保留备份。Electron 下 API key 会优先使用 `safeStorage` 加密；完整备份默认排除 API key 密文。

详见 [docs/local-data-and-secrets.md](docs/local-data-and-secrets.md)。

## Phase 2 实现

Phase 2 围绕这些决策实现：

- SQLite-first、Electron-first，使用 `better-sqlite3` 打长期可靠数据底座。
- 每个角色默认只有一条主聊天时间线。
- 角色像联系人，不是剧情卡存档。
- 会话总结负责承接长对话。
- 结构化记忆记录重要事实、偏好、状态变化和共同经历。
- 自动总结和记忆抽取直接入库，不用每次弹窗确认。
- 用户可以查看、编辑、禁用、置顶、手动新增记忆。
- 可配置全局记忆/总结 API profile，默认跟随当前聊天模型。
- 聊天、总结、抽取 prompt 是内部产品逻辑，不作为用户可编辑设置暴露。
- 支持此间内部角色档案导入导出。
- 全量备份/恢复导出 zip，包含 `manifest.json`、`app.db` 和 `assets/`。
- SillyTavern 只作为实现参考，不作为 Phase 2 兼容目标。

完整设计见：

- [Phase 2 设计文档](docs/superpowers/specs/2026-06-19-phase2-personality-relationship-memory-assets-design.md)
- [项目背景与路线图](docs/PROJECT-BACKGROUND-AND-ROADMAP.md)
- [交接文档](docs/HANDOVER.md)
- [Phase 3 交接文档](docs/PHASE3-HANDOVER.md)

## 项目结构

```text
electron/
  main.ts
  preload.ts
src/
  components/
    Chat/
    Memory/
    Settings/
  services/
    phase2/
    llm/
    storage/
    config/
  stores/
docs/
```

## 路线图

- **Phase 1：私人 IM MVP**，已完成。
- **Phase 2：人格、关系、记忆与角色资产**，包括 SQLite 数据底座、单角色单主时间线、记忆管理、角色档案导入导出、备份恢复；基本收尾。
- **Phase 3：角色存在感与视频聊天方向**，包括展示状态、表情资产、Live2D 或等价动态形象、状态管线和可选语音。
- **Phase 4+：功能池**，包括正式打包、移动端评估、可控主动聊天、工具调用、同步/备份、插件等。

## 许可证

MIT
