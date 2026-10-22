# @herein/adapter-netease

Anonymous, read-only NetEase Cloud Music client. No login, no playback, no
comments.

## 已实现

- `search(keyword)` → `/api/search/get`
- `songDetail(ids)` → `/api/song/detail`
- `lyrics(id)` → `/api/song/lyric`（lrc/tlyric）
- `playlist(id)` → `/api/v6/playlist/detail`
- `toplists()` → `/api/toplist`
- `personalizedPlaylists(limit)` → `/api/personalized/playlist`（匿名可能受限）
- 1.1s 最小请求间隔、`NeteaseApiError`

## 实测

2026-10-21，匿名、无 Cookie：

```text
toplists 64  飙升榜
search   37  沙海拾香
lyrics   true
```

## 边界

- 不登录、不读评论、不播放、不点赞/收藏/建歌单。
- 460/462/503 交给上层熔断 30–60 分钟，不自动过验证码。
- 网易云只用于歌名/歌手/歌词/公开歌单/榜单/公开推荐；评论不作为数据源。
- 个人化“我的歌单/听歌记录”未做，需要登录，当前不引入账号。
