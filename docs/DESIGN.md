# 白蓝设计系统

最后更新：2026-10-22

## 方向

Android 图标给出了底色：白为主，天蓝为辅，浅灰网格，几何鱼尾。桌面浅色模式按同一套语言走。

**界面退后，蓝鱼成为视觉中心。** 白色/近白画布负责安静，天蓝负责点缀，深海蓝负责可读性和交互，不用大面积高饱和蓝和界面抢角色。

## 调色板

| 角色 | 浅色 | 暗色 |
|---|---|---|
| 画布 | `#F6FBFF` | `#04101A` |
| 面/卡片 | `#FFFFFF` / `white/85` | `#07131F` / `#0B1B2B` |
| 主交互 | `sky-600` / 深海蓝 | `sky-400` / `sky-300` |
| 点缀 | `sky-500` / `sky-400` / 天蓝图标色 `#5EB9FD` | `sky-300` / `cyan-300` |
| 正文 | `slate-900` / `slate-700` | `sky-50` / `slate-300` |
| 次级文本 | `slate-500` / `slate-400` | `slate-400` |
| 边框 | `sky-100` / `sky-200` | `sky-900/40` / `white/10` |
| 成功/警告/错误 | emerald / amber / rose | 同色系暗色变体 |

## 使用规则

- 天蓝是点缀色，不拿来做正文；正文用 slate/深海蓝。
- 主按钮用 `sky-700`，白字；hover `sky-800`（比 `sky-600` 更稳的对比度）。
- 卡片白底 + `sky-100` 细边框 + 轻阴影；暗色卡片 `#0B1B2B`。
- 背景允许极浅的 radial/linear 渐变，但不要比角色更抢眼。
- 图标/鱼尾线条可以复用，但不要在大面积装饰里重复。
- 暗色是深海蓝黑，不是酒红/暖黑。

## 当前状态

- `src/` 已全量从 rose/cream 切到 sky/白/深海蓝；`rose-` 残留 0。
- App 外壳、系统控制台、聊天、设置、记忆、通话、Android 都走同一套色系。
- 仍未做：语义 token 抽象（目前是 Tailwind 类名 + 少量 hex）、WCAG 对比度审计、真机/桌面截图视觉回归。

## 入口

- [App.tsx](../src/App.tsx)
- [SystemPage.tsx](../src/components/System/SystemPage.tsx)
- [index.css](../src/index.css)
- [MobileApp.tsx](../src/mobile/MobileApp.tsx)
