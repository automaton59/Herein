# Herein plugins

Native plugins live in this directory. Each plugin is a directory with a `plugin.json` manifest and a JavaScript module entry.

> 使用者视角的配置步骤（每个插件要准备什么、怎么验证）见
> [docs/PLUGIN-SETUP.md](../docs/PLUGIN-SETUP.md)。这一页只讲插件怎么写。

```text
plugins/
└─ weather/
   ├─ plugin.json
   ├─ index.mjs
   └─ README.md
```

This directory is the **public** plugin shelf: generic capability code that can ship with the engine. Local plugins with private endpoints, account names, tokens or personal prompts go under `private/plugins/` instead. Both directories are scanned at startup; a plugin in `private/plugins/` overrides the same id from this shelf.

Keep the two layers separate:

- `plugins/*/{plugin.json,index.mjs}` — public logic and schema, no personal data.
- `private/plugins/*` — private implementation/config for this deployment; gitignored.
- Plugin runtime config (city, API endpoint, keys) lives in SQLite and is never written into the public repo.

## Manifest

```json
{
  "id": "weather",
  "name": "天气",
  "version": "0.1.0",
  "apiVersion": 1,
  "kind": "tool",
  "description": "查询当前天气。",
  "setup": "填一个城市名即可，不需要 API key。",
  "helpUrl": "docs/PLUGIN-SETUP.md#weather",
  "entry": "index.mjs",
  "permissions": [
    { "kind": "network", "value": "api.open-meteo.com" }
  ],
  "configSchema": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "title": "城市",
        "description": "和经纬度二选一",
        "placeholder": "例如：杭州",
        "examples": ["杭州"]
      },
      "apiKey": { "type": "string", "title": "Key", "format": "password" }
    },
    "required": ["city"],
    "additionalProperties": false
  }
}
```

`apiVersion` 声明插件是按哪个版本的宿主接口写的。宿主版本更新时这个数字才会涨；对不上时插件装不上，并给出明确的升级提示，而不是在调用时抛一个看不懂的 TypeError。

Kinds: `source`, `channel`, `tool`, `agent`.

`setup` / `helpUrl`（manifest 级）和 `title` / `description` / `placeholder` / `examples` / `format` / `helpUrl`（字段级）都会被设置面板直接渲染，不需要改前端：`format` 支持 `text`、`password`（打码）、`url`（校验 http(s)）、`path`（文件选择）、`directory`（目录选择）。`required`、`enum`、`minimum`、`maximum`、`default` 在保存前后都会校验。

Permissions are enforced by the plugin host:

- `network` — hostname allowlist; the plugin's `ctx.fetch` refuses other hosts.
- `credentials`, `send`, `install`, `filesystem` — recorded for policy/audit; not all are enforced yet.

## Entry

```js
export function createPlugin() {
  return {
    async start(ctx) {},
    async stop() {},
    async health(ctx) {
      return { status: 'ok', checkedAt: ctx.now().toISOString() };
    },
    async invoke(action, input, ctx) {},
  };
}
```

`ctx` provides `config`, `fetch`, `now`, `log`, plus:

- `ctx.assetsDirs` — 素材根目录（按优先级），通过 `/assets/<相对路径>` 提供给界面。读本地文件的插件应把路径解析到这些根目录下，否则生成的 URL 打不开。
- `ctx.dataDir` — 用户数据目录（`app.db` 所在处），适合放 token、缓存等运行期文件。
- `ctx.emit(event)` — 插件向 Core 上报事件的**唯一出口**。`type: 'observation'` 是素材/观察（B 站视频、群消息），`type: 'channel.message'` 是渠道消息（可带 `shouldReply` 请求 Core 生成回复）。Core 收到后负责落库、去重和决定是否回复；插件 await 它返回即代表 Core 已处理完。
- `ctx.loadModule(path)` — 加载应用自带的包（`adapters/<x>/dist/index.js`、`packages/core/dist/index.js`）。路径相对应用根，不能带 `..`。这样插件能复用协议客户端，但拿不到任何内部对象。

**方向只有一个：插件 → Core 上报数据，Core → 插件下发动作（`invoke`）。** 插件拿不到数据库句柄、人格、模型和记忆；写库、去重、回复策略全部在 Core（`electron/core/pluginEvents.ts`）。

Plugins never receive the database or credentials. 需要外部凭据时，让使用者填配置或指向一个文件。

## Lifecycle

The Core host exposes:

- `GET /v1/plugins`
- `POST /v1/plugins/install` `{ "id": "weather" }`
- `POST /v1/plugins/:id/enable`
- `POST /v1/plugins/:id/disable`
- `PATCH /v1/plugins/:id/config` `{ "config": { ... } }`
- `POST /v1/plugins/:id/invoke` `{ "action": "current", "input": {} }`
- `POST /v1/plugins/:id/health` — 立即跑一次健康检查（设置面板的「检查」按钮）
- `DELETE /v1/plugins/:id`
- `GET /v1/plugins/audit?limit=100`

Weather is the first end-to-end validation: install → configure → enable → invoke → disable → remove, with audit and permission checks.

## Boundaries

- Plugins can read sources, emit observations/experiences, register tools, and send through channels.
- Plugins cannot write persona, memory or relationship records, and cannot bypass permissions or audit.
- A plugin provides capability, not cadence: the runtime decides when to call it.
- 内建插件已经不存在：所有插件（weather/stickers/netease/bilibili/qq/dsh）都在 `plugins/` 目录，一个写法。
