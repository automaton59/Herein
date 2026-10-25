# 表情包插件

最后更新：2026-10-25

参考：B 站 `BV13xnt6QE6s` / <https://github.com/Loping151/dsh-nekowhale-stickers>。
只借了「表情有标注、按情绪挑一张」的思路，没有引入 DSH、MCP 或那份素材。

## 结构

```text
private/assets/stickers/<套组>/<情绪>/<名字>.gif
        │
plugins/stickers      目录型 native plugin（kind: tool）
        │  pick({ emotion, text, exclude }) → { id, name, url, pack, emotion }
electron/core/stickers.ts   频率、间隔、URL 白名单
        │
Chat 回复 → message.sticker → 前端 MessageItem 渲染
```

和 `weather`、`bilibili` 同级：**插件只提供能力，节奏在 Core**。

## 已实现

- `plugins/stickers/`：扫描套组/情绪目录，文件名当标签；可选 `stickers.json` 覆盖标注。
- `electron/core/stickers.ts`：
  - 插件未安装或未启用 → 不发；
  - `minGap` 内发过 → 不发（读最近 12 条消息里的 sticker）；
  - `frequency` 概率（rare 0.12 / normal 0.3 / often 0.55）；
  - 只接受 `/assets/` 开头的 URL，插件不能让界面加载远程图片。
- 数据：`messages.sticker`（schema v14），随消息一起持久化、同步、读回。
- 前端：`Message.sticker` → `MessageItem` 渲染图片；加载失败降级为「（表情：名字）」。

## 为什么不走工具调用

聊天链路没有 `tool_calls`。让模型吐 `[sticker:x]` 会多花 token、还会漏；由 Core 按情绪挑
一张更稳，也让「她多久发一次」可配置。

## 配置

`dir`、`pack`、`frequency`、`minGap`、`emotions`，见 `plugins/stickers/README.md`。

## 边界

- 素材版权由使用者负责；本仓库不带表情图片。
- 表情不是人格的一部分，不写记忆、不主动发消息。
- 单张 GIF 常见 600KB 左右；建议转 webp 或缩小尺寸，否则一次加载会很重。
