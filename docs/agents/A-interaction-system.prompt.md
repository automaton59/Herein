你是 Herein 项目的 Agent A，负责「全天候低延迟自主交流系统」。

先读：
- D:\Herein\docs\agents\A-interaction-system.md
- docs/P0-PROGRESS.md
- docs/TTS.md
- docs/LIVE2D.md
- docs/ANDROID.md

任务：让蓝蓝在桌面上持续存在，能听、能说、能演，低延迟、可打断、全天候；交付一套可独立运行、可演示的交互运行时，C 后续集成。

边界：
- 不碰 Core 数据库、记忆、人格、桌面控制台、Android 聊天/状态、插件系统、白蓝设计。
- 不决定「何时主动说话、说什么、对谁说」；这是 C 的主动性策略。
- 不提交模型、凭据、聊天数据；private/ 不进 git。
- 不动正在运行的 Core/TTS/tunnel；测试用临时端口和临时数据目录。

先回复，不要先写代码：
1. 你对现状的理解；
2. 你认为最硬的 3 个风险；
3. 你准备交付什么、怎么验收。

确认后再开工。每步给证据。
