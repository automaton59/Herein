# 给 A / B 的交接材料

这里放的是给另外两个 agent 的 brief 和可直接粘贴的提示词。C（主系统）尚未启动，A/B 先独立交付，C 后续集成。

| 工作流 | Brief | 提示词 | 归属 |
|---|---|---|---|
| A — 全天候低延迟自主交流系统 | [A-interaction-system.md](A-interaction-system.md) | [A-interaction-system.prompt.md](A-interaction-system.prompt.md) | 别的 agent |
| B — DSH harness | [B-dsh-harness.md](B-dsh-harness.md) | [B-dsh-harness.prompt.md](B-dsh-harness.prompt.md) | 别的 agent |

## 怎么用

1. 先让对方读 Brief，再粘贴对应的提示词。
2. 要求对方**先回复理解、风险、验收方式**，不要先写代码。
3. 确认后再开工；要求独立分支、每步给证据。
4. C 暂不启动；A/B 先交付可独立运行/演示的子系统，集成阶段再对齐。

## 共同边界

- 不碰 `private/`、模型、凭据、聊天数据。
- 不直接改 `main`。
- 不动正在运行的 Core/TTS/tunnel；测试用临时端口/目录。
- 不把“能跑 demo”当成“全天候可用”；要有长时间和真机证据。
- 模型/素材许可要看清；不重新分发。
