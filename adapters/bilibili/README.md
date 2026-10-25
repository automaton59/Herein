# @herein/adapter-bilibili

Bilibili client. 默认匿名只读；带上 SESSDATA/bili_jct cookie 后可读登录态并发布评论。

## 已实现

- WBI 签名（mixin key、wts、w_rid）
- `nav` 取 WBI keys（兼容未登录 `code=-101` 但带 `wbi_img` 的响应）
- `getView(bvid)`
- `getRcmd({ps, freshIdx})`
- `getConclusion(bvid, cid, upMid)`
- `getPlayerInfo(bvid, cid)`（字幕列表）
- `getReplies({oid|bvid}, {pn, ps, sort})`：读评论区（匿名可用）
- `getReplyReplies({oid|bvid}, rootRpid, {pn, ps})`：读楼中楼
- `getMyInfo()`：登录状态（匿名返回 `isLogin:false`，不抛错）
- `postReply({oid|bvid}, message, {rootRpid?, parentRpid?})`：发评论/回复（需凭据）
- 1.1s 最小请求间隔（GET/POST 共用一条节流线）
- `BilibiliApiError`（code/status/message）
- 412/-352/-412 等风控错误不重试，交给上层熔断

## 登录

构造时传 `cookie`（浏览器整串 Cookie 即可）。写能力需要其中同时有
`SESSDATA` 和 `bili_jct`（bili_jct 即 csrf），否则 `canWrite` 为 false，
`postReply` 在发请求前就抛 `BilibiliApiError(-101)`。

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

// 匿名
const client = new BilibiliClient({ minIntervalMs: 1200 });
const feed = await client.getRcmd({ ps: 10 });
const comments = await client.getReplies({ bvid: 'BV...' });

// 登录（从浏览器复制整串 Cookie）
const me = new BilibiliClient({ cookie: 'SESSDATA=...; bili_jct=...' });
await me.postReply({ bvid: 'BV...' }, '说点什么', { rootRpid: 123 });
```

## 边界

- 读：评论、推荐流、视频信息匿名可用；部分接口登录后才有完整数据。
- 写：只有 `postReply`（评论/回复）。点赞、投币、收藏、私信均未实现。
- 写前自检凭据；无凭据不发请求。客户端不限制内容与频率策略，节奏由调用方（插件/Core）决定。
- 不自动过验证码，不伪造 `X-Real-IP`。风控（412/-352/12061 评论过频等）原样抛错。
- 评论接口走 `x/v2/reply`（legacy，匿名可用）；B 站若下线该端点需迁移到 wbi/main。
