# Phase 3 交接：角色存在感与视频聊天

最后更新：2026-06-20
当前前提：Phase 2 基本收尾，Phase 3A/3B/3C/3D 已有可测试实现

本阶段已落地的具体设计：

- `docs/superpowers/specs/2026-06-20-phase3-video-call-presence-design.md`
- `docs/superpowers/specs/2026-06-20-phase3b-presentation-profile-design.md`
- `docs/superpowers/specs/2026-06-20-phase3c-dynamic-avatar-design.md`
- `docs/superpowers/specs/2026-06-20-phase3d-local-voice-design.md`

## 1. 一句话目标

Phase 3 的目标是让此间的角色从“能长期记住你的联系人”进一步变成“能被看见、被听见、状态能被感知的联系人”。

它不是把产品改成游戏引擎，不是做 SillyTavern 式世界书，也不是继续扩展用户可编辑 prompt。主聊天仍然是产品中心；视频聊天式界面、表情、Live2D、状态文案和语音都是围绕当前联系人展开的存在感层。

## 2. Phase 2 已经给 Phase 3 铺好的底座

Phase 3 不需要从零开始。当前代码和产品模型已经有这些基础：

- 一角色一联系人一主时间线，入口更接近私人 IM。
- 联系人资料抽屉里已经有头像上传，头像走 Phase 2 assets 链路。
- `AssetRecord.kind` 已预留 `avatar`、`expression`、`live2d`、`video`、`other`。
- LLM 回复里的情绪标签会从正文剥离，保存为 `TimelineMessage.emotion` metadata。
- 关系档案、会话总结和结构化记忆已经能进入上下文装配。
- `CHAT_BEHAVIOR_PROMPT`、总结 prompt、记忆抽取 prompt 都已经收敛为内部产品逻辑，不对用户暴露 prompt 编辑器。
- 备份/恢复已经包含 `assets/`，表情、Live2D 和视频资产沿用这条链路。

这意味着 Phase 3 的核心不是再建一个“角色卡系统”，而是把已存在的数据、情绪和资产组织成展示状态。

## 3. 产品原则

### 3.1 仍然先是联系人

角色不是模型调试对象，也不是剧情存档。Phase 3 的所有入口都应围绕当前联系人：联系人列表进入聊天，聊天顶栏进入资料，资料里管理头像和形象资产，必要时从聊天顶栏进入视频聊天式界面。

### 3.2 存在感服务于关系，不抢走聊天

视频聊天式界面不应替代主聊天，也不应强迫用户每次都打开。它更像“和这个联系人开一个更有临场感的窗口”。默认体验仍应轻、快、像 IM。

### 3.3 情绪是控制信号，不是正文

`[emotion: happy]` 这类标签不应出现在普通聊天文本里。Phase 3 可以用它驱动表情、动作、状态文案、视频窗口氛围，但不能把标签直接展示给用户。

### 3.4 prompt 是产品代码

用户设置里不提供聊天 prompt、总结 prompt、抽取 prompt 或存在感 prompt 编辑器。它们决定角色是否自然可信，是产品核心能力，不应变成脆弱配置项。

### 3.5 本地资产优先

头像、表情、Live2D、视频素材都应优先本地导入、本地保存、本地引用。云市场、在线素材库、角色社区都不是 Phase 3 主线。

## 4. 推荐实施顺序

### 4.1 Phase 3A：视频通话窗口与静态立绘差分

第一切片已经实现：先做“发起视频通话”的体验，而不是先做主聊天头像表情切换，也不是直接上 Live2D。

目标：

- 从聊天顶栏进入视频通话式窗口，仍然绑定同一个 character 和 primary timeline。
- 大通话窗显示当前联系人的静态立绘差分；缺少立绘时回退头像或默认占位。
- AI 回复在通话窗口里显示为字幕/台词条，不复刻完整聊天气泡流。
- 通话窗口里的发送仍复用主聊天发送链路，消息、emotion metadata、记忆和总结都继续写入同一主时间线。
- 支持 `windowed` 大通话窗和 `mini` 应用内悬浮窗；`fullscreen` 和 `pip` 只保留类型和 fallback。
- 第一版只允许一个 active call session。切换联系人时当前通话自动缩成 mini；从另一个联系人发起通话前必须确认挂断当前通话。

这就是 Phase 3 的最小可交付版本。它验证的是：联系人入口、资产、emotion、字幕、主时间线和 IM 式通话行为能否自然连起来。

### 4.2 Phase 3B：展示状态与资产管理深化

在视频通话第一切片里已经实现一层轻量 presentation profile；后续可继续把它深化为可复用管线。

目标：

- 定义角色当前展示状态：在线/输入中/空闲、最近情绪、当前表达、是否有未读或未收束上下文。
- 建立 `emotion -> expression` 映射：`happy` 可以选开心差分，没有就回退 neutral；`worried` 可以选担心差分，没有就回退 neutral。
- 扩展联系人资料里的“形象/形象与表情”配置，支持上传默认立绘、多张差分立绘，并给它们打 label、emotion、优先级。
- 缺失资产时必须优雅回退，不应该出现破图或空白状态。
- 第一切片不急着把主聊天气泡头像也改成动态表情；等通话窗口链路稳定后再决定是否增强主聊天头像。

