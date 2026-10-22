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
- 桌面“系统”控制台：provider 健康、capability 安装/启停/移除/action 调用、结果展示。
- 测试：registry 生命周期、provider 健康失败、Core 端到端。
- 还没有真实 DSH provider；B 交付后注册进 `CoreServerOptions.agentProviders` 即可。
