# Phase 3 设计：视频通话式角色存在感

日期：2026-06-20
状态：已确认的 Phase 3 第一阶段方向

## 1. 目标

Phase 3 第一阶段优先做“发起视频通话”的体验，而不是先做聊天头像表情切换，也不是直接上 Live2D。

目标是让用户从当前联系人进入一个像 IM 视频通话一样的窗口：窗口里看到角色立绘，角色回复时用字幕展示内容，并根据回复的 emotion 切换静态立绘差分。所有消息仍然写入同一条主聊天时间线，不新建会话，不切断 Phase 2 的记忆、总结和上下文装配。

这一阶段暂不做真实摄像头、真实音频通话、ASR 或 TTS。没有 TTS 时，AI 输出以“通话字幕/台词条”的方式展示，而不是在通话窗口里复刻完整聊天气泡。

## 2. 产品原则

### 2.1 视频通话是通话窗口，不是聊天页换皮

通话视图应像桌面聊天软件的视频通话窗口：可放大查看角色，可缩小成悬浮小窗，用户需要翻聊天记录时可以回到主聊天。

它不是一个新的聊天，不是角色详情页，也不是把普通聊天列表换个背景。

### 2.2 主聊天仍是唯一时间线

通话窗口里发送的文字、AI 生成的回复、emotion metadata 都写入当前角色的 primary timeline。退出通话窗口后，主聊天能看到完整记录。重新打开通话仍然面对同一个联系人和同一段关系。

### 2.3 输出是字幕，不是气泡

在没有 TTS 的第一版里，AI 回复展示为通话字幕：

- 短回复显示为底部一到两行字幕。
- 长回复显示为底部可滚动字幕框，最多占通话窗口高度约 25%-30%。
- 字幕不自动消失，保留到下一条回复或用户手动清空。
- 字幕和立绘差分同步更新。

完整聊天历史留在主聊天页，不在通话窗口里默认展开。

### 2.4 先静态差分，后 Live2D

第一版支持本地上传静态立绘差分，例如 `neutral`、`happy`、`sad`、`worried`、`shy`、`excited`、`angry`。如果缺少对应差分，回退到 `neutral`；如果没有 neutral，回退到头像或默认占位。

Live2D、视频循环、TTS 和 ASR 都应复用同一套通话状态和资产映射，而不是重做一套产品逻辑。

## 3. 视图模式

预留统一模式类型：

```ts
type CallViewMode = 'windowed' | 'mini' | 'fullscreen' | 'pip';
```

第一版只实现：

- `windowed`：桌面大通话窗。
- `mini`：应用内部悬浮小窗。

预留但不实现：

- `fullscreen`：未来全屏通话视图。第一版 fallback 到 `windowed`。
- `pip`：未来系统级或移动端画中画。第一版 fallback 到 `mini`。

产品 UI 不暴露 `fullscreen` 和 `pip` 入口，只在类型、状态和组件 props 中留好位置。

## 4. 宿主形态

第一版用应用内浮窗实现，而不直接创建 Electron 独立 `BrowserWindow`。

原因：

- 可以直接复用当前 React/Zustand 状态。
- 发送消息、pending、字幕、立绘切换都能沿用现有聊天链路。
- 迷你窗可以自然浮在主聊天界面上方。
- 避免第一版就处理 Electron 多窗口状态同步、焦点、置顶、关闭生命周期。

预留宿主类型：

```ts
type CallHost = 'in-app' | 'electron-window';
```

第一版固定为 `in-app`。未来如果需要真正独立窗口，可以复用同一个 `CallWindow` 组件和 call session 状态。

## 5. 桌面布局

### 5.1 大通话窗

大通话窗按应用内 overlay 实现，但视觉上应像一个真实通话窗口。

结构：

```text
┌────────────────────────────────────┐
│  头像 名称   通话中  00:32      _ × │
│                                    │
│                                    │
│             角色立绘主体            │
│                                    │
│                                    │
│      “这里显示 AI 当前回复字幕……”    │
│  [ 输入文字...              发送 ]   │
└────────────────────────────────────┘
```

层级：

- 顶栏：联系人名、状态、通话时长、最小化、关闭。
- 中部：角色立绘主体，占窗口最大区域。
- 底部：字幕优先，输入框次之。

底部输入框是临时方案：没有 ASR 前常驻；未来有 ASR/TTS 后可以默认折叠，只在用户选择文字输入时展开。

第一版大通话窗固定居中，不做拖动和自由缩放。窗口最大化、真正全屏、系统级画中画都只保留接口，不做 UI。

### 5.2 迷你悬浮窗

迷你窗用于用户回主聊天看记录时保持通话存在感。

内容：

- 小尺寸角色立绘或头像。
- 联系人名或状态。
- 最新一句短字幕摘要，必要时截断。
- 点击恢复到大通话窗。
- 可关闭通话视图。

迷你窗只浮在此间应用内部。系统级 PIP 是未来能力，不在第一版实现。

第一版迷你窗固定在主界面右下角。后续可以再补拖动位置记忆，但不进入第一阶段。

### 5.3 切换联系人时的行为

如果用户正在和 A 通话，随后点击左侧联系人 B：

- A 的通话自动从 `windowed` 变成 `mini`。
- A 的 mini 窗继续显示 A 的立绘、状态和最新字幕摘要。
- 用户可以在 B 的主聊天里正常查看和打字。
- 点击 A 的 mini 窗时，恢复 A 的大通话窗，并把当前聊天切回 A。

第一版只允许一个 active call session。不能同时和多个联系人通话。

如果用户正在和 A 通话，又在 B 的聊天顶栏点击视频通话按钮：

