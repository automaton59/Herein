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
- 内置 native plugin：`bilibili`（只读推荐流扫描 → observations/activity）、`netease`（匿名只读候选/搜索）、`qq`（官方 Bot listener/被动回复，凭据在本地文件）。
- `electron/plugins/agentProvider.ts`：AgentProvider 契约 + registry；DSH 能力将来从这里接入。
- 桌面新增“系统”控制台：状态卡片、插件列表、天气配置/查询、主动性、最近审计。
- Android 新增系统状态芯片/抽屉：Core/DB/模型/声音/插件。

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

## 当前边界

- `weather`、`bilibili`、`netease`、`qq` 已是 native plugin。
- DSH 通过 `AgentProvider` 契约接入；C 的注册表只做聚合/策略/UI/审计，B 尚未交付真实 provider。
- 桌面控制台：weather 有专用配置/查询卡；其他插件按 manifest `configSchema` 渲染通用配置表单。
- Android 状态只覆盖 Core 侧组件；relay/隧道状态、离线 outbox 待补。

## 验证

- `electron/plugins/registry.test.ts`：发现/安装/启用/调用/停用/审计/配置/权限/失败。
- `electron/plugins/weather.test.ts`：天气安装/配置/缓存/降级/失败。
- `electron/core/server.test.ts`：`/v1/status` + `/v1/plugins*` 端到端。
- 2026-10-23：58 files / 230 tests passed；`npm run build` 通过；DSH adapter 另跑 `npm run test:dsh`（13/13）；A runtime `npm run test:interaction` 27/27。

## 相关文档

- [plugins/README.md](../plugins/README.md)
- [plugins/weather/README.md](../plugins/weather/README.md)
- [P0-PROGRESS.md](P0-PROGRESS.md)
