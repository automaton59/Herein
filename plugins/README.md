# Herein plugins

Native plugins live in this directory. Each plugin is a directory with a `plugin.json` manifest and a JavaScript module entry.

```text
plugins/
└─ weather/
   ├─ plugin.json
   ├─ index.mjs
   └─ README.md
```

## Manifest

```json
{
  "id": "weather",
  "name": "天气",
  "version": "0.1.0",
  "kind": "tool",
  "description": "查询当前天气。",
  "entry": "index.mjs",
  "permissions": [
    { "kind": "network", "value": "api.open-meteo.com" }
  ],
  "configSchema": {
    "type": "object",
    "properties": {
      "city": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

Kinds: `source`, `channel`, `tool`, `agent`.

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

`ctx` provides `config`, `fetch`, `now` and `log`. Plugins never receive the database or credentials.

## Lifecycle

The Core host exposes:

- `GET /v1/plugins`
- `POST /v1/plugins/install` `{ "id": "weather" }`
- `POST /v1/plugins/:id/enable`
- `POST /v1/plugins/:id/disable`
- `PATCH /v1/plugins/:id/config` `{ "config": { ... } }`
- `POST /v1/plugins/:id/invoke` `{ "action": "current", "input": {} }`
- `DELETE /v1/plugins/:id`
- `GET /v1/plugins/audit?limit=100`

Weather is the first end-to-end validation: install → configure → enable → invoke → disable → remove, with audit and permission checks.

## Boundaries

- Plugins can read sources, emit observations/experiences, register tools, and send through channels.
- Plugins cannot write persona, memory or relationship records, and cannot bypass permissions or audit.
- A plugin provides capability, not cadence: the runtime decides when to call it.
