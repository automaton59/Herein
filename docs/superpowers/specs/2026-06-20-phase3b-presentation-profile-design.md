# Phase 3B 设计：展示状态与形象资产配置深化

日期：2026-06-20
状态：基于已确认 Phase 3 方向的第二切片

## 1. 目标

Phase 3A 已经把“视频通话式存在感”跑通：用户可以从当前联系人发起应用内通话，通话窗口显示静态立绘差分，并用最新 assistant message 的 `emotion` 作为字幕和表情选择信号。

Phase 3B 的目标是把这条链路从“上传后靠 metadata 自动挑图”升级成一套可持久、可编辑、可恢复的展示配置：

- 每个角色有一个 `CharacterPresentationProfile`。
- 用户可以指定默认立绘、fallback emotion，以及每个 emotion 显式绑定的资产。
- 表情资产的 label、emotion、priority 可以在联系人资料抽屉里编辑。
- 通话窗口选择立绘时优先使用 profile，缺失时继续优雅回退。
- 完整角色归档导入导出时保留 profile，并在角色 id 或资产 id 变化时重映射引用。

本切片不实现 Live2D 渲染、TTS、ASR、系统级 PIP、独立 Electron 窗口，也不把主聊天气泡头像切换成动态表情。

## 2. 数据模型

新增 SQLite 表 `character_presentation_profiles`：

- `character_id`：主键，关联 `characters(id)`。
- `default_asset_id`：默认静态立绘资产 id，可为空。
- `fallback_emotion`：缺失目标 emotion 时优先回退的 emotion，默认 `neutral`。
- `emotion_asset_map_json`：`Partial<Record<PresentationEmotion, string>>`，保存每个 emotion 显式绑定的 asset id。
- `updated_at`：更新时间。

`presentation_state` 仍不落库。通话 session 仍只在 renderer store 中保存。

## 3. 选择规则

`selectExpressionAsset` 扩展为接收可选 profile。选择顺序为：

1. 如果 profile 为目标 emotion 显式绑定了存在的 expression asset，使用该资产。
2. 否则使用目标 emotion 下 priority 最高的 expression asset。
3. 如果 profile 配置了 fallback emotion，先查该 emotion 的显式绑定，再查该 emotion 下 priority 最高的资产。
4. 如果 profile 配置了 default asset 且资产存在，使用默认资产。
5. 使用 `neutral` 下 priority 最高的资产。
6. 使用第一张 expression asset。
7. 没有 expression asset 时返回 `null`，UI 回退头像或占位。

这样用户可以精确控制常用表情，又保留 Phase 3A 的 metadata 自动回退。

## 4. UI

联系人资料抽屉里的“形象与表情”继续是唯一入口。新增能力：

- 默认立绘下拉：从当前 expression assets 中选择，也可清空为自动。
- fallback emotion 下拉：默认 `neutral`。
- 每张差分立绘可编辑 label、emotion、priority。
- 每个 emotion 行可以设为该 emotion 的显式绑定。
- 删除资产后 UI 不崩溃；如果 profile 引用缺失资产，选择逻辑自动跳过，用户下次保存 profile 时会以当前选择为准。

UI 保持紧凑，不新增全局设置页，不常驻主聊天侧边栏。

## 5. IPC 与客户端

在现有 Phase 2 preload API 下新增 `presentation` 分组：

- `getProfile(characterId)`
- `upsertProfile(profile)`

命名继续放在 Phase 2 API 下，是因为 SQLite/IPC 底座仍是 Phase 2 数据服务；业务含义属于 Phase 3 presentation。

## 6. 测试与验证

自动测试覆盖：

- schema migration 创建 presentation profile 表。
- repository 可 get/upsert profile，并规范化缺失字段。
- client 正确转发 presentation API。
- selector 按 profile explicit map、fallback emotion、default asset 和 neutral 顺序回退。
- CharacterAppearanceSettings 可以保存 asset metadata 和 presentation profile。
- CallLayer 使用 profile 选择通话立绘。
- 完整角色归档导出/导入保留并重映射 presentation profile。

手动 smoke 增补：

- 给同一角色上传 neutral/happy/worried 多张立绘。
- 修改 happy 的显式绑定和 priority，发起通话后模拟对应 emotion，确认选择符合配置。
- 删除被 profile 引用的资产，确认通话回退到 fallback/default/头像，不破图。
- 导出完整角色归档后导入，确认默认立绘和 emotion 映射仍指向导入后的资产。
