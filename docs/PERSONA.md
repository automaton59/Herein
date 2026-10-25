# Persona Pack

Herein 的角色人格不是写死在代码里的，也不是聊天时可切换的身份。它是一个放在私有层的 **persona pack**：一组 JSON 描述加若干 Markdown 模板，启动时加载、编译成 system prompt。

这一层被刻意排除在仓库之外，因为人格模板属于个人内容，不属于开源代码。

## 放在哪

```text
private/persona/<pack-id>/
  manifest.json
  character.json
  prompts/
    safety_identity.md
    character_core.md
    relationship.md
    chat_behavior.md
```

`private/` 整个目录在 `.gitignore` 里。默认根目录是 `<项目根>/private/persona`，可用 `HEREIN_PERSONA_DIR` 覆盖；打包版指向 `resources/persona`。

没有 pack 时应用会明确报错（`invalid persona manifest at ...`），不会退回某个内置角色 —— 这是有意的：宁可启动失败，也不要悄悄换一个人。

## 快速起步

```bash
cp -r examples/persona-minimal private/persona/my-companion
```

然后改 `manifest.json` 的 `id`、`character.json` 的 `id` / `name` / `relationshipFrame`，再改 `prompts/` 下的四份模板。两个 `id` 必须一致。

```bash
npm run check:persona
```

这条命令会加载并编译 pack，报出缺模板、未知变量、路径越界等问题。

## manifest.json

```json
{
  "schemaVersion": 1,
  "id": "example-companion",
  "version": "0.1.0",
  "engine": ">=0.1.0 <1.0.0",
  "character": "character.json",
  "templates": [
    { "id": "safety_identity", "layer": "L0_safety_identity", "file": "prompts/safety_identity.md", "required": true }
  ]
}
```

| 字段 | 约束 |
|---|---|
| `schemaVersion` | 必须是 `1` |
| `id` | 小写 slug，`[a-z0-9][a-z0-9_-]{0,63}`，且与 `character.json` 的 `id` 相同 |
| `version` | semver |
| `engine` | 非空字符串 |
| `character` | pack 内的安全相对路径（不能以 `/` 开头、不能含 `..`、不能是盘符路径） |
| `templates` | 非空数组；`id` 不能重复；`layer` 必须是下表之一 |
| `tuning` | 可选；引擎调参，见下文「引擎调参（tuning）」 |

**必需的模板 id：`safety_identity`、`character_core`、`chat_behavior`。** 缺任何一个都会在加载阶段失败。`relationship` 存在时才会注入（仅私聊场景 `audience === 'private'`）。

### 层级

| layer | 用途 |
|---|---|
| `L0_safety_identity` | 身份与硬边界，最先注入 |
| `L1_character_core` | 人格内核 |
| `L2_relationship` | 关系状态与共同上下文 |
| `L3_user_model` | 对用户的理解 |
| `L4_scene` | 场景约束 |
| `L5_task` | 行为规则（`chat_behavior` / `group_behavior` 都在这一层） |
| `L6_output_contract` | 输出格式契约 |

### 引擎调参（tuning）

manifest 里可选的 `tuning` 段可以把 Core 内置策略引擎的参数调软。所有字段都有默认值（等于当前内置行为），只写想改的：

```json
{
  "tuning": {
    "turnDirector": {
      "ventLongChars": 60,
      "shortChars": 6,
      "lowPatience": 0.4,
      "recentReplyWindowMs": 60000,
      "maxTokens": { "elaborate": 480, "question": 220, "ordinary": 180, "react": 60 }
    },
    "replyStyle": {
      "maxBubbles": 2,
      "maxBubbleChars": 46
    }
  }
}
```

| 参数 | 含义 |
|---|---|
| `turnDirector.ventLongChars` | 宣泄类消息达到这个长度就先沉默听完（默认 60） |
| `turnDirector.shortChars` | 短于此长度的日常陈述只给轻反应（默认 6） |
| `turnDirector.lowPatience` | 耐心值低于此阈值时回复保持简短（默认 0.4） |
| `turnDirector.recentReplyWindowMs` | 刚回复过又收到「嗯/哦」时保持沉默的窗口（默认 60000） |
| `turnDirector.maxTokens.*` | 各回合形态的输出 token 上限 |
| `replyStyle.maxBubbles` | 一条回复最多拆成几个气泡（默认 2，1–4） |
| `replyStyle.maxBubbleChars` | 触发长句拆分的字符数（默认 46） |

表情包的频率（`frequency`/`minGap`）不在这里——那是 stickers 插件的 config，在「系统 → 插件」里配。

## 应用内编辑与文件的关系

设置 → 角色里可以直接编辑人格（身份字段 + 各层模板文本），保存后写入本地数据库并**立即生效**，不写回文件。规则：

- **文件是出厂默认**。首次启动把 pack 种子进数据库；之后每次启动只在 pack 指纹变化时才重新应用（也就是有人在磁盘上改了文件）。
- **界面修改在重启后仍然保留**（指纹没变就不会被文件覆盖）。
- **外部改了文件**（比如让另一个 AI 会话生成提示词）：设置页会提示「文件已修改」，点「从文件同步」即可应用到界面和对话——这会覆盖界面修改。
- `tuning` 只能通过文件修改，属于开发者配置，不在界面编辑范围内。

## character.json

必填：`schemaVersion`（1）、`id`、`name`、`relationshipFrame`、`personality.core`（非空字符串数组）、`speakingStyle.defaultAddress`。

可选：`nickname`、`personality.values` / `boundaries`、`speakingStyle` 的 `occasionalAddress`、`sweetness`、`stubbornness`、`replyShape`、`examples`、`voice`、`avatar`、`createdAt`。

`voice` 和 `avatar` 只在你确实配了本地 TTS / Live2D 模型时才有意义；缺省时对应功能自动降级，不影响聊天。

## 模板变量

模板里用 `{{变量名}}`，加载时会校验：出现未列出的变量名会直接失败（防止拼错后静默失效）。可用的变量：

| 变量 | 来源 |
|---|---|
| `character_name` | `character.json` 的 `name` |
| `nickname` | `nickname`，缺省等于 `name` |
| `relationship_frame` | `relationshipFrame` |
| `user_address` | 调用方传入，缺省「你」 |
| `relationship_stage` | 关系记录的 `tone`，缺省「刚开始」 |
| `closeness` | 关系记录 `closeness`（0–10） |
| `default_address` | `speakingStyle.defaultAddress` |
| `occasional_address` | `speakingStyle.occasionalAddress`，缺省「无」 |
| `shared_habits` | 关系记录，缺省「暂无」 |
| `private_language` | 关系记录，缺省「暂无」 |
| `important_experiences` | 关系记录，缺省「暂无」 |
| `unresolved_context` | 关系记录，缺省「暂无」 |
| `presence_mode` | 当前在场模式，缺省「participant」 |

模板文件上限 128 KB。`relationship.md` 里的「暂无」是真实状态，不要让人格去编造这些内容。

## 设计建议

- 人格模板写得越像「她本来就懂这些」越有效，写成一长串 `必须 / 禁止` 的规则清单反而容易被模型表面遵守、实际出戏。
- 示例对话（`speakingStyle.examples`）对语气的权重比抽象形容词高。
- 私聊与群聊的语气差异放在两份 `chat_behavior` / `group_behavior` 里，不要靠运行时判断。