### 4.3 Phase 3C：动态形象接入

在通话窗口和 presentation profile 稳定后，Phase 3C 已先接入视频循环作为可靠的等价动态形象，并为 Live2D 保留导入 metadata 与 adapter 边界。

目标：

- 支持导入一个角色的视频循环动态形象，并记录为 `asset.kind = video`。
- 支持选择 Live2D `.model3.json` 入口，复制所在包目录，并记录为 `asset.kind = live2d`。
- `CharacterPresentationProfile` 保存 `dynamicAssetId` 和 `preferredRenderer`。
- 渲染层负责决定用视频循环、Live2D adapter 占位还是静态立绘承接。
- 如果动态资源不可用，回退到静态差分、默认立绘或头像。

不要让业务逻辑直接依赖某一个 Live2D 库的 API。当前切片只保留清晰的 adapter 边界和类型位置，具体库选型、真实模型渲染和释放放到后续独立切片。

### 4.4 Phase 3D：本地语音第一版

语音已进入 Phase 3D，但第一版保持本地系统能力优先，不引入新的云端 provider 决策。

已实现方向：

- TTS：通话窗口可朗读当前助手字幕，可停止朗读，也可开启自动朗读后续字幕。
- ASR：运行环境支持 `SpeechRecognition` 时，用户语音输入会转成通话输入框文本，再走同一条发送消息链路。

本地系统语音不依赖新的 API key、模型或音频缓存。后续如果要接 OpenAI-compatible TTS、角色级 voice profile 或音频缓存，应替换语音服务层，而不是重写通话层。

## 5. 数据模型建议

当前 `AssetRecord` 已有基础字段，但 Phase 3 需要补 metadata。建议不要直接把所有字段摊平成列，先用一个受控 JSON metadata 承载不同资产类型的差异。

建议新增或扩展：

- `assets.metadata_json`：保存 expression/live2d/video 专属字段。
- `character_presentation_profiles`：保存默认立绘、fallback emotion、emotion -> asset 映射、`dynamicAssetId` 和 `preferredRenderer`。
- `presentation_state` 可以先不落库，作为运行时状态；只有用户可配置的映射和资产配置需要持久化。

表情资产 metadata 示例：

```json
{
  "expressionKey": "happy-soft",
  "emotion": "happy",
  "label": "轻松开心",
  "priority": 10,
  "loop": false
}
```

Live2D 资产 metadata 示例：

```json
{
  "entry": "model.model3.json",
  "defaultExpression": "neutral",
  "emotionMap": {
    "happy": { "expression": "smile", "motion": "idle_happy" },
    "worried": { "expression": "worried", "motion": "idle_slow" }
  },
  "scale": 1,
  "offsetX": 0,
  "offsetY": 0
}
```

展示状态可以先在 TypeScript 中定义为：

```ts
type PresentationEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'shy' | 'excited' | 'worried';

interface CharacterPresentationState {
  characterId: string;
  status: 'online' | 'typing' | 'idle';
  emotion: PresentationEmotion;
  expressionAssetId?: string | null;
  live2dAssetId?: string | null;
  statusText?: string;
  updatedAt: string;
}
```

## 6. UI 结构建议

### 6.1 联系人资料继续承载低频配置

联系人资料抽屉可以新增“形象与表情”入口：

- 当前头像。
- 表情图列表。
- Live2D/视频素材列表。
- 每个素材的 label、绑定 emotion、预览、删除。
- 默认表情和回退策略。

这部分是配置，不应常驻主聊天侧边栏。

### 6.2 主聊天只展示必要存在感

主聊天里可以增强：

- 顶栏头像跟随最近情绪轻微变化。
- 在线绿点保持在头像外独立显示。
- 正在输入状态仍是文字状态，不要过度动画化。
- 消息气泡旁的头像可以使用最近 expression，但布局不能跳动。

### 6.3 视频聊天式界面是一个正式视图

视频模式应避免“一个卡片里塞一个预览窗口”的感觉。它应该像当前联系人的沉浸式聊天视图：形象区域明确、输入区稳定、退出路径清晰。

基础布局建议：

- 顶部：联系人名、在线状态、返回聊天、资料入口。
- 中部：动态形象或静态头像/表情，缺失时用头像和柔和背景。
- 底部：输入框、发送按钮、可选语音按钮。
- 侧边或浮层：最近消息，不要把长聊天列表完整塞进视频区。

## 7. Prompt 与状态管线

第一阶段不要急着给聊天模型增加复杂动作标签。当前聊天 prompt 已要求每次回复末尾追加一个 emotion 标签，解析后会进入 `TimelineMessage.emotion`。

推荐管线：

1. 聊天模型按内部 prompt 回复正文和 emotion 标签。
2. LLM adapter 剥离 emotion，正文进入聊天，emotion 进入 message metadata。
3. presentation service 读取最近助手消息 emotion、pending 状态、联系人资产映射和关系状态。
4. presentation service 产出 `CharacterPresentationState`。
5. UI 根据 state 选择表情图、Live2D expression、视频循环或头像回退。

