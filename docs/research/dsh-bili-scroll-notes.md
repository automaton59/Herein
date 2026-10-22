# dsh-bili-scroll 参考笔记

来源：<https://github.com/c1overzz/dsh-bili-scroll>（MIT）
查看日期：2026-10-21

只做架构/接口参考，没有复制代码。它的 Python 依赖和 MIT 署名属于原项目。

## 它怎么做

- DSH 插件，每天替用户刷一轮 B 站。
- 内置 `bilibili-mcp`（Python，`bilibili-api-python`）：
  - 扫码登录，凭证落本机；
  - 搜视频、读字幕、读评论、看视频信息；
  - 可选发评论 / 回楼中楼。
- 给模型只注册 4 个只读工具；开评论才多一个写工具。
- 定时起 headless 会话，读 `prompts/duty.md`，把值得的写成 `out/<date>.md`。
- 报告每条固定 `### BV号`，宿主用它数配额。
- 无字幕默认跳过；开本地转写才跑 Whisper；空字幕/只有“字幕by”会判空并记录跳过数。

## 我们采用的

- **字幕优先**：先拿字幕正文再判断，不靠摘要。
  - 已实现 `getSubtitleText`：优先 `ai-zh/zh-CN/zh`，抓 `subtitle_url` 的 `body[].content`。
- **空字幕检测**：空、只有“字幕by/字幕制作”这类署名 → `empty=true`，调用方跳过。
- **字幕/评论/简介只当素材**：我们的 Observation 用 `provenance=untrusted`，不把内容当指令。
- **只读工具面**：B 站适配器没有点赞/投币/收藏/发评论。
- **报告结构**：`### BV号` + 标题/UP/链接/为什么值得 + 一句自己的话，后续用于 Experience/日报。
- **成本纪律**：没内容就跳过，不做“27 次工具调用最后空报告”。

## 我们没采用的

- `bilibili-api-python` / MCP / Python 运行时：我们的适配器是自建 TS，避免 SDK 被下架/上游变动。
- 扫码登录：当前匿名只读；需要个性化/风控时再加 cookie。
- 发评论 / @ 人：用户明确 B 站只读，不发。
- Whisper 本地转写：后续如果需要，再接本地 ASR；当前无字幕就跳过。

## 差异

| | dsh-bili-scroll | Herein |
|---|---|---|
| 语言 | Python MCP + JS 插件 | TypeScript 自建 |
| 登录 | 扫码 | 匿名（可选 cookie） |
| 字幕 | bilibili-api | 自建 `/x/player/wbi/v2` + subtitle_url |
| 评论 | 可读可发 | 不读不发 |
| 输出 | Markdown 日报 | Observation / ActivitySession / Experience |
| 写操作 | 可选评论 | 无 |
