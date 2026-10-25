# Live2D

最后更新：2026-10-23

## 现在有什么

- `src/components/Presence/DesktopPresence.tsx`：应用启动即创建的透明桌面形象窗口。
- `src/components/Avatar/Live2DStage.tsx`：Pixi 7 + `pixi-live2d-display`，按模型入口自动选择 Cubism 2 或 Cubism 4。
- `electron/presence/resolve.ts`：从 persona、用户导入资产、旧 presentation profile 和头像中解析当前形象。
- `electron/presence/window.ts`：无边框、透明、置顶、跳过任务栏的形象窗口，负责位置持久化和事件转发。
- `src/mobile/Live2DDemo.tsx`：`?live2d=1` 演示页。
- Core `/assets/*`：从 `HEREIN_ASSETS_DIR`、数据目录 `assets/` 和 `private/assets` 提供模型/贴图/core。

## 桌面启动

主进程启动顺序：

1. 加载 persona 包并固定当前角色；
2. 启动内嵌 Core；
3. 创建聊天主窗口；
4. 创建托盘；
5. 创建 `?presence=1` 的透明形象窗口。

形象窗口在启动时直接出现，不需要先进入聊天，也不需要发起视频通话。关闭主窗口后它仍然存在，切换到后台托管。

## 模型资产

本机测试/当前私有资产（`private/` 已被 gitignore）：

```text
private/assets/avatars/dsh_l2d_mouse/c_0120.model3.json
private/assets/live2d/core4/live2dcubismcore.min.js
private/assets/live2d/core/live2d.min.js          # Cubism 2
private/assets/live2d/shizuku/shizuku.model.json  # 技术验证模型
```

persona 的 `character.json` 通过 `avatar.entry` 指向模型，例如：

```json
"entry": "assets/avatars/dsh_l2d_mouse/c_0120.model3.json"
```

解析时会在每个 asset root 下尝试原始路径和去掉 `assets/` 前缀的路径。当前正式/测试模型由 persona 所有者维护；应用不会在运行时改写模型文件。

## 用户覆盖

在聊天页角色资料抽屉里导入的 Live2D/video 资产会带 `metadata.source = "user"`。解析顺序：

1. 用户显式导入的资产；
2. persona 的 `avatar.entry`；
3. 旧 Live2D/video 资产；
4. 头像图片；
5. 可读的未就绪提示。

这样旧的 Shizuku 技术验证资产不会在 persona 有正式模型时抢占桌面形象。

## 启动 Core 和资产

内嵌 Core 默认使用随机端口，自动把 `private/assets` 加入静态资源根。手动启动：

```powershell
$env:HEREIN_ASSETS_DIR = "D:\Herein\private\assets"
$env:HEREIN_CORE_HOST = "127.0.0.1"
$env:HEREIN_CORE_PORT = "8787"
npm run core:serve
```

打开演示：

```text
http://127.0.0.1:5173/?live2d=1   # npm run dev
```

桌面形象窗口使用：

```text
http://127.0.0.1:5173/?presence=1
```

生产构建使用 `dist/index.html?presence=1`。

## 表情与动作

- 情绪来自最近一条 assistant 消息的 `emotion` metadata。
- 形象窗口订阅 Core `/v1/events` 的 `chat.completed`，收到后切换表情，不需要刷新。
- persona 的 `avatar.expressions` 把 emotion 映射到模型表情名；`null` 表示恢复默认表情。
- 如果映射名在模型 JSON 中不存在，会退回自动推断的表情，避免坏表情导致空白。
- 待机动作会尝试使用模型中的 `Idle`/`idle` 动作组。
- 桌面形象不做口型（下一阶段会把语音接到这里）；视频通话窗口的语音链路暂时保留。

## 托管

- 关闭主窗口：隐藏并进入 `hosting`；托盘、Core、形象窗口继续运行。
- 托盘菜单可恢复主窗口、开关形象、切换置顶、切换“关闭进托管”、开机启动和退出。
- 形象默认置顶；可在悬停控制、托盘或设置里关闭。
- 位置以窗口坐标写入 `presencePosition`，下次启动恢复并收回可见区域。

## CallWindow 接入（保留）

`CallWindow` 仍支持 `dynamicSource.kind === 'live2d'`：

- 从 `localStorage['herein-core-url']` 取 Core 地址；
- 模型 URL：`<core>/assets/<entry>`；
- core URL：`<core>/assets/live2d/core/live2d.min.js` 或 `core4/live2dcubismcore.min.js`。

它是可选的语音/沉浸视图，不再是 Live2D 的唯一入口；和桌面形象同时打开会渲染两份模型，这是已知的重复成本。

## 已知限制

- Cubism 2 和 Cubism 4 的 core 文件都不在仓库内；运行环境必须提供 `private/assets/live2d/core*`。
- 模型、贴图、core 的许可证由资产提供方负责；`private/` 不进入 git，也不随安装包分发。
- `?live2d=1` 仍是演示页；正式形象以 persona 的 `avatar.entry` 为准。
- `/assets/*` 公开在 loopback Core 上；不要在那里放凭据或私密聊天素材。
- 透明窗口的实际桌面合成需要人工验收；自动诊断只能证明窗口 `visible`、`alwaysOnTop`、bounds 和 canvas 已创建。
