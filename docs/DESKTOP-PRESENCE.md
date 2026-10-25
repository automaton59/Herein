# Desktop Presence And Background Hosting

最后更新：2026-10-23

本文记录 Phase 3E 的架构调整：Live2D 形象从“聊天里的视频通话”变成应用启动即在桌面上的常驻存在；聊天页只服务一个固定人格；关闭主窗口进入后台托管。

## 1. 产品约束

- **一个角色**：角色由私有 persona 包定义，不在聊天页提供选择、新建、复制或删除。
- **形象先于聊天**：应用启动后桌面形象直接出现，不要求用户先进入聊天，也不要求发起视频通话。
- **关闭不是退出**：关闭主窗口只收起聊天；嵌入 Core、托盘和桌面形象继续在线，直到用户从托盘或设置里显式退出。
- **单一实例**：重复启动只唤起已有实例，不创建第二套 Core、托盘或形象窗口。

## 2. 启动流程

```text
app ready
  -> resolve writable userData (must happen before single-instance lock)
  -> request single-instance lock
  -> load private persona packs, select the fixed persona
  -> migrate/seed SQLite, sync persona identity fields, set activeCharacterId
  -> start embedded Core on 127.0.0.1 (random port)
  -> create main chat window
  -> create tray
  -> create transparent, frameless, always-on-top presence window
  -> presence renderer asks main for DesktopPresenceState
```

`createWindow()` no longer owns the Live2D lifecycle. The presence window is created independently and survives the main window being hidden or closed.

## 3. 窗口与交互

- 尺寸 380x560，透明、无边框、跳过任务栏、默认置顶。
- 默认放在主屏右下角工作区内，位置写入 `presencePosition`。
- 拖动形象移动窗口；单击打开主窗口并切到聊天；右键打开原生菜单（打开聊天、置顶、隐藏形象、退出）。
- 悬停显示聊天、置顶、隐藏三个控制。
- 顶部状态条显示角色名、昵称、桌面在线/后台托管中；托管时额外显示“托管”标记。
- 模型渲染在 `src/components/Presence/DesktopPresence.tsx`，复用 `Live2DStage`。

## 4. 形象来源解析

`electron/presence/resolve.ts` 按以下顺序解析：

1. 显式导入且带 `metadata.source = "user"` 的 Live2D/video 资产；
2. persona 包 `character.json` 的 `avatar.entry`（当前是 `assets/avatars/...`，在 `private/assets` 下解析）；
3. 其他已存在的 Live2D/video 资产（兼容旧数据）；
4. 角色头像图片；
5. 都没有时返回一个可读的 `notice`，形象窗口显示回退卡片，不抛异常。

加载路径：

- 已导入资产：`<core>/assets/<relativePath 去掉 assets/>`
- persona 资产：`<core>/assets/<相对 asset root 的路径>`
- Cubism 2 core：`<core>/assets/live2d/core/live2d.min.js`
- Cubism 4 core：`<core>/assets/live2d/core4/live2dcubismcore.min.js`

`Live2DStage` 根据 `*.model3.json` / `*.model.json` 自动选择 `pixi-live2d-display/cubism4` 或 `cubism2`。表情映射来自 persona 的 `avatar.expressions`，缺失或无效时按模型 JSON 里的表情名推断，最后回退为无表情。

## 5. 后台托管生命周期

- `mainWindow.on('close')`：当 `closeToHosting` 为真时 `preventDefault()` 并 `hide()`，状态切换为 `hosting: true`。
- 隐藏主窗口不会停止嵌入 Core、SSE、记忆任务或形象渲染。
- 托盘菜单：打开此间、桌面形象开关、形象置顶、关闭窗口时进入托管、开机启动、退出。
- 托盘 tooltip 在托管时显示“此间 · 托管中（形象在线）”。
- 显式退出走 `app.quit()`；`before-quit` 先销毁形象和托盘，再关闭 Core。Core 关闭超过 6 秒会强制 `app.exit(0)`，避免退出被挂起。
- `window-all-closed` 不再退出应用；只有显式退出才结束进程。
- 第二次启动会触发 `second-instance`，唤起主窗口并切到聊天。
- 开机启动使用 `app.setLoginItemSettings`；开发态会带上当前工作目录，打包态只启动应用本身。

