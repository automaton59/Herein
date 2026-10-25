# 架构自查报告 — 桌面形象、固定人格、后台托管

日期：2026-10-23
范围：`src/`、`electron/`、构建脚本、测试与相关文档

## 0. 结论

三项调整已落地并通过构建、Electron 编译、236 项自动测试和两轮 Electron smoke：

1. 应用启动即创建桌面 Live2D 形象，不再依赖聊天页的视频通话入口。
2. 聊天页只服务 persona 包固定的一个角色，不再提供联系人列表或角色选择。
3. 关闭主窗口进入后台托管：主窗口隐藏到托盘，内嵌 Core 与桌面形象继续在线；显式退出才结束进程。

同时修掉了几个会直接破坏这三项需求的旧架构问题，详见第 2 节。

## 1. 本次改动

### 1.1 桌面形象

- 新增 `electron/presence/window.ts`：透明、无边框、跳过任务栏、默认置顶的形象窗口，保存位置、限制在可见区域、拒绝外部导航。
- 新增 `electron/presence/resolve.ts`：解析当前形象，返回 `DesktopPresenceState`。
- 新增 `src/components/Presence/DesktopPresence.tsx`：透明渲染、拖动移动、单击开聊天、右键原生菜单、悬停控制、托管状态条。
- `src/components/Avatar/Live2DStage.tsx` 同时支持 Cubism 2 (`*.model.json`) 和 Cubism 4 (`*.model3.json`)，通过 `pixi-live2d-display/cubism2|cubism4` 动态加载。
- 主进程启动时先创建聊天窗口，再创建托盘和形象窗口；形象窗口独立于聊天和通话。
- 形象窗口订阅 Core `/v1/events` 的 `chat.completed`，按 assistant emotion 切换表情。

### 1.2 固定人格

- 新增 `electron/persona/runtime.ts`，启动时选择唯一 persona；`HEREIN_PERSONA_ID` 可覆盖，默认取排序后的第一个包。
- `syncPersonaCharacter()` 每次启动把 persona 的名称、人格、价值观、边界同步进角色记录，强制 `activeCharacterId` 指向该 persona；用户自己写的本地开场白、头像、资产引用保留，旧的默认开场白「在。」会被清空。
- `chatHistory.loadPersistentChatHistory()` 只加载固定 persona 的主时间线，旧角色不会重新进入渲染层。
- `ChatWindow` 删除联系人侧栏、移动端联系人横条、联系人切换、第二通话确认框；当前角色直接取 `characterConfig`，不再从 active conversation 反推。
- 设置页“角色”不再提供选择/新建/复制/删除，只显示固定人格和可选的本地开场白；留空时聊天页显示“还没有消息”，不伪造角色发言。
- 从 `settings` store 删除 `setActiveCharacter` / `createCharacter` / `duplicateCharacter` / `deleteCharacter`，避免 UI 之外再次切换身份。

### 1.3 后台托管

- `window-all-closed` 不再退出应用。
- 主窗口 `close` 默认 `preventDefault()` + `hide()`，进入 `hosting` 状态；托盘 tooltip 和形象 HUD 显示“托管中”。
- 新增托盘：打开此间、桌面形象开关、形象置顶、关闭进托管、开机启动、退出。
- `before-quit` 先销毁形象和托盘，再关闭 Core；Core 关闭超过 6 秒强制 `app.exit(0)`，避免退出挂起。
- 单实例锁：重复启动唤起已有实例并切到聊天。
- 形象位置、置顶、启用、关闭进托管、开机启动写入 `app_settings`。
- `app.setLoginItemSettings` 接开机启动；开发态带工作目录，打包态只启动应用。
- 设置页新增“桌面陪伴与托管”区块。

## 2. 自查发现并修复的问题

### 2.1 单实例锁在不可写 userData 上必然失败（严重）

原顺序是先 `requestSingleInstanceLock()`，后 `app.setPath('userData', resolveUserDataDirectory())`。本机 `%APPDATA%\herein` 不可写，Chromium 报 `Lock file can not be created! Error code: 5`，锁返回 false，应用被当成第二实例直接退出。

修复：把可写数据目录解析和 `app.setPath('userData', ...)` 提前到单实例锁之前。这是本次 smoke 能启动的关键修复。

### 2.2 旧 presentation profile 会盖住 persona 正式模型

旧数据库里 `dynamicAssetId` 指向 Shizuku 技术验证模型，导致 persona 已经配置了正式模型时桌面仍显示 Shizuku。

修复：新导入的 Live2D/video 资产写 `metadata.source = "user"`；只有用户显式导入的资产优先，persona `avatar.entry` 高于旧资产。旧 Shizuku 资产没有该标记，不再抢占。

### 2.3 聊天会加载所有旧角色

`loadPersistentChatHistory()` 原来遍历 `bootstrap.characters`，旧角色会重新进入 store；`sendMessage`、`activeCharacterId` 等仍可能被旧数据影响。

修复：有 persona 时只加载 persona 对应角色；`ChatWindow` 也只按固定角色找主会话。

### 2.4 `activeCharacterId` 会被最后一个会话覆盖

`savePersistentChatHistory()` 会把 `activeCharacterId` 写成当前会话角色。多角色时代这是合理的，固定人格后会破坏身份。

修复：主进程启动时强制 active persona；聊天只允许 persona 会话；旧会话不再进入渲染层。保存逻辑仍写当前会话角色，但当前会话只能是 persona。

