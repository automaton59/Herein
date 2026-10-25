# Contributing

## 环境

- Node.js 22+（开发机实测 22.22.2）
- Windows x64 是主要开发平台；macOS / Linux 未做完整验证
- **Electron 固定 42.4.0，不要升级。** 新版没有 `better-sqlite3` 的预编译产物，本机若无 VS 编译链，`postinstall` 会直接失败。

`npm install` 的 `postinstall` 会用 `@electron/rebuild` 把 `better-sqlite3` 编到 Electron 的 ABI。这一步失败通常意味着 Electron 版本被改了。

`packages/core` 和 `adapters/{bilibili,netease,qq}` 的 `dist/` 是 gitignore 的构建产物，但运行期和打包都依赖它们，所以 `npm run build` 会先编译这四个子包。单独改动某个子包后重跑 `npm run build`（或对应的 `build:<name>`）即可。

## 常用命令

```bash
npm run electron:compile   # 编译主进程（改 electron/ 后必须跑）
npm run build              # 先编译子包（packages/core + adapters），再 check:core + check:contrast + tsc + vite build
npm run test:electron      # 用 Electron 的 Node 跑 vitest（推荐的测试入口）
npm run test:dsh           # DSH 适配器（没装 DSH 会自动 skip）
npm run test:interaction   # 交互运行时
npm run check:persona      # 校验 private/persona 下的 pack
```

改完 UI 用 `npm start` 起完整应用；只改前端样式可以用 `npm run dev`，但浏览器模式没有 SQLite 和 IPC，不是完整产品路径。

## 测试的两个坑

**不要跑 `npm run native:rebuild:node`。** 它会把 `better-sqlite3` 切回普通 Node 的 ABI，之后 Electron 主进程起不来。要在普通 Node 下跑测试才需要它，跑完还得切回来。

**测试统一走 `npm run test:electron`。** 直接用 `npx vitest` 会让 `electron/**` 下的用例报 ABI 不匹配（`NODE_MODULE_VERSION` 146 ≠ 127），那是运行环境问题，不是代码问题。

## 代码边界

`npm run check:core` 会检查 Core 与渲染层的依赖边界。`src/` 不能直接 import `electron/` 的实现，只能通过 preload 暴露的 IPC 契约。加新能力时先确认这条线。

## 私有层

`private/` 被 `.gitignore` 排除，**不要在提交里带进任何 `private/` 内容**——persona 正文、Live2D 素材、`llm.json`、`qqbot.json`、`core-token.txt` 都算。

本地开发需要它才能启动：

```bash
cp -r examples/persona-minimal private/persona/my-companion
npm run check:persona
```

如果改动了 persona 的 schema（`electron/persona/manifest.ts`），同步更新 `docs/PERSONA.md` 和 `examples/persona-minimal/`，并确认 `npm run check:persona` 仍然通过。

## 提交前

```bash
npm run build && npm run electron:compile && npm run test:electron
```

三条都过再提。`check:contrast` 会校验配色对比度，改主题或颜色时要留意。

## 文档

- 面向使用者的：根目录 `README.md` / `README.zh-CN.md`、`docs/` 下的设计文档
- 面向开发过程的：`docs/internal/`（进度、自检、联调记录），不必随代码更新
- 中英文 README 结构要保持一致