## 6. 持久化设置

写入 `app_settings`：

| key | 默认 | 说明 |
|---|---|---|
| `presenceEnabled` | `true` | 是否创建/显示桌面形象 |
| `presenceAlwaysOnTop` | `true` | 形象是否置顶 |
| `closeToHosting` | `true` | 关闭主窗口是否进入托管 |
| `launchAtLogin` | `false` | 开机启动 |
| `presencePosition` | 主屏右下 | 形象窗口坐标 |

这些设置同时可从设置页“桌面陪伴与托管”和托盘修改。

## 7. IPC 表面

Preload 暴露 `window.hereinShell`：

```text
presence.getState / getShellState / refresh / openChat / showContextMenu /
         getBounds / moveTo / hide / onState / onShellState
app.showMain / setPresenceEnabled / setAlwaysOnTop / setCloseToHosting /
    setLaunchAtLogin / onOpenChat / quit
```

主进程不把数据库对象或任意文件路径暴露给渲染进程；形象窗口只拿到已经解析好的 `DesktopPresenceState`。

## 8. 固定人格

- `electron/persona/runtime.ts` 选择唯一 persona；可用 `HEREIN_PERSONA_ID` 指定，否则使用排序后的第一个包。
- 启动时 `syncPersonaCharacter()` 把 persona 名称、人格、价值观、边界写回角色记录，并强制 `activeCharacterId` 为该 persona；用户自己写的本地开场白、头像和资产引用保留，旧的默认开场白「在。」会被清空。
- `chatHistory.loadPersistentChatHistory()` 只加载该 persona 的主时间线，避免旧角色重新进入渲染层。
- 设置页不再提供角色选择/新建/复制/删除，只保留固定人格说明和可选的本地开场白；留空时聊天页显示“还没有消息”，不伪造角色发言。
- 聊天页没有联系人列表；角色资料抽屉只服务当前 persona。

## 9. 验证

自动：

```bash
npm run build
npm run electron:compile
npm run test:electron
```

`test:electron` 使用 Electron 的 Node 运行时，避免为了跑测试把 `better-sqlite3` 重编成普通 Node ABI。

手工/诊断：

- `HEREIN_DIAG_DIR` + `HEREIN_DIAG_DELAY_MS` 可让主进程在启动后抓取窗口截图、DOM 文本、presence / shell 状态。
- `HEREIN_DIAG_HOSTING_TEST=1` 会自动关闭主窗口，验证 `hosting=true`、主窗口不可见、形象可见。
- `HEREIN_DIAG_EXIT=1` 在诊断结束后退出。

## 10. 已知边界

- 形象模型和 Cubism core 位于 `private/assets`，不进入 git，也不会被 `electron-builder` 自动打包；发布包需要单独的资产安装/分发策略。
- 透明窗口的实际桌面合成不在本仓库的自动截图里断言；自动检查覆盖 `visible`、`alwaysOnTop`、窗口 bounds 和 renderer canvas。真实桌面验收仍需人工看一眼。
- 视频通话窗口仍保留为可选语音/沉浸视图，并会再渲染一份 Live2D。下一步应把语音接到桌面形象，移除重复渲染。
- 自动启动只更新了系统登录项，未做真实重启验收。
- 旧数据库里的其他角色记录不会删除；它们只是不再进入聊天和形象链路。
- CSP 为 Pixi 保留了 `'unsafe-eval'`；Electron 仍会给出安全警告。若要彻底消掉，需要引入 `@pixi/unsafe-eval` 或改用不依赖 eval 的渲染路径。
