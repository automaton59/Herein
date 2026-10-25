# 此间视觉系统

最后更新：2026-10-23

## 方向

从 Android 图标和蓝色大肥鱼的形象取色，但不照搬高饱和青蓝：

- **干净的纸白**做底，不用发黄的暖白，避免“脏”。
- **长春花蓝 / periwinkle**做辅助色，来自人物头发和眼睛的浅色部分。
- **深海藏蓝**做标识色，来自人物衣服的深色和蝴蝶结。
- 淡紫只做环境光，不进入大面积界面。

界面退后，人物和内容在前。

## 调色板

| 角色 | 浅色 | 深色 |
|---|---|---|
| 画布 | `#F7F6FB` | `#0B1020` |
| 面 / 卡片 | `#FFFFFF` | `#0E1424` |
| 浅底 / hover | `#F1F2F9` | `rgba(255,255,255,0.05)` |
| 边框 | `#E6E5F0` | `rgba(255,255,255,0.10)` |
| 正文 | `#1C2333` | `#F4F6FF` |
| 次级文本 | `#5F6780` | `#9BA3B7` |
| 弱文本 | `#7A819A` | `#9BA3B7` |
| 主蓝 / 辅助 | `#9CA3D4` / `#7C8FD0` | `#7C8FD0` / `#BAC2E6` |
| 标识深蓝 | `#3B4474` | `#4A5590` |
| 更深藏蓝 | `#323962` | `#293054` |
| 瞳孔亮蓝 | `#7CC8EA` | `#7CC8EA` |
| 环境淡紫 | `#E3DAF0` | `rgba(124,143,208,0.14)` |

## 使用规则

- 主按钮、选中导航用标识深蓝 `#3B4474`，文字用纯白；hover 到 `#323962`。
- 长春花蓝是辅助色：图标、焦点、轻量选中、进度。不要用它做正文。
- 瞳孔亮蓝 `#7CC8EA` 只做“活着”的信号：在线/健康状态点、焦点环、小面积高光；不要整块铺。
- 背景的淡紫只放在 radial glow 里，透明度低于 0.35。
- 卡片统一 `1px #E6E5F0` 边框、20px 圆角、白色底；不要用发黄边框和重阴影。
- 输入框统一 38px 高、10px 圆角、白底、1px 边框；`settings-card` 内的所有文本输入由全局规则统一，不再逐组件写一套。
- 正文与背景对比度至少 4.5:1；`npm run check:contrast` 覆盖关键色对。
- 深色是蓝黑 `#0B1020`，不是暖黑。

## 品牌图标

- `public/herein-mark.png`：256px，白色圆角底，圆角半径 62，淡紫网格，长春花蓝鱼尾。
- 顶栏显示 36px；不在外面再套第二层圆角或阴影。
- 图标由 Android launcher 的鱼尾形重绘取色，不再手绘近似路径。

## 性能

- 不在大面积容器上用 `backdrop-blur`；顶栏、聊天主面板、通话浮层都用实色表面。
- Live2D 渲染分辨率上限 1.5 DPR，关闭抗锯齿，`high-performance`，ticker 上限 60fps，页面隐藏时暂停。
- 口型参数只在变化时写入，避免每帧重复设置。

## 入口

- [index.css](../src/index.css)
- [tailwind.config.js](../tailwind.config.js)
- [App.tsx](../src/App.tsx)
- [SettingsPage.tsx](../src/components/Settings/SettingsPage.tsx)
- [AppSettings.tsx](../src/components/Settings/AppSettings.tsx)
- [Live2DStage.tsx](../src/components/Avatar/Live2DStage.tsx)
- [DesktopPresence.tsx](../src/components/Presence/DesktopPresence.tsx)
- [DESKTOP-PRESENCE.md](./DESKTOP-PRESENCE.md)
