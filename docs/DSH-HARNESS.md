# DSH harness bridge

最后更新：2026-10-22

B 的独立交付，已合入 `adapters/dsh`。它把 DSH 的 PluginManager / Tools / HMR 包成一个本机 HTTP 桥，C 不直接依赖 Cordis。

## 交付内容

- `adapters/dsh`：bridge、HTTP server、审批、快照/回滚、审计 hash 链、Windows Job Object、CLI、hello v1/v2 fixture。
- 环境：Windows x64、Node 22+、已安装 DeepSeek Harness Desktop（验证版本 44.7.0 / DSH `0.2.1-rc.2`）。
- 不修改用户 `desktop` profile；使用独立 root/profile。
- 详细说明见 [adapters/dsh/README.md](../adapters/dsh/README.md)。

## 启动桥

```powershell
$dshInstall = 'C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness'
$bridgeRoot = 'D:\Herein\tmp\dsh-service'
$keys = 'D:\Herein\tmp\dsh-operator-keys'

node adapters/dsh/scripts/cli.mjs keys --dir $keys
node adapters/dsh/scripts/cli.mjs serve `
  --root $bridgeRoot `
  --install $dshInstall `
  --public-key "$keys\approval-public.pem" `
  --token-file "$keys\transport-token" `
  --port 8791
```

## C 接入

C 自动注册 DSH AgentProvider：

```powershell
$env:HEREIN_DSH_URL = 'http://127.0.0.1:8791'
$env:HEREIN_DSH_TOKEN = (Get-Content "$keys\transport-token" -Raw).Trim()
npm run core:serve
```

然后打开桌面“系统” → “Agent 能力”：

- provider 显示 `DeepSeek Harness`；
- `GET /v1/inventory` 的 capability 出现在列表；
- 每个能力有 `call` 按钮和 JSON 参数输入；
- 调用走 `/v1/call`，结果原样展示。

C 只做发现和调用。安装/启停/移除/回滚在 DSH 侧需要**单独签署的审批**，C 不持有审批私钥；这些能力标记为 `lifecycle: 'external'`，控制台只显示“生命周期由 DSH 审批管理”，不提供会失败的按钮。

## 边界

- 桥是审批/恢复机制，不是恶意插件沙箱；Host 仍有当前用户权限。
- C 的 transport token 只用于读取/调用；不能代替安装审批。
- DSH 工具名、描述、schema、结果都按外部数据处理，不能当审批指令。
- 安装来源必须是本地、已审阅 package 目录；不自动信任市场包。
- 快照/回滚覆盖桥 profile，不覆盖用户 desktop、插件应用数据、外部文件或已发生的脚本副作用。

## 验证

B 的 adapter 测试（在 `adapters/dsh`，不在默认 vitest 内）：

```powershell
npm run test:dsh
# 13 tests, 13 pass
```

覆盖：真实 DSH 安装/启用/调用/禁用/回滚/更新、失败恢复、签名审批、构建脚本审批、Host 崩溃/桥中断恢复、取消、审计防篡改、junction/包变更拒绝。

C 的接入测试：

- `electron/plugins/dshProvider.test.ts`：inventory 映射、call、外部生命周期、离线健康、错误码。
- `electron/core/server.test.ts`：`HEREIN_DSH_URL/TOKEN` 注册、`/v1/agents` 列表、`/v1/agents/dsh/.../invoke`、install 返回审批提示。

## 已知限制

- 只验证 Windows x64。
- 桥不提供 marketplace、git/URL 拉取、跨 profile 操作。
- capability 的 `version` 在 C 侧显示为 `dsh`，DSH runtime 版本在 provider 健康里；后续可把 runtimeVersion 透传到 descriptor。
- 依赖 DSH 升级；升级后需用新测试 root 重跑 `npm run test:dsh`。
