# 内部记录

这里的文档是开发过程的副产品：阶段进度、自检报告、联调现场记录。它们对当时的实现决策有价值，但**不是使用文档**，也不需要按当前代码保持最新。

| 文件 | 性质 |
|---|---|
| `P0-PROGRESS.md` | P0 阶段的完成项与实测记录 |
| `A-STATUS-2026-10-23.md` | 交互系统某次状态快照 |
| `ALIVENESS-PROGRESS.md` | 主动性与在场感的进度表 |
| `ARCHITECTURE-SELF-CHECK-2026-10-23.md` | 一次性架构自检结论 |
| `DSH-LIVE-2026-10-23.md` | DSH 桥真机联调记录 |
| `DSH-REAL-CHAT-2026-10-23.md` | DSH 真实对话验证记录 |
| `self-check-findings.md` | 早期全量自检发现清单 |

带日期的文件是快照，结论可能已经过期。**想知道现在的行为，看代码或 `docs/` 下的设计文档。**

面向使用和贡献的文档在上一级 `docs/`：

- [`../PERSONA.md`](../PERSONA.md) — persona pack 契约
- [`../PLUGIN-SETUP.md`](../PLUGIN-SETUP.md) — 插件手动配置
- [`../TESTING.md`](../TESTING.md) — 测试怎么跑
- [`../local-data-and-secrets.md`](../local-data-and-secrets.md) — 数据落盘与密钥
