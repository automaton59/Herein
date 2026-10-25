# 网易云音乐

只读的歌曲候选来源。安装并启用后，聊天和主动性会从这里拿候选歌单。

不需要账号、不需要 API key，也不写任何数据到数据库——插件只负责取数据并返回，存不存、怎么存由 Core 决定。

## 配置

| 字段 | 说明 |
|---|---|
| `limit` | 每次准备多少首候选，默认 10，范围 1–30 |

## 动作

```http
POST /v1/plugins/netease/invoke
{ "action": "candidates", "input": { "query": "夜晚", "limit": 10 } }
```

`query` 留空时取公开榜单第一页。返回值：

```json
{ "candidates": [ { "title": "...", "artist": "...", "source": "netease" } ] }
```

## 依赖

- 宿主提供的 `adapters/netease/dist/index.js`（网易云只读客户端）
- 宿主提供的 `packages/core/dist/index.js`（歌曲档案归一化）
- 出网目标：`music.163.com`

两个包由宿主随应用分发，插件通过 `ctx.loadModule()` 加载，不需要自己安装依赖。