- 不直接切到 B。
- 显示轻确认：当前正在和 A 通话，是否先结束当前通话。
- 确认后：结束 A 通话，再发起 B 通话。
- 取消后：保持 A 通话，继续停留在 B 页面。

这个行为比“直接切换通话对象”更接近真实视频通话，也能避免角色时间线、字幕、资产状态串台。

## 6. 资产与数据

Phase 2 已有 `assets` 表和 `AssetRecord.kind`。Phase 3 需要给资产补 metadata。

建议新增 migration：

- `assets.metadata_json text not null default '{}'`。
- 可选新增 `character_presentation_profiles`，保存默认立绘、emotion 映射和回退策略。

第一版可支持的 expression metadata：

```json
{
  "expressionKey": "happy-main",
  "emotion": "happy",
  "label": "开心",
  "priority": 10
}
```

第一版立绘资产格式：

- 支持 `png`、`jpg`、`jpeg`、`webp`。
- 不承诺支持 `gif` 动图。
- 如果 WebP 是动图，第一版可以按静态图处理。
- 图片展示默认使用完整显示的 `contain` 策略，不裁切立绘。

角色展示配置可表达为：

```ts
type PresentationEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'shy' | 'excited' | 'worried';

interface CharacterPresentationProfile {
  characterId: string;
  defaultAssetId?: string | null;
  emotionAssetMap: Partial<Record<PresentationEmotion, string>>;
  fallbackEmotion: PresentationEmotion;
}
```

第一版资产管理入口放在联系人资料里，命名可以是“形象”或“形象与表情”。它应支持：

- 上传默认立绘。
- 上传多个差分立绘。
- 为差分绑定 emotion。
- 预览。
- 删除或替换。
- 显示缺失映射的回退说明。

主聊天顶栏放一个视频图标按钮作为通话入口。即使角色没有上传立绘，也可以发起通话；此时显示头像或默认占位。

## 7. 状态与数据流

推荐管线：

1. 用户从当前联系人点击视频通话按钮。
2. UI 打开 call view，绑定当前 `characterId` 和 primary `timelineId`。
3. 用户在通话窗输入文字并发送。
4. 发送流程复用 `src/stores/chat.ts` 的主聊天发送链路。
5. 用户消息写入 primary timeline。
6. 助手回复完成后写入 primary timeline，并保存 `emotion` metadata。
7. call presentation service 根据最近助手消息 emotion 选择立绘差分。
8. 通话窗底部显示助手回复字幕。
9. Phase 2 记忆触发逻辑照常后台运行。

状态建议：

```ts
interface CallSessionState {
  characterId: string;
  timelineId: string;
  host: CallHost;
  mode: CallViewMode;
  isOpen: boolean;
  startedAt: string;
  elapsedMs?: number;
  lastSubtitleMessageId?: string | null;
}
```

`CallSessionState` 第一版可以只保存在 renderer store，不必进入 SQLite。通话记录本身已经在 primary timeline 中持久化。

通话时长只作为当前通话视图状态展示。关闭通话视图后清零，不入库；刷新或重启应用后通话状态关闭，但聊天记录保留。

## 8. 错误与回退

必须优雅处理：

- 没有任何立绘资产：显示头像或默认占位。
- 缺少某个 emotion 差分：回退 neutral。
- neutral 也缺失：回退默认立绘或头像。
- 资产文件丢失或读取失败：显示占位并提示用户重新上传。
- LLM 回复没有 emotion：按 neutral 处理。
- 发送失败：字幕区域显示温和错误状态，用户消息仍按现有聊天失败逻辑处理。
- 最小化后再恢复：保留最后字幕和当前差分。
- 已有 active call 时尝试发起另一通话：必须确认先结束当前通话，不允许静默切换。

## 9. 非目标

第一阶段不做：

- 真实摄像头。
- TTS。
- ASR。
- Live2D 渲染。
- 系统级 PIP。
- 移动端全屏适配实现。
- Electron 独立窗口。
- 在通话窗口里展示完整聊天历史。
- 新建独立视频会话或视频房间。
- 用户可编辑 prompt。

## 10. 验证要求

自动测试：

- `CallViewMode` fallback：`fullscreen -> windowed`，`pip -> mini`。
- emotion 到差分资产选择：命中、缺失、neutral 回退、头像回退。
- 只接受第一版支持的立绘格式：`png`、`jpg`、`jpeg`、`webp`。
- 通话发送复用 primary timeline，不创建新 timeline。
- 助手回复字幕来自最新 assistant message。
- 关闭/最小化不会删除消息或丢失 pending 状态。
- 切换联系人时，已有 `windowed` 通话自动变 `mini`。
- 点击 mini 恢复原联系人通话，并切回原联系人。
- 已有 active call 时发起另一联系人通话，需要先确认结束当前通话。
- 删除资产后 UI 回退，不崩溃。

手动 smoke：

- 给角色上传 neutral/happy/worried 立绘差分。
- 从聊天顶栏发起视频通话。
- 在通话窗发送文本，确认主聊天同步出现用户消息和助手回复。
- 确认助手回复后字幕出现，立绘按 emotion 切换。
- 缩小成迷你窗，再恢复。
- 切换联系人，确认通话资产和字幕不串。
- 亮色、暗色、窄屏窗口检查不重叠、不破图。

## 11. 后续扩展路径

当第一版稳定后：

1. 给通话窗口接 TTS，字幕变成辅助字幕。
2. 给用户输入接 ASR，输入框默认折叠。
3. 用 Live2D adapter 替换静态立绘渲染器。
4. 实现 `fullscreen` 和移动端 `pip`。
5. 如确有需要，再把 `CallHost` 从 `in-app` 扩展到 Electron 独立窗口。
6. 让关系状态和记忆参与更细的动作/表情选择，但仍保持内部结构化输出，不开放 prompt 编辑器。
