# 本地内容接入

公开仓库只放引擎和通用插件。具体角色、模型、提示词、账号和路径都放在 `private/`，该目录已在 `.gitignore` 中。

## 插件

- 公共插件：`plugins/<id>/`，只放通用逻辑、`plugin.json` 和空配置 schema。
- 私有插件：`private/plugins/<id>/`，放本机专用实现、内网地址、私有配置。
- 启动时两个目录都会扫描；同 id 时 `private/plugins` 覆盖公共插件。
- 插件运行配置存在 SQLite，不写回仓库文件。
- 可用 `HEREIN_PRIVATE_PLUGINS_DIR` 指向别处的私有插件目录。

## Live2D / 动态形象

`private/local-content.json` 是本地资产清单，示例结构：

```json
{
  "schemaVersion": 1,
  "assets": [
    {
      "id": "local-live2d",
      "characterId": "character-id",
      "kind": "live2d",
      "relativePath": "live2d/<model>/<model>.model.json",
      "label": "本地 Live2D",
      "metadata": { "renderer": "live2d" }
    }
  ],
  "presentation": {
    "character-id": {
      "preferredRenderer": "live2d",
      "dynamicAssetId": "local-live2d"
    }
  }
}
```

- `relativePath` 相对于一个受控资产根：`<userData>/data/assets` 或 `private/assets`。
- Core 的 `/assets/` 会按顺序查找这些根；路径穿越会被拒绝。
- 只有形象配置仍是默认值时才写入 presentation，避免覆盖用户手选。
- 可用 `HEREIN_LOCAL_CONTENT` 指向别处的清单。

## 提示词

- 人格/关系/群聊：`private/persona/<pack>/prompts/*.md`，由 persona loader 编译。
- 经历抽取：`private/prompts/v0/experience.md`，运行时通过 `localPrompt` 读取。
- 内容推荐：`private/prompts/v0/content_recommend.md`，已有专用加载路径。
- 记忆 ops 与摘要仍使用引擎的结构化契约；不要直接套用旧版 `memories` JSON，否则会写坏记忆。
- 可用 `HEREIN_PRIVATE_PROMPTS_DIR` 指向别处的提示词目录。

## 数据目录

- 默认 `%APPDATA%\herein`。
- 如果该目录不可写，会自动回退到仓库下的 `.herein-data/`（已 gitignore），并从旧目录复制一次数据库和资产。
- 启动脚本也会在 AppData 不可写时设置 `HEREIN_USER_DATA_DIR` 到 `.herein-data`。
- 需要固定目录时显式设置 `HEREIN_USER_DATA_DIR`。

## 检查

```powershell
npm run check:core
npm run check:contrast
npx tsc --noEmit
npx vitest run
```
