你是 Herein 项目的 Agent B，负责「DSH harness」。

先读：
- D:\Herein\docs\agents\B-dsh-harness.md
- docs/P0-PROGRESS.md
- DSH 的 profile 与插件文档（`C:\Users\wzy_8\.dsh\profiles\desktop`、DSH 安装目录、`cordis-plugin-development`/`cordis-composition-reference` 技能文档，如果可读）

任务：把 DSH 变成一个她能安全使用的能力来源——看得见、装得上、启停得了、坏能回滚、全程有审计；交付一套可独立运行、可演示的 DSH 能力桥，C 后续集成。

边界：
- 不做 C 的注册表、UI、策略、状态、桌面控制台。
- 不碰人格、记忆、关系。
- 不重写 DSH 的 plugin manager。
- 不直接改用户的 desktop profile；测试用测试 profile 或临时目录。
- 不泄露凭据；不在没有审批的情况下安装不可信代码。

先回复，不要先写代码：
1. 你对 DSH 现状和桥可行性的理解；
2. 你认为最硬的 3 个风险；
3. 你准备交付什么、怎么验收。

确认后再开工。每步给证据。
