# Agent provider

最后更新：2026-10-22

C 的插件中枢除了 native plugin，还留了一条 agent 能力接入口。B 的 DSH harness 完成后，用这条口把 DSH 能力暴露给 C，不需要 C 知道 Cordis 内部。

## 契约

```ts
interface AgentProvider {
  id: string;
  name: string;
  listCapabilities(): Promise<AgentCapabilityDescriptor[]>;
  install(capabilityId: string): Promise<AgentOperationResult>;
  enable(capabilityId: string): Promise<AgentOperationResult>;
  disable(capabilityId: string): Promise<AgentOperationResult>;
  remove(capabilityId: string): Promise<AgentOperationResult>;
  rollback?(capabilityId: string): Promise<AgentOperationResult>;
  invoke?(capabilityId: string, action: string, input: unknown): Promise<unknown>;
  health(): Promise<PluginHealth>;
}
```

`AgentOperationResult.status`：`applied` / `restart-required` / `failed`。

能力描述可选字段：

```ts
{
  installed?: boolean;
  enabled?: boolean;
  lifecycle?: 'managed' | 'external';
  actions?: string[];
  inputSchema?: unknown;
}
```

`lifecycle: 'external'` 表示生命周期由外部系统审批，C 只做发现/调用，不显示会失败的安装/停用按钮。

## DSH provider

`electron/plugins/dshProvider.ts` 已接 B 的 `adapters/dsh` 桥：

```powershell
$env:HEREIN_DSH_URL = 'http://127.0.0.1:8791'
$env:HEREIN_DSH_TOKEN = '<bridge transport token>'
```

- `GET /health` → provider 健康；
- `GET /v1/inventory` → capability 列表（名称、描述、参数 schema）；
- `POST /v1/call` → `invoke`；
- 安装/启停/移除/回滚需要 DSH 侧签署审批，C 不持有审批私钥，因此标记 `lifecycle:'external'`。

完整说明见 [DSH-HARNESS.md](DSH-HARNESS.md)。

## Core HTTP

| Method | Path | 作用 |
|---|---|---|
| GET | `/v1/agents` | providers + capabilities + health |
| GET | `/v1/agents/:provider/health` | provider 健康 |
| POST | `/v1/agents/:provider/:capability/install` | 安装能力 |
| POST | `/v1/agents/:provider/:capability/enable` | 启用 |
| POST | `/v1/agents/:provider/:capability/disable` | 停用 |
| POST | `/v1/agents/:provider/:capability/remove` | 移除 |
| POST | `/v1/agents/:provider/:capability/rollback` | 回滚 |
| POST | `/v1/agents/:provider/:capability/invoke` | 调用 `{action,input}` |

## 边界

- provider 只负责“能力是否存在、能否装/启停/回滚/审计”。
- 允许装什么、给谁用、什么时候用，由 C 的策略/注册表/主动性决定。
- provider 不能写人格、记忆、关系，不能绕过 C 的权限/审计。
- DSH host 插件仍在 DSH 进程内运行；C 只聚合能力和状态。

## 现在

- `electron/plugins/agentProvider.ts`：registry + 契约。
- `GET/POST /v1/agents*`：Core 路由。
- 桌面“系统”控制台：provider 健康、capability 安装/启停/移除/action 调用、JSON 参数输入、结果展示。
- DSH provider 已接入：只读发现 + `call` 调用；生命周期走 DSH 审批。
- 测试：registry 生命周期、provider 健康失败、DSH inventory/call、Core 端到端。
