# Phase 3C 设计：动态形象接入

日期：2026-06-20
状态：基于已完成 Phase 3A/3B 的第三切片

## 1. 目标

Phase 3C 的目标是让通话窗口能承接动态形象，而不是只显示静态立绘。为了保持产品路线稳，不在这一切片把业务逻辑绑定到某一个 Live2D 库；先实现一条可验证的动态形象链路：

- 支持导入本地视频循环资产，记录为 `asset.kind = video`。
- 支持导入 Live2D `model3.json` 入口所在的包目录，记录为 `asset.kind = live2d` 和 metadata。
- `CharacterPresentationProfile` 可以保存当前动态资产引用和首选渲染器。
- 通话窗口优先使用动态渲染源；动态资产不可用时回退到 Phase 3B 的静态立绘选择。
- Live2D 具体渲染库仍通过 adapter 边界隔离；本切片只做导入、metadata、选择和占位回退，不承诺真实模型渲染。

本切片不做 TTS、ASR、真实摄像头、系统级 PIP、独立 Electron 窗口，也不要求浏览器模式完整支持本地动态资产链路。

## 2. 方案选择

推荐方案：视频循环先落地，Live2D 先导入和适配边界。

原因：

- 视频循环能直接由浏览器 `<video>` 渲染，是可靠的“等价动态形象”。
- Live2D 资源格式、运行时库和许可证需要独立验证；贸然接库容易让业务逻辑被具体 renderer 污染。
- `AssetRecord.kind` 已预留 `video` 和 `live2d`，`assets.metadata_json` 和 `CharacterPresentationProfile` 也已经具备承载空间。

备选方案：

- 直接接 Live2D 库：效果更接近最终愿景，但依赖、许可证、资源格式和 Electron 兼容性风险更高。
- 只做 metadata 不渲染：风险低，但无法证明通话窗口已能承接动态形象。

## 3. 数据模型

扩展 `CharacterPresentationProfile`：

- `dynamicAssetId?: string | null`
- `preferredRenderer?: 'static' | 'video' | 'live2d' | 'auto'`

动态资产 metadata：

视频循环：

```json
{
  "renderer": "video",
  "loop": true,
  "muted": true
}
```

Live2D 包：

```json
{
  "renderer": "live2d",
  "entry": "model.model3.json",
  "defaultExpression": "neutral",
  "emotionMap": {
    "happy": { "expression": "smile", "motion": "idle_happy" }
  },
  "scale": 1,
  "offsetX": 0,
  "offsetY": 0
}
```

Schema v4 给 `character_presentation_profiles` 增加：

- `dynamic_asset_id text`
- `preferred_renderer text not null default 'auto'`

## 4. 渲染与回退

新增纯函数 `selectDynamicAvatarSource`：

1. 如果 profile 首选 `static`，返回 `null`，继续用静态立绘。
2. 如果 profile 指定 dynamic asset 且该资产存在：
   - `kind = video` 时返回 video source。
   - `kind = live2d` 时返回 live2d source。
3. 如果 profile 为 `auto` 且未指定资产，选择当前角色第一条 video/live2d 资产。
4. 如果动态资产文件或 data URL 不可用，返回 `null`。

`CallWindow` 接收 `dynamicSource`：

- `video`：用 `<video autoPlay loop muted playsInline>` 渲染。
- `live2d`：显示明确的动态形象占位和静态回退图；后续真实 renderer 替换这个 adapter。
- `null`：使用 Phase 3B 静态立绘。

## 5. UI

联系人资料抽屉中的“形象与表情”增加动态形象区：

- 上传视频循环：支持 `mp4`、`webm`、`ogg`。
- 导入 Live2D 入口：选择 `model3.json`，Electron main 复制入口所在目录。
- 选择动态形象：从当前角色 `video/live2d` 资产中选择，也可清空。
- 选择渲染偏好：自动、静态、视频、Live2D。
- 删除动态资产时清理 profile 引用。

UI 仍保持在联系人资料抽屉里，不新增全局素材市场。

## 6. 测试

自动测试覆盖：

- schema v4 和 repository profile 字段。
- video/live2d 动态资产 import API。
- dynamic source 选择函数和 fallback。
- CallWindow 渲染 video source，Live2D source 使用占位并保留静态回退。
- CharacterAppearanceSettings 动态形象控件。
- ChatWindow 动态资产加载、profile 保存和 CallLayer 动态 source 传递。
- 完整角色归档包含 video/live2d asset metadata 和 profile dynamic id 重映射。

手动 smoke：

- 上传一个短 mp4/webm 动态形象，发起通话，确认通话窗口显示动态视频。
- 切回静态渲染偏好，确认回退到静态立绘。
- 导入 Live2D `model3.json`，确认资产记录和 profile 可保存；通话窗口显示 Live2D adapter 占位并不破图。
- 删除动态资产，确认通话窗口回退静态立绘或头像。
