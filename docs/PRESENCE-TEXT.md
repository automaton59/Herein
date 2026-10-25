# 桌面 presence：纯文本 + Live2D

最后更新：2026-10-24

## 当前模式

`HEREIN_VOICE_MODE=off`（默认）时：

- 不启动 ASR/TTS、本地 LLM、llama-server、9881 TTS 服务。
- presence 不申请麦克风，不初始化 AudioContext；没有口型。
- 文字聊天走 Core 的 `llm.json` API。
- 语音代码保留在 `electron/voice`、`src/voice`，用 `HEREIN_VOICE_MODE=legacy` 才启用。

## presence UI

- 底部输入条：`Enter` 发送，`Shift+Enter` 换行，中文输入法 composition 期间不误发。
- 回复气泡在头像上方，最多保留两条，10 秒后消失；点击气泡打开聊天页并定位到该消息。
- 点击头部/脸部触发 `reacting`（害羞/俏皮），点击身体打开聊天页；拖动移动窗口。
- presence 发起的消息、聊天页发起的回复、主动消息都会显示气泡。
- 气泡不持久化；聊天页是完整记录。
- 发送时进入 `thinking`，回复时 `replying`，点击头像/气泡互动时 `reacting`，其余 `idle`。

## 对话同步

```text
presence → Core /v1/chat（带最近 10 条历史）
→ Core 写入 primary timeline
→ chat.completed SSE
→ ChatWindow hydrate；presence 气泡
```

- presence 和聊天页共用同一个 primary timeline。
- 聊天页通过现有 `chat.completed` 监听刷新，不需要第二套存储。
- 气泡文本按内容去重，避免 HTTP 响应和 SSE 重复弹两次。

## Live2D 四状态

- **idle**：呼吸、眨眼、视线跟随、Idle 动作。
- **thinking**：等待 API；播放 `Anima/thinking`，头微侧、视线偏上。
- **replying**：气泡展示；轻微点头/身体前倾，表情随回复情绪，嘴始终闭合。
- **reacting**：点击/问候；歪头/点头，几秒后回 idle。

技术实现：

- `Live2DStage` 接收 `activity`，用 ticker 直接写参数，不通过 React 每帧 setState。
- 参数同时尝试 Cubism 4（`ParamAngleX`）和 Cubism 2（`PARAM_ANGLE_X`）命名。
- 不播放 `Anima/speak`；每帧强制 `ParamMouthOpenY=0`、`ParamMouthForm=0`。
- 表情沿用模型现有 `happy/happy2/puzzled/relax/unhappy`。
- 视线跟随鼠标，2.5 秒无指针后回中；随机眨眼；呼吸/身体微摆。
- 隐藏窗口时停止 ticker。

## 后续

- 更精细的模型 hit area（目前用窗口上/下半区近似）。
- 问候动作、更多表情、气泡连续爆发时的完整排队。
- 语音模块作为可选插件，不默认构建；开源前去掉本机路径/模型/密钥。
