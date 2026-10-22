# Agent B Brief — DSH harness

> 给承接 B 工作流的 agent。本文只写背景、目标、边界、验收；不写实现方案。
> C（主系统）尚未启动。你先独立交付可运行、可演示的 DSH 能力桥，C 后续集成。

## 0. 一页结论

- **项目**：此间（Herein），本地优先的私人陪伴应用。
- **你的任务**：把 DSH 变成一个她能安全使用的能力来源——看得见、装得上、启停得了、坏能回滚、全程有审计。
- **交付**：DSH 能力桥/提供者 + 测试 profile + hello 插件端到端 + 审计/回滚 + 文档。
- **边界**：不做 C 的注册表/UI/策略/人格/记忆；不重写 DSH 的 plugin manager；不直接改用户的 `desktop` profile。
- **核心难点**：桥的可行性、host 代码权限、安装/回滚/审计、profile 安全。

## 1. 背景

DSH 是什么：

- DSH 是一个基于 Cordis 的 agent harness。一个 profile 由 bundle 和 patch 层组成。
- 插件（bundle）可以安装、启用、禁用、热更新；插件行可以由 patch 覆盖。
- host 插件是**进程内代码**；安装是 profile 级持久变更，需要权限/审批；失败可能留下状态。
- DSH 自带插件管理能力，支持安装、启停、移除、回滚、版本兼容和构建审批。

此间与 DSH 的现状：

- 此间目前**没有** DSH 集成。代码里只有调研文档提到 DSH，没有可用的桥。
- DSH 是“工作台”：能写代码、能装插件；但“她”还不会用这个工作台。
- 产品意图：让她能控制 DSH 的插件，从而获得自我迭代/升级的可能。不是让她随便改核心，而是让她能通过插件长出新能力。
- 当前不确定性：这台机器上只有 DSH Desktop，shell 里没有 `dsh` 命令；桥到底有没有可行路径，需要先验证。

## 2. 目标

一句话：**把 DSH 变成一个她能安全使用的能力来源：看得见有什么插件、装得上、启停得了、坏能回滚、全程有审计。**

做到之后：

- C 能问 DSH：“你现在有哪些能力/插件？”
- C 能安装一个新插件、启用/禁用、失败回滚，不需要手工改 profile。
- 安装、启用、回滚都有结果、有错误、有审计；失败的安装不会把 DSH 弄坏。
- DSH 里长出来的新能力，能出现在 C 的能力注册表里，被她实际使用。
- 权限边界清楚：装什么、给谁用由 C 决定；B 只保证机制安全。

“控制”的边界：

- B 的“控制” = 机制：怎么装、怎么启停、怎么回滚、怎么审计。
- **不包含**“允不允许装、装什么、什么时候用”；这是 C 的策略和注册表。

## 3. 范围

- DSH 插件生命周期：安装、启停、移除、回滚、热更新。
- 能力发现与调用。
- 权限、审批、审计、失败恢复。
- 桥的可行性验证。

## 4. 非目标

- C 的注册表、UI、策略、状态、桌面控制台。
- 人格、记忆、关系。
- 重写 DSH 的 plugin manager。
- 无审批安装不可信代码。
- 云 DSH、公开插件市场、远程多租户。

## 5. 现状与环境事实

DSH 安装：

```text
C:\Users\wzy_8\AppData\Local\Programs\DeepSeek Harness
```

DSH home：

```text
C:\Users\wzy_8\.dsh
```

当前 profile：

```text
C:\Users\wzy_8\.dsh\profiles\desktop
├─ cordis.yml          # 空入口列表
├─ cordis.patch.yml    # 用户 patch 层
├─ package.json        # bundles: @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app
└─ pnpm-workspace.yaml
```

其他事实：

- 当前 shell 里没有 `dsh` 命令；只有 DSH Desktop 进程。
- DSH 安装内含 `cordis-plugin-development`、`cordis-composition-reference` 等技能文档；如果可读，先读。
- 此间代码里没有 DSH 集成；`docs/RESEARCH-2026-10-21-autonomous-companion.md` 有调研背景。
- `desktop` profile 是用户正在用的，不要直接改；先复制/新建测试 profile，或在临时目录验证。

## 6. 约束

- host 插件是进程内代码，权限高；安装、启用、回滚都必须有审批/审计/恢复路径。
- 不泄露凭据；不把 token、AppSecret、Cookie 写进日志或仓库。
- 不碰 C 的领域：Core schema、记忆、人格、主动性、控制台、Android、插件注册表/UI。
- 不破坏用户现有 DSH profile；测试用测试 profile 或临时目录。
- Windows；Node/Electron；DSH Desktop 形态。
- 安装可能依赖网络/registry；失败时不能留下半装状态。
- 每条安装/启停/回滚都要有结果和审计，不要只打印日志。

## 7. 交付物

- 一套 DSH 能力桥/提供者代码。
- 一个测试 profile + 一个 hello 插件。
- 端到端：安装 → 启用 → 禁用 → 回滚 → 重启后仍在 → 审计可查。
- 权限/审批流程；失败恢复说明。
- 文档：如何运行、安全模型、失败/回滚、给 C 的集成说明。
- 一份短报告：做到了什么、没做到什么、证据。

## 8. 验收

目标级：

- 能装一个 hello 插件、启停、回滚，重启后仍在。
- 失败安装可恢复，不破坏现有 profile。
- 全程可审计，不泄密。
- C 不需要知道 Cordis 内部，就能看到和使用 DSH 能力。
- host 代码安装有明确的权限/审批门槛。

不要在没有证据时声称通过；用命令、日志、审计记录说明。

## 9. 工作方式

1. 先读文档和 DSH 结构，给出“现状理解 + 硬风险 + 可行性验证顺序 + 交付边界”。
2. 不要先写代码；等确认后再开工。
3. 独立分支；不要直接改 `main`；不要提交凭据。
4. 测试 profile 优先；不要碰用户的 `desktop` profile。
5. 每步给证据；完成后更新文档。
6. 与 C 的集成放在最后；先保证独立可运行。