### 2.5 Live2D 只能从视频通话启动

旧 `CallLayer` / `CallWindow` 是唯一挂载 `Live2DStage` 的地方，且需要 presentation profile。

修复：新增独立 presence 窗口；`CallWindow` 保留为可选语音/沉浸视图。

### 2.6 不支持 Cubism 4 / `.model.json`

旧导入只接受 `.model3.json`，Shizuku 的 `.model.json` 无法通过 UI 导入；Cubism 4 core 也没有加载路径。

修复：`Live2DStage` 按模型入口选择 Cubism 2/4；导入接受 `.model3.json` 和 `.model.json`。

### 2.7 视频通话窗口和桌面形象重复渲染

`CallWindow` 仍会在通话时再创建一个 Live2D 实例。功能上可用，但 GPU/内存成本翻倍，也会同时出现两个同角色。

状态：未删除。建议下一步把 TTS/ASR 接到桌面形象，移除独立通话窗口，或让通话窗口只显示静态/视频而不重复 Live2D。

### 2.8 `isConfigured` 误判导致有 Core 也不能聊天

`App` 原来只按 renderer 的 API profile 判断，`isConfigured=false` 就强制跳设置页；但应用可能通过内嵌 Core 的 `private/credentials/llm.json` 工作。

修复：`canChat = isConfigured || hasLocalCore`；`isHydrated` 前显示加载态，避免旧 localStorage 角色闪烁。

### 2.9 安全硬化

- 新增 CSP：限制默认/脚本/样式/图片/媒体/连接来源，保留 Pixi 需要的 `'unsafe-eval'`。
- 主窗口和形象窗口的 `will-navigate` 从“任意 `file://`”收紧到应用 `dist` 目录（开发态为配置的 dev URL）。
- 形象窗口继续使用 `contextIsolation: true`、`nodeIntegration: false`，只通过受控 IPC 拿已解析状态。

### 2.10 测试入口与原生模块 ABI

`npm test` 会把 `better-sqlite3` 重编成普通 Node ABI，而日常运行需要 Electron ABI；两者来回切换很脆弱。

修复：新增 `npm run test:electron`，用 `ELECTRON_RUN_AS_NODE=1 electron vitest` 在 Electron Node 运行时执行测试，不需要换 ABI。本次 236 项测试即通过该入口执行。

## 3. 仍需关注的风险

1. **模型资产不进包**：`private/assets` 被 gitignore，`electron-builder` 不会自动打包；发布版需要单独的资产安装/校验策略。
2. **透明窗口真机观感**：自动检查证明窗口 `visible`、`alwaysOnTop`、bounds 正确、canvas 已创建；但 Windows 分层窗口的桌面合成无法用当前 `capturePage` / `desktopCapturer` 断言，仍需人工看一眼。
3. **开机启动未真实验收**：只调用了系统登录项 API，未做重启/登录周期验证。
4. **通话窗口重复 Live2D**：见 2.7。
5. **SystemPage 仍有角色下拉**：只用于手动“运行一次主动性”，不影响聊天身份；建议也固定到 persona。
6. **旧角色记录未清理**：DB 里旧角色/旧资产还在，只是不再进入聊天和形象链路；需要时另做迁移清理。
7. **CSP 的 `unsafe-eval`**：Pixi 需要；若要完全消除 Electron 安全警告，需要 `@pixi/unsafe-eval` 或替代渲染路径。
8. **移动端未同步**：`src/mobile/MobileApp.tsx` 仍是独立的 Core 聊天壳，没有桌面形象/托管概念；本次只调整桌面端。
9. **Core LLM 配置与 renderer API profile 仍是两套**：`canChat` 已兼容，但长期应统一健康检查与配置来源。
10. **诊断代码**：`HEREIN_DIAG_*`、`HEREIN_MAIN_LOG` 只在环境变量开启时工作；不设置时无文件写入和额外截图。
11. **`console-message` 与 Electron 新事件签名**：已改用单 event 对象；若 Electron 版本变化需再核对。
12. **托盘菜单每次状态变化重建**：当前开销可接受；若后续菜单项增多可缓存。

## 4. 验证记录

### 自动

```text
npm run build           通过（check:core / check:contrast / tsc / vite build）
npm run electron:compile 通过
npm run test:electron    57 files / 236 tests 通过
```

新增/更新的测试：

- `electron/presence/resolve.test.ts`：persona 优先于旧资产、用户导入覆盖、缺模型返回 notice。
- `electron/persona/persona.test.ts`：固定人格同步、保留本地开场白和头像。
- `src/components/Chat/ChatWindow.test.tsx`：无联系人列表、单角色通话、桌面形象按钮、动态视频资产。
- `src/components/Settings/CharacterSettings.test.tsx`：无新建/复制/删除，只保存可选本地开场白；留空不产生默认问候。

### Electron smoke

- 主窗口与形象窗口同时创建，形象窗口 `visible=true`、`topmost=true`、canvas=1。
- 形象状态解析到当前 persona 模型（`dsh_l2d_mouse`），Cubism 4 core 加载成功。
- 关闭主窗口后：`mainWindowVisible=false`、`hosting=true`、`presenceVisible=true`，应用进程保持运行。
- 从形象窗口调用 `presence.openChat()` 后：主窗口重新 `visible=true`、`hosting=false`，说明点击形象恢复聊天链路可用。
- 显式退出后进程结束；强制退出兜底生效。
- 首次 smoke 还复现并验证了 2.1 的单实例锁问题修复。
