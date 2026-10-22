# Live2D

## 现在有什么

- `src/components/Avatar/Live2DStage.tsx`：Pixi 7 + `pixi-live2d-display` Cubism 2 渲染器。
- `src/mobile/Live2DDemo.tsx`：`?live2d=1` 演示页。
- Core `/assets/*`：从 `HEREIN_ASSETS_DIR` 提供模型/贴图/core，不要求 Authorization。
- 支持 emotion → expression 映射、窗口自适应、销毁清理。

## 本机测试素材（私有，不进 git）

```text
D:\Herein\private\assets\live2d\core\live2d.min.js
D:\Herein\private\assets\live2d\shizuku\shizuku.model.json
```

- Cubism 2.1 core 必须是真正的 `live2d.min.js`（129KB）；`live2d-widget` npm 包里的 `live2d.core.js` 是 0 字节占位，别用。
- Shizuku 只是技术验证模型，**不是蓝蓝的正式形象**；不要公开再分发。
- 文件在 `private/`，已被 gitignore。

## 启动

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

或构建后：

```text
http://127.0.0.1:4173/?live2d=1   # npm run preview
```

## 手机端

- APP 聊天页右上角“形象”按钮打开全屏 Live2D。
- 模型/Core 从当前 Core 的 `/assets` 加载；要求 Core 启动时：
  ```powershell
  $env:HEREIN_ASSETS_DIR = "D:\Herein\private\assets"
  ```
- 当前是 Shizuku 技术验证模型，不是正式蓝蓝形象。

## CallWindow 接入

- `CallWindow` 在 `dynamicSource.kind === 'live2d'` 时：
  - 从 `localStorage['herein-core-url']` 取 Core 地址；
  - 模型 URL：`<core>/assets/<entry>`（自动去掉 `assets/` 前缀）；
  - core URL：`<core>/assets/live2d/core/live2d.min.js`。
- 没有 Core URL 或 entry 时回退静态立绘。
- 需要有 presentation profile 把某个 live2d asset 选为动态形象。

## 已知限制

- 当前只验证了 Shizuku（Cubism 2）；Cubism 4 需要 `live2dcubismcore.min.js`。
- 没有口型同步（TTS RMS/viseme 还没接）。
- `?live2d=1` 是演示页；正式角色形象还要换模型/贴图/动作。
- `/assets/*` 公开；不要在这里放凭据或私密聊天素材。
