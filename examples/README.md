# 示例文件

这里是可以安全提交的起步模板：全部是占位值，没有真实密钥、主机或人格内容。

| 路径 | 用途 |
|---|---|
| `credentials/llm.example.json` | OpenAI-compatible API 配置模板 → 复制为 `private/credentials/llm.json` |
| `credentials/qqbot.example.json` | QQ Bot 凭据模板 → 复制为 `private/credentials/qqbot.json` |
| `credentials/sync.example.json` | 远程同步服务器模板 → 复制为 `private/credentials/sync.json` |
| `persona-minimal/` | 最小可跑的 persona pack，可直接 `cp -r` 到 `private/persona/` |

`private/` 整个目录被 `.gitignore` 排除，所以模板放在这里、实配文件放那边。

## 为什么不用 `.env`

凭据分三份 JSON，各自独立启停：LLM 没配也能开应用（只是不能聊天），QQ Bot 没配就不连网关，同步没配就不上传。合成一个 `.env` 会让「部分可用」变成「全有或全无」。

## 验证

```bash
cp examples/credentials/llm.example.json private/credentials/llm.json
# 填入真实的 baseUrl / apiKey / model

cp -r examples/persona-minimal private/persona/my-companion
# 改 manifest.json 与 character.json 的 id（两处必须一致）
npm run check:persona
```

persona pack 的结构与变量说明见 [docs/PERSONA.md](../docs/PERSONA.md)。
