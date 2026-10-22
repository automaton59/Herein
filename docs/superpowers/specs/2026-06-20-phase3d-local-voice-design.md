# Phase 3D 设计：本地系统语音第一版

日期：2026-06-20
状态：Phase 3 语音切片设计

## 1. 目标

Phase 3D 的目标是给通话窗口补上第一版语音存在感，但不把产品绑到某一个云语音 provider：

- TTS：通话窗口可以把最新助手字幕读出来。
- ASR：运行环境支持语音识别时，用户可以把语音转成输入框文本，再走现有发送链路。
- 主聊天仍是唯一时间线；语音只是通话层输入/输出方式。
- 语音状态不入库，刷新或关闭通话后清空。

本切片不做云端 TTS provider、不做声音市场、不做角色级 voice profile、不保存音频文件、不把语音内容写成新的独立会话。

## 2. 方案选择

推荐方案：先使用 Chromium/Electron 可用的 Web Speech 能力。

原因：

- `speechSynthesis` 能直接把字幕读出来，不需要新 API key、成本、缓存或音频文件生命周期。
- `SpeechRecognition` 在部分环境不可用，所以只做能力检测和可用时启用；不可用时文字输入保持完整可用。
- 这条方案验证 UI、状态、通话层时序和测试边界，后续接 OpenAI-compatible TTS 或其他 provider 时只替换语音服务层。

备选方案：

- 直接接云端 TTS：声音效果更可控，但要先决定 provider、模型、音频缓存、费用和 API profile 归属。
- 只做 UI 占位：风险低，但无法证明 Phase 3D 的语音输出链路。

## 3. 架构

新增 `src/services/phase3/voice.ts`，只做浏览器语音能力的薄封装：

- 检测 TTS/ASR 是否可用。
- 创建 TTS 播放控制器：`speak(text)`、`cancel()`、`isSpeaking()`。
- 创建 ASR 控制器：`start(onResult, onError)`、`stop()`。
- 把 `SpeechRecognition` 这种浏览器差异隔离在服务层，React 组件只处理状态和按钮。

`CallWindow` 负责运行时交互：

- 字幕区域旁增加语音播放按钮和自动朗读切换。
- 有字幕时可点击播放；点击停止会调用 `speechSynthesis.cancel()`。
- 自动朗读默认关闭，用户开启后，新助手字幕到来时自动朗读。
- 麦克风按钮在 ASR 可用时启用；识别到最终文本后填入现有输入框，不自动发送。
- ASR 不可用时按钮禁用，保留文字输入。

## 4. 数据流

TTS：

1. `CallLayer` 仍把最新 assistant message 作为 `subtitle` 传给 `CallWindow`。
2. 用户点击播放，或开启自动朗读后字幕变化。
3. `CallWindow` 调用 voice service 朗读字幕。
4. 用户关闭、最小化、字幕变化或手动停止时取消当前朗读。

ASR：

1. 用户在通话窗口点击麦克风按钮。
2. voice service 启动识别。
3. 最终 transcript 返回后写入现有 `draft`。
4. 用户点击发送，继续复用 `onSend(content)`，消息仍写入 primary timeline。

## 5. UI

语音按钮放在通话窗口底部输入区附近：

- 喇叭按钮：播放当前字幕。
- 停止按钮：停止当前朗读。
- 自动朗读开关：开启后后续字幕自动朗读。
- 麦克风按钮：开始/停止语音输入。

按钮用图标和 `aria-label/title` 表达，不在界面里加入说明性大段文字。不可用时使用 disabled 状态。

## 6. 错误与回退

- 没有 `speechSynthesis`：TTS 按钮禁用，通话字幕仍正常显示。
- 没有 `SpeechRecognition`：麦克风按钮禁用，文字输入仍正常。
- TTS 播放失败：停止 speaking 状态，不影响通话。
- ASR 失败或用户拒绝权限：结束 listening 状态，保留输入框当前内容。
- 关闭通话窗口时取消朗读和识别。

## 7. 测试

自动测试覆盖：

- voice service 能检测 TTS/ASR 能力。
- TTS controller 会创建 utterance、调用 `speechSynthesis.speak()`，取消时调用 `cancel()`。
- CallWindow 点击播放字幕会触发 TTS。
- 自动朗读开启后，新 subtitle 到来会触发 TTS。
- ASR 返回 transcript 后填入输入框，并通过原发送按钮走 `onSend`。
- 不支持 TTS/ASR 时按钮禁用，文字输入仍可发送。

手动 smoke：

- 打开通话窗口，有助手字幕时点击语音播放。
- 开启自动朗读，发送新消息后确认新字幕自动朗读。
- 点击停止确认朗读停止。
- 如果当前 Electron 环境支持语音识别，点击麦克风并确认 transcript 进入输入框。
- 语音识别不可用时确认按钮禁用且文字输入不受影响。
