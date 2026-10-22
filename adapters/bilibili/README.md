# @herein/adapter-bilibili

Read-only Bilibili client. No login, no writes, no comments.

## 已实现

- WBI 签名（mixin key、wts、w_rid）
- `nav` 取 WBI keys（兼容未登录 `code=-101` 但带 `wbi_img` 的响应）
- `getView(bvid)`
- `getRcmd({ps, freshIdx})`
- `getConclusion(bvid, cid, upMid)`
- `getPlayerInfo(bvid, cid)`（字幕列表）
- 1.1s 最小请求间隔
- `BilibiliApiError`（code/status/message）
- 412/-352/-412 等风控错误不重试，交给上层熔断

## 实测

2026-10-21：

```text
rcmd_items 5
view: HTTP 412 request was banned
```

`rcmd` + WBI 正常；当前出口 IP 对 `view` 被风控。代码侧已按 412 处理，不自动绕过验证码。

## 使用

```ts
import { BilibiliClient } from '@herein/adapter-bilibili';

const client = new BilibiliClient({ minIntervalMs: 1200 });
const feed = await client.getRcmd({ ps: 10 });
```

## 边界

- 只读。
- 不读/不写评论、不点赞、不投币、不收藏。
- 不自动过验证码，不伪造 `X-Real-IP`。
- `view`/`conclusion` 412 时熔断 30–60 分钟。
