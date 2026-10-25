# 插件系统

最后更新：2026-10-22

## 现在有什么

- `electron/plugins/`：native plugin host。
  - `types.ts`：manifest、权限、健康、审计、插件实例契约。
  - `manifest.ts`：manifest/schema 校验、配置默认值/校验、entry 路径边界。
  - `loader.ts`：发现 `plugins/*/plugin.json`，动态加载 entry。
  - `registry.ts`：注册表、安装/启停/配置/调用/健康/审计，网络权限白名单。
- schema v9：`plugin_registry`、`plugin_audit`。
- Core HTTP：`/v1/plugins*`、`/v1/status`。
- `plugins/weather/`：第一个目录型 native plugin，验证安装 → 配置 → 启用 → 调用 → 审计 → 停用 → 卸载。
- 内置 native plugin：`bilibili`（默认匿名：推荐流扫描 → observations/activity；可选凭据登录后读评论区，`allowComment` 开关 + 审计保护下发评论/回复）、`netease`（匿名只读候选/搜索）、`qq`（官方 Bot listener/被动回复，凭据在本地文件）、`dsh`（本机 DSH 桥，kind: agent）、目录型 `stickers`（本地表情包索引 → 聊天配图）。
- `electron/core/stickers.ts`：决定这一条回复要不要配表情、配哪张；频率与间隔在 Core，插件只有目录。
- `electron/core/materials.ts`：把 B 站/网易云产出规范化为“她刚翻到的”材料；聊天命中意图时按需刷新，嵌入式 Core 启动后 8 秒/每 45 分钟自动刷新。
- 桌面新增“系统”控制台：状态卡片、插件列表（含 DSH、表情包）、天气配置/查询、主动性、最近审计。
- Android 新增系统状态芯片/抽屉：Core/DB/模型/声音/插件/Agent/隧道/交互。

## 插件契约

```text
plugin.json: id, name, version, kind, entry, permissions, configSchema
kind: source | channel | tool | agent
permissions: network | credentials | send | install | filesystem
entry: export function createPlugin() -> { start, stop, health, invoke }
```

网络权限是实际执行的：`ctx.fetch` 会拒绝 manifest 未声明的 hostname，并记入审计。

## 两条硬规则

1. **插件只提供能力，不提供节奏。** 插件不自己 setInterval 刷 B 站、不自己决定推歌；调度/主动性在 Core。
2. **插件不能写人格/记忆/关系。** 可以产出 observations/experiences、注册工具、走 channel；身份层不可插件化。

## 后台运行与自主性边界

- **宿主支持后台常驻**：`PluginInstance.start()` 可以建立长连接/监听，`stop()` 负责释放；`PluginRegistry` 在 Core 启动时恢复所有已启用插件，Core 退出时统一关闭。
- **QQ 是长驻例子**：`start()` 内启动 QQ Bot listener，之后一直监听；它不是定时器，也不经过 Core 的主动性。
- **source/tool 插件是被动的**：B 站、网易云、天气只有 `invoke()`；Core 的 `MaterialService` 在启动 8 秒后刷新一次，之后每 45 分钟刷新，供聊天/主动性读取。
- **插件不能主动发消息**：主动消息由 `InitiativeEngine` 决定，插件材料只是输入；插件也没有写人格、记忆、关系的权限。
- **结论**：现有插件系统具备“后台常驻 + 被 Core 后台调度”的自主性；不具备、也不应该具备“插件自己决定何时找人”的自主性。要让她主动找人，改的是 Core 的主动性层，不是插件。

## 当前边界

- `weather`、`bilibili`、`netease`、`qq`、`stickers` 已是 native plugin。
- DSH 也是一个插件（`kind: agent`，`electron/plugins/builtin/dsh.ts`）：在「系统 → 能力插件」里安装、填桥地址/token、启用、卸载。它只做发现和 `call`，DSH 侧的插件安装/启停/回滚仍需单独签署的审批，不在本机界面里伪造按钮。
- 不再有独立的「Agent 能力」面板；`/v1/agents` 已移除。`/v1/status` 的 `components.agents` 现在统计 `kind: agent` 的插件。
- Android 状态只覆盖 Core 侧组件；插件配置/Agent 操作仍在桌面；QQ 真凭据/语音/频控未验收。

## 验证

- `electron/plugins/registry.test.ts`：发现/安装/启用/调用/停用/审计/配置/权限/失败。
- `electron/plugins/weather.test.ts`：天气安装/配置/缓存/降级/失败。
- `electron/core/server.test.ts`：`/v1/status` + `/v1/plugins*` 端到端。
- 2026-10-24：65 files / 300 tests passed；`npm run build` 通过；DSH adapter 另跑 `npm run test:dsh`（13/13）。

## 相关文档

- [plugins/README.md](../plugins/README.md)
- [plugins/weather/README.md](../plugins/weather/README.md)
- [P0-PROGRESS.md](P0-PROGRESS.md)
