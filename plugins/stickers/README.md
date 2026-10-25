# 表情包插件

和 `weather`、`bilibili` 并列的 native plugin：只提供「有哪些表情、哪张更合适」，
什么时候发、发多频繁由 Core 决定（`electron/core/stickers.ts`）。

## 放图

默认目录：`<用户数据目录>/assets/stickers`，Windows 下是
`%APPDATA%\herein\data\assets\stickers`，首次启动自动创建（空目录也能用，
状态显示「目录里还没有图片」而不是失败）。仓库开发时也认 `private/assets/stickers/`。

```
%APPDATA%\herein\data\assets\stickers\
  自己/
    开心/  摸鱼.gif   转圈.gif
    疲惫/  躺平.gif
    搞怪/  猫猫.gif
```

- 一级目录是套组，二级目录是情绪（中文文件夹名会映射到 Core 的英文情绪）。
- 文件名就是表情名，也会被切成标签参与匹配。
- 支持 `gif / webp / png / jpg`。
- 目录必须位于某个素材根目录下（默认的 `data/assets`、`HEREIN_ASSETS_DIR` 或 `private/assets`），Core 才会通过 `/assets/*` 提供图片；插件通过 `ctx.assetsDirs` 拿到这些根目录。
- 可选：在套组目录放 `stickers.json` 覆盖标注：

```json
[
  { "file": "摸鱼.gif", "name": "摸鱼", "emotion": "playful", "tags": ["摸鱼", "下班"], "use": "想偷懒时" }
]
```

## 配置

- `dir`：表情目录，留空用默认目录；填绝对路径时要落在素材根目录内。
- `pack`：只启用某一个套组。
- `frequency`：`rare` / `normal` / `often`，对应约 1/8、1/4、1/2 的回复配图。
- `minGap`：最近多少条消息内发过就不再发，默认 3。
- `emotions`：是否按回复情绪匹配。

## 接口

`invoke('pick', { emotion, text, exclude })` → `{ id, name, url, pack, emotion }` 或 `null`。
`invoke('index')` → 套组与数量；`invoke('list', { limit })` → 目录。

## 边界

- 插件不决定时机，也不主动发消息。
- Core 只接受 `/assets/` 开头的 URL，插件无法让界面加载远程图片。
- 素材版权由使用者负责；表情包不是人格的一部分。
