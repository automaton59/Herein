# 离线推送（ntfy）

APP 关闭时，SSE 收不到。当前用 **ntfy** 做离线通知的兜底：不依赖 FCM / Google，手机装 ntfy 即可。

## 它怎么工作

```text
Core 定时分享
  → song.shared SSE（APP 开着时）
  → ntfy POST（APP 关着时）
  → 手机 ntfy 通知
```

## 配置

在启动 Core/隧道前设置：

```powershell
$env:HEREIN_NTFY_URL = "https://ntfy.sh"       # 或自建 https://push.example.com
$env:HEREIN_NTFY_TOPIC = "herein-换一个长随机串"
$env:HEREIN_NTFY_TOKEN = ""                      # 公共 ntfy.sh 可留空；自建建议加
$env:HEREIN_NTFY_CLICK = "http://147.224.56.120/herein"
npm run tunnel
```

手机上装 ntfy app，订阅同一个 topic。收到通知的标题是“角色转了一首歌”，正文是歌名 + 一句转发话。

## 自建

1C1G 可以跑 ntfy 单二进制（很小），但注意和酒馆共用内存：

```bash
# 示例，具体版本以 ntfy 官方 release 为准
./ntfy serve
```

Caddy 加一个子域/路径反代到 ntfy，或者只在内网用。公网使用时给 topic 加随机后缀和 token。

## 安全

- topic 本身就是密码；不要用 `herein` 这种可猜名字。
- 公共 ntfy.sh 的消息会经过第三方；敏感内容不要走公共 topic。
- 自建时建议 HTTPS + token；不要把 token 提交到仓库。
- 通知里只有歌名/歌手/一句转发话，不带聊天记录。

## 限制

- 这是“通知”，不是 APP 内消息；点开是 click URL / ntfy，不是原生会话。
- 需要用户装 ntfy；不装就只有 APP 开着时的 SSE。
- 没有已读/未读同步；真正的离线消息队列还要自己做。