只有当 emotion 不够表达需求时，再考虑新增内部 presentation worker。这个 worker 也应是产品内部逻辑，不是用户 prompt 编辑器。它可以根据最近消息、关系档案和 summary 输出更细的展示意图，例如 `gesture`、`gaze`、`idleMood`，但仍必须结构化、可校验、失败可回退。

## 8. 验证要求

Phase 3 每个切片都应有自动测试和 Electron smoke。

自动测试重点：

- emotion 解析失败时回退 neutral。
- 多个 expression 资产按 emotion 和 priority 选择。
- expression/live2d/video 资产缺失时回退头像。
- 角色改名不影响资产引用。
- 备份/恢复后资产 metadata 仍能恢复映射。
- 视频模式发送消息仍写入同一 primary timeline。
- presentation state 不把内部 prompt、数据库字段或 emotion tag 暴露到聊天正文。

手动 smoke 重点：

- 上传头像和多张表情图。
- 切换联系人，确认各自表情和头像不串。
- 模拟 happy/worried/neutral 回复，确认头像或表情变化。
- 删除或移动某个资产文件，确认 UI 优雅回退。
- 打开视频模式、发送消息、返回主聊天，确认消息和 pending 状态一致。
- 亮色、暗色、窄屏下检查不重叠、不破图、不跳动。

如果接入 Live2D 或 canvas 渲染，需要额外做实际渲染检查：画面非空、资源加载完成、窗口缩放后仍在合理位置、退出视图后释放资源。

## 9. 明确非目标

Phase 3 不做：

- 用户可编辑 prompt manager。
- SillyTavern 兼容层。
- 世界书、剧情书、复杂场景系统。
- 角色社区、素材市场或云端素材同步。
- 把同一角色拆成多个视频会话。
- 默认要求浏览器模式完整支持 Live2D/SQLite 数据链路。
- 大而全的插件系统。

## 10. 仍需决策的问题

这些问题进入 Phase 3 后续切片前需要确认，但不阻塞第一切片：

- Live2D 库选型、许可证和 Electron 兼容性。
- Live2D 资源包第一版已采用选择 `.model3.json` 入口并复制所在目录；后续可评估 zip 导入和真实 renderer 资源校验。
- 云端 TTS provider 是否沿用 OpenAI-compatible 体系，还是单独建语音 profile。
- ASR 当前只在运行环境支持 `SpeechRecognition` 时启用；后续可评估云端 ASR 或本地 ASR provider。

已确认并实现：第一版应用内视频通话窗口、静态立绘差分、字幕输出、mini 悬浮窗、单 active call session、展示 profile、视频循环动态形象、Live2D adapter 占位、本地系统 TTS 和可用时 ASR-to-draft。真实 Live2D renderer、云端语音 provider 和独立窗口按后续独立切片进入。

## 11. 已确认的第一阶段交互细节

Phase 3 第一阶段已经确认：

- 通话入口放在当前聊天顶栏，用视频图标按钮进入。
- 资产配置放在联系人资料抽屉里的“形象”或“形象与表情”，不放进全局设置，也不常驻主聊天。
- 第一版立绘支持 `png`、`jpg`、`jpeg`、`webp`；不承诺 `gif` 动图。WebP 动图可先按静态图处理。
- 立绘默认完整显示，使用类似 `contain` 的策略，不裁切。
- 大通话窗固定居中，mini 窗固定右下；第一版不做自由拖动。
- 字幕不自动消失，长字幕在底部区域内滚动，不把完整聊天流塞进通话窗口。
- 通话时长只作为当前视图状态，关闭后清零，不入库。
- 通话状态不持久化。刷新或重启后通话关闭，但聊天记录仍在主时间线。
- 第一版只允许一个 active call session。
- A 正在通话时，用户切到 B 聊天，A 通话自动缩成 mini。
- 点击 A 的 mini 会恢复 A 通话，并把当前聊天切回 A。
- A 正在通话时，如果用户在 B 发起视频通话，需要先确认结束 A；不能直接静默切换到 B。

## 12. Phase 3 第一份实施计划

当前实施计划已经写成：

- `docs/superpowers/plans/2026-06-20-phase3-video-call-presence-implementation.md`

可按这个顺序拆：

1. Presentation state 类型、选择器和测试。
2. `assets.metadata_json` migration 与 repository 方法。
3. 表情资产导入、预览、删除和映射 UI。
4. 聊天顶栏视频通话入口。
5. 大通话窗、字幕区和文字输入。
6. mini 悬浮窗、切联系人自动 mini、第二通话确认挂断。
7. 保留 Live2D adapter 类型边界和后续扩展位置；不在第一切片实现具体渲染库。
8. Electron smoke 与文档更新。

这样做的好处是：就算 Live2D 选型暂时不稳，Phase 3 也已经能交付“角色有表情、有状态、有可感知存在感”的第一版。
