# 2026 年网易云音乐「只读接入」技术调研

> 调研日期：2026-10-21（Asia/Shanghai）
> 目标：本地优先的 AI 陪伴系统，以同一账号身份读取歌单、听歌记录、歌曲/歌词/评论；**只读，不发布、不评论、不点赞、不收藏**。
> 证据标注：`【公开资料】` 官方/媒体/文档；`【源码验证】` 直接读仓库源码；`【社区实测】` 他人 2026 年实测记录；`【本次实测】` 本报告作者 2026-10-21 匿名 HTTP 探测；`【未证实】` 无法交叉验证。

---

## 0. 结论先行

| 路线 | 可行性 | 长期稳定性 | 合规风险 | 一句话 |
|---|---|---|---|---|
| 官方开放平台 | **低** | — | 低 | 对个人开发者**没有**公开的 C 端读接口；`music.163.com/open` 是「网易开源」，不是音乐 API 门户 |
| 社区 API（自建 NeteaseCloudMusicApi 系） | **高** | 中 | 中 | 读能力齐全、匿名可读大半，登录后解锁「我的歌单/每日推荐/完整评论分页」 |
| Web/App 逆向（自研 weapi/eapi） | 高 | 中低 | 中 | 协议一年一变（weapi→eapi→xeapi→neapi），需持续维护 |
| 浏览器自动化（Playwright + 已登录 profile） | 中 | 高 | 中高 | 抗协议漂移最强，但资源重、ToS 风险最直观 |

**推荐**：本机/家宽环境，自建只读适配器（明文 `api` 打底 + `weapi` 补全 + 登录态 Cookie），Playwright 仅作降级；不做任何写操作、不做「解灰」、不分发内容。整体可行性评级：**个人自用「高」，做成对外产品「低」**。

---

## 1. 官方能力边界

### 1.1 `music.163.com/open` 的真实身份

【本次实测 2026-10-21】`http://music.163.com/open` 返回内容仅「网易开源」四字（网易开源项目主页），**不是**网易云音乐开放平台，也没有任何 API 文档、AppID 申请或开发者控制台。

【公开资料】网易云音乐面向外部的官方通道实际是两条，都不是「C 端 OpenAPI」：

1. **云村交易所 / 在线播放接入**：`https://music.163.com/st/web-sublicense/home`，文档站栏目包括「在线播放接入」「接入流程」「开通服务」「歌曲播放相关接口概览」。
   【本次实测】这些页面均为 umi SPA，正文由 JS 渲染，抓取只得到空壳；`api-view` 页标题为「歌曲播放相关接口概览」，`api-interfeace` 为「在线播放接入」。
   【未证实】具体接口清单、鉴权方式（AppKey/签名）、是否包含歌单/评论/听歌记录、费用与合同条款——均无法从公开页面读取，需商务接触。
   从命名与行业惯例判断，这是**面向硬件厂商/应用服务商的内容授权 + 播放取链**，不是给个人开发者做「AI 读评论」的接口。
2. **音乐人/创作者中心**：`music.163.com/st/creatordoc/...`，用于作品上传、身份管理、本人作品数据。
   【未证实】是否有对外 API；公开资料只看到 Web 后台。社区逆向出的 `/musician/data/overview`、`/musician/play/trend` 属于**非官方端点**，不是官方开放能力。

### 1.2 官方到底开放什么？

|能力|官方是否开放给个人|说明|
|---|---|---|
|搜索歌曲/歌手/专辑/歌单|否|无公开 API|
|歌单详情/用户歌单|否|仅 B2B 授权（未证实具体范围）|
|歌曲详情/播放 URL|否（B2B 可能含）|版权取链属授权业务|
|歌词|否|无公开歌词 API|
|评论读取|否|无|
|听歌记录/播放历史|否|连 B2B 都未见表述；属个人数据，官方无 OAuth 授权|
|写入（发布/评论/点赞/收藏）|否|不在本次范围|

**门槛判断**：个人开发者**没有**申请入口；企业需商务签约与内容授权（【未证实】资质细则）；音乐人仅能看自己作品的后台数据。所谓「官方 API」在 2026 年对个人自用项目**不可落地**。

---

## 2. 社区 API 现状

### 2.1 项目生命周期（GitHub API 实测 2026-10-21）

| 项目 | 状态 | 关键数据 |
|---|---|---|
| `Binaryify/NeteaseCloudMusicApi` | **已归档、已清空** | `archived=true`，`pushed_at=2024-02-28`，仓库体积 1 KB，`license=null`；30,242 star / 15,979 fork；homepage 指向 GitLab 镜像 |
| `NeteaseCloudMusicApiEnhanced/api-enhanced` | **活跃主继任者** | 创建 2025-07-24，`pushed_at=2026-10-17`，2,043 star / 3,329 fork，**MIT**；npm `@neteasecloudmusicapienhanced/api`，文档 `docs-neteasecloudmusicapi.focalors.ltd` |
| `qier222/YesPlayMusic` | 活跃（播放器 UI） | 33,416 star，MIT，`pushed_at=2026-10-10`，650 open issues；依赖社区 API 做后端 |
| `listen1/listen1_chrome_extension` | 低维护 | 12,116 star，MIT，`pushed_at=2025-06-17` |
| `maotoumao/MusicFree` | 活跃（插件化播放器） | 27,776 star，**AGPL-3.0**，`pushed_at=2026-10-15` |

【公开资料/社区】原版 2024-01 作者主动清库，README 只留「保护版权，此仓库不再维护」，随后归档；媒体称网易方曾提侵权诉求，但**未查到 GitHub 官方 DMCA 下架记录**【未证实】。接口语义与三套加密仍是全社区事实标准，代码以 fork/备份形式存续（如 `nooblong/NeteaseCloudMusicApiBackup`、`ILoveScratch2/NeteaseCloudMusicAPI-Mirror`）。

**License 提示**：原版 docs 标注 MIT，但仓库清空后 `license=null`；api-enhanced 明确 MIT；MusicFree 是 AGPL-3.0（若二次分发/网络服务需开源）。使用备份代码时建议按「原作者 MIT + 自担风险」处理，并保留声明。

### 2.2 三套（实际五套）加密

【源码验证】`api-enhanced/util/crypto.js`（2026-10 版）同时实现 `weapi / linuxapi / eapi / xeapi / neapi`：

| 协议 | 算法 | 关键常量/结构 | 典型用途 |
|---|---|---|---|
| **api（明文）** | 无 | GET/POST 表单 | `/api/song/lyric`、`/api/search/get`、`/api/playlist/detail`、`/api/toplist`、`/api/v1/resource/comments/...` |
| **weapi** | AES-128-CBC 两次 + RSA 无填充 | presetKey `0CoJUm6Qyw8W8jud`，iv `0102030405060708`，随机 16 位 secret；`params` + `encSecKey`（secret 反转后 RSA） | 网页端主力：登录、歌单、搜索、评论、播放记录 |
| **linuxapi** | AES-128-ECB，hex | key `rFgB&h#%2?^eDg:Q`，`eparams`，`/api/linux/forward` | 搜索 `cloudsearch/pc` 主路 |
| **eapi** | AES-128-ECB，hex | key `e82ckenh8dichen8`；`nobody{url}use{json}md5forencrypt` → `{url}-36cd479b6b5-{json}-36cd479b6b5-{md5}` | 客户端接口；**匿名常被网关拒绝** |
| **xeapi**（2024-25 起） | X25519 ECDH + AES-128-GCM | 请求体 `C/S/R` 三段 base64url，会话密钥经响应头下发 | 新客户端 `url/v1`、游客注册等 |
| **neapi**（2026 新） | ChaCha20-Poly1305 + zstd | magic `CSJM`，16B AAD | 最新客户端协议，社区刚逆向 |

**关键差异与坑**：
- `api` 明文最省事，但覆盖不全、字段较老；`weapi` 覆盖最广、匿名也常可用；`eapi` 在匿名/无设备上下文时【社区实测 2026-09】一律 `{"code":404,"message":"接口未找到！"}`，`url/v1` 已迁 xeapi，事实上在废弃；`xeapi/neapi` 只需知道「协议仍在演进」，自研 MVP 不必实现。
- 公开技术分析（metowolf wiki）确认 weapi 的 RSA 是**非标准填充**（secret 反转、直接 `m^e mod n`、左侧补 0），常规 RSA 库需特殊处理。

### 2.3 登录与游客

【社区实测 2026-09】二维码登录是唯一推荐路径，两跳直达 `MUSIC_U`：

1. `POST https://interface.music.163.com/api/login/qrcode/unikey`（裸表单 `type=3`，UA 带 `NeteaseMusicDesktop/3.0.18`）→ `{code:200, unikey}`；二维码内容 `https://music.163.com/login?codekey=<unikey>`。
2. `POST .../api/login/qrcode/client/login`（`key`、`type=3`）轮询：`800` 过期 / `801` 等待 / `802` 已扫待确认 / `803` 成功（Set-Cookie `MUSIC_U`、`__csrf`）。

其他事实：
- Cookie 关键项：`MUSIC_U`（登录态）、`__csrf`（写操作/部分读接口校验）；`deviceId` 在客户端协议里常见，但网页 weapi 读接口不强制。
- **密码/短信登录重度风控**，社区文档明确「密码登录暂时不要使用」；二维码登录的 Cookie **不支持 `/login/refresh` 续期**，失效重扫。
- 游客：匿名即可搜索、歌单详情、歌词、榜单、评论首批；「我的歌单」「每日推荐」「私人 FM」「关注动态」需登录。游客 Cookie（`MUSIC_A`）可垫部分 400/需验证接口，但非必需。
- 登录态探测：`/weapi/nuser/account/get` 匿名返回 `account:null/profile:null`，登录后含 `userId/vipType`，比试错接口更稳。

---

## 3. 读取能力清单（端点级）

> 下列 `module/*.js` 路径均指 api-enhanced 源码【源码验证】；「登录」列为社区/实测结论。

| 能力 | 端点（服务端真实路径） | 封装/加密 | 登录 | 备注 |
|---|---|---|---|---|
| 搜索（歌曲/专辑/歌手/歌单/MV） | `POST /api/linux/forward` → `cloudsearch/pc`；备 `POST /weapi/search/get` | linuxapi / weapi | 否 | `type=1/10/100/1000/1004`；`/weapi/cloudsearch/get/web` 已失效（`50000005`）【社区实测】 |
| 歌曲详情 | `POST /api/v3/song/detail`，`c=[{"id":…}]` | weapi | 否 | 单次建议 ≤500–1000 首 |
| 歌词 | `GET /api/song/lyric?id=&lv=-1&tv=-1&rv=-1` | api 明文 | 否 | 返回 `lrc/tlyric/romalrc`；`yrc` 需 `yv=-1` 且覆盖有限 |
| 歌词（新版） | `POST /weapi/song/lyric/v1` | weapi | 否 | 含 `klyric`、新 JSON 风味 lrc |
| 歌单详情 | `POST /api/v6/playlist/detail`（`id,n,s`） | weapi | 否 | 返回元数据 + `trackIds`（全量）+ `tracks`（前 n 首） |
| 歌单全曲 | `trackIds` → `/api/v3/song/detail` 批量 | weapi | 否 | 大歌单标准做法 |
| 用户歌单 | `POST /weapi/user/playlist`（`uid,limit,offset`） | weapi | 否（他人公开）/是（自己） | 首个通常是「我喜欢的音乐」 |
| 歌单分类/广场/榜单 | `/weapi/playlist/catalogue`、`/weapi/playlist/list`、`GET /api/toplist` | weapi/api | 否 | 榜单 id 即歌单 id |
| **听歌排行** | `POST /api/v1/play/record`（`uid,type`） | weapi | **否（公开时）** | `type=0` 全部 / `type=1` 近一周；见 §3.1 |
| 最近播放 | `POST /api/play-record/song/list`（`limit`） | weapi | 是 | 新版「最近播放」 |
| 每日推荐 | `/weapi/v3/discovery/recommend/songs` | weapi | 是 | 匿名 200 但无个性化内容【社区实测】 |
| 评论（最新） | `GET /api/v1/resource/comments/R_SO_4_{id}`（`rid,limit,offset,beforeTime`） | api 明文 | 否 | 返回 `comments/total/more/hotComments` |
| 评论（热门） | `/api/v1/resource/hotcomments/R_SO_4_{id}` | weapi | 否 | 资源类型前缀：歌曲 `R_SO_4_`、专辑 `R_AL_3_`、歌单 `A_PL_0_`、MV `R_MV_5_` |
| 专辑/歌手 | `/api/album/{id}`、`/api/artist/top/song`、`/api/artist/songs` | weapi | 否 | 字段齐全 |
| 播放 URL（如需试听） | `/weapi/song/enhance/player/url` | weapi | 否 | 免费歌 320k；VIP 45s 试听；版权受限 `url:null, code:404` |

### 3.1 本次实测（2026-10-21，匿名、无 Cookie、仅 GET）

| 请求 | 结果 |
|---|---|
| `/api/song/lyric?id=186016&lv=-1&tv=-1&rv=-1` | 200；`lrc` 完整；`tlyric` 存在但该曲翻译行为空；`romalrc` 空；无 `yrc` |
| `/api/v1/resource/comments/R_SO_4_186016?limit=2` | 200；`total=1970231`，`comments`、`hotComments`、`more=true` 均在——**匿名读评论仍可用** |
| `/api/search/get?s=晴天&type=1&limit=3` | 200；返回 `result.songs`，含 `album/artists/duration` |
| `/api/v6/playlist/detail?id=3778678&n=3` | 200；`trackCount=200`，`tracks` 3 条 |
| `/api/playlist/detail?id=3778678` | 200；`trackCount=200`，`tracks` 0 条（只有元数据，**别用它取曲目**） |
| `/api/v1/play/record?uid=419672727&type=0` | 200，`code=0`，`allData` 57 条（公开可见） |
| 同上 `uid=1`、`uid=32953014` | `code=-2`，`msg:"无权限访问"`（用户关闭公开/受限） |

**结论**：听歌排行并非「必须登录才能读自己」，而是**按用户隐私设置决定公开性**：公开则匿名可读，关闭则 `-2`。AI 要读「自己的」记录，仍建议登录（`uid` 取自登录态），避免隐私设置与字段缺失。

### 3.2 字段速查

- 歌单：`name`、`description/desc`、`coverImgUrl`、`playCount`、`subscribedCount`、`shareCount`、`commentCount`、`creator{userId,nickname,avatarUrl}`、`tags`、`createTime/updateTime`、`trackCount`、`trackIds[]`、`tracks[]`。
- 歌曲：`name`、`ar[{id,name}]`、`al{id,name,picUrl}`、`dt`（毫秒）、`mv`、`fee`（0 免费 / 1 VIP / 4 购买专辑 / 8 试听）、`privilege{st,pl,dl,maxbr}`、`pop`、`publishTime`。
- 歌词：`lrc.lyric`（LRC）、`tlyric.lyric`（逐句翻译）、`romalrc.lyric`（罗马音）、`yrc.lyric`（逐字，覆盖有限）、`klyric`（卡拉 OK 时间轴，新版）。
- 评论：`comments[]`、`hotComments[]`、`total`、`more`、`beforeTime` 翻页；单条含 `content`、`likedCount`、`time/timeStr`、`user{nickname,userId,avatarUrl}`、`beReplied[]`。
- 听歌记录：`allData[]` / `weekData[]`，每条 `playCount`、`score`、`song{...}`。

---

## 4. 风控与版权

### 4.1 返回码/风控表

| 码/现象 | 含义 | 来源 | 处置 |
|---|---|---|---|
| `301` | 未登录调用需登录接口 | 原版文档、ncm-api-rs 源码 | 检查 Cookie/`MUSIC_U`；勿用缓存旧响应 |
| `-460` / `460 cheating` | 风控判定 IP/环境异常 | 原版文档（国外/云服务器）、issue #1561（song/detail 460） | 换家宽网络、降频、停止重试；**不要伪造 `X-Real-IP`** |
| `-462` | 登录需人机验证 | issue #1806：`verifyType:40`、`st.music.163.com/encrypt-pages` | 转人工扫码验证；勿自动化解验证 |
| `-2 无权限访问` | 目标用户关闭公开/非本人 | 【本次实测】play/record | 登录本人账号；或跳过 |
| `503` / IP 高频 | 频控、IP 被限 | 原版文档、ncm-api-rs `RateLimited` | 指数退避、熔断、换时段 |
| `403 illegal request` | CSRF 缺失/非法请求 | 【社区实测 2025-09】写操作；读接口少见 | 读场景基本不触发；写场景需 `__csrf`（本项目不做） |
| `50000005` | 老搜索端点失效 | 【社区实测 2026-09】`cloudsearch/get/web` | 改用 linuxapi/`weapi/search/get` |
| `404 接口未找到` | eapi 匿名被网关拒绝 | 【社区实测】 | 改 weapi/api；勿在匿名态用 eapi |
| `800/801/802/803` | 二维码状态机 | 原版文档 | 803 才拿 Cookie |

**频率与关联风险**：
- 原版项目默认对相同 URL 做 2 分钟缓存，原因就是「不缓存极易触发网易服务器高频 IP 错误」【公开资料】。
- 社区案例：频繁调 `/login/status` 导致服务器 IP 被封（issue #1190）；云函数/云服务器上扫码轮询可能直接失败。
- 只读**同样会被限**：高频拉歌单/评论会触发 503/460；「只读」不是免死金牌，限的是**请求速率与 IP 信誉**，不是写不写。
- IP/设备关联：网页 weapi 主要看 IP + Cookie + UA；客户端协议才强绑 `deviceId`。家宽 + 单账号 + 低速率，风险显著低于云机房 + 多账号。

### 4.2 版权与 ToS 边界

- 用户协议禁止使用外挂/非官方接口抓取、禁止批量下载与再分发；歌词、评论、封面、音频均受著作权保护。
- **只读自用**（本机、单人、不公开传播、不建公开镜像/不提供在线服务）是风险最低的区间；**一旦把歌词/评论原文对外展示、做成公开 Bot 或 SaaS，就从「自用」跨到「传播/商业化」**，风险量级不同。
- 不做「解灰」：社区有跨平台匹配（酷我/QQ/咪咕）恢复灰色歌曲播放的项目，属规避版权限制，法律风险高，本方案明确排除。
- 音频只做试听/取链演示也应克制；本项目的核心是「文本与元数据」，不是音源分发。

---

## 5. 开源项目与法律风险

| 项目 | 适合「读」 | 适合「播放」 | 状态 | 风险提示 |
|---|---|---|---|---|
| NeteaseCloudMusicApi（原版） | 端点语义参考 | 曾可 | 2024 清库/归档 | 代码仅存于 fork；无官方支持 |
| api-enhanced | **最适合**（读接口最全、MIT） | 可 | 活跃（2026-10） | 仍是非官方逆向；协议漂移需跟进 |
| YesPlayMusic | 一般（UI 层） | 是 | 活跃 | 依赖社区 API；Electron 体积大 |
| Listen1 | 一般 | 是（多平台） | 低维护（2025-06） | 多源聚合，版权争议更大 |
| MusicFree | 一般（插件） | 是 | 活跃 | AGPL-3.0；插件可接任意源，合规自负 |

**法律风险分层**：
1. 低：读公开元数据、自己账号的听歌记录，本机缓存，不传播。
2. 中：把歌词/评论原文长期入库并对外提供检索/展示；使用非官方接口但未牟利。
3. 高：公开在线服务、批量爬取、绕过付费/版权、音源聚合分发、商业化。

【未证实】网易对个人自用项目的具体执法尺度；可确认的是原版作者在 2024 年主动清库并写明版权原因，「并非 GitHub DMCA 下架」这一说法来自社区梳理，未见到官方函件原文。

---

## 6. 推荐架构（只读适配器）

```
┌────────────────────────────── 本地主系统（AI 陪伴） ──────────────────────────────┐
│  Experience 生成器：歌单/歌词/评论/情绪 → 结构化记忆（JSON/SQLite）                 │
└───────────────▲──────────────────────────────────────────────────────────────────┘
                │ 只读 API（内部）
┌───────────────┴──────────────────────────────────────────────────────────────────┐
│                        只读适配器（单进程、单账号）                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ 凭证保险箱  │→│ 请求封装    │→│ 限流/熔断   │→│ 缓存/去重   │→│ 降级链      │  │
│  │ MUSIC_U    │  │ api 明文    │  │ 令牌桶      │  │ SQLite      │  │ api→weapi   │  │
│  │ __csrf     │  │ weapi      │  │ 1–2 rps     │  │ TTL+版本号  │  │ →Playwright │  │
│  │ uid/vipType│  │ （linuxapi）│  │ 夜间配额    │  │ 内容哈希    │  │ （最后手段）│  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
└───────────────▲──────────────────────────────────────────────────────────────────┘
                │ HTTPS（仅出站）
        music.163.com / interface.music.163.com
```

**工程要点**：
1. **登录态**：只支持扫码；Cookie 存本地 0600 文件或系统钥匙串；启动先 `/weapi/nuser/account/get` 探测；失效提示重扫，不自动重试登录接口。
2. **请求封装**：优先明文 `api`（歌词/评论/搜索/榜单），需要完整字段时走 `weapi`；`eapi` 匿名不可用，不纳入 MVP；UA/Referer 固定，不伪造 IP。
3. **限流**：全局令牌桶 1–2 rps，随机 200–800ms 抖动；单日请求预算（如 2,000 次）；命中 460/462/503 立即熔断 30–60 分钟，不换号重试。
4. **缓存**：歌单详情 6h、歌词 7–30d、评论首页 1h、听歌记录 30min、搜索 24h；按 `id + updatedAt` 存版本，避免重复写库；相同 URL 短期去重（原版 2 分钟缓存思路）。
5. **降级**：`api` 失败 → `weapi` → 缓存旧值（标注 stale）→ 最后才 Playwright。浏览器自动化用持久化 profile（已登录），只做「打开页面读 DOM/接口响应」，不做点击发布类操作；它抗协议漂移，但慢、重、ToS 风险最直观，只作兜底。
6. **数据最小化**：只存生成 Experience 所需字段；评论只存摘要与少量引用，不建全文镜像；不存音频。
7. **可观测**：记录每个端点的状态码分布、P95 延迟、460/462 次数；异常自动降频。

### 6.1 三条路对比

| 维度 | 官方 API | 社区 API（自建） | 浏览器自动化 |
|---|---|---|---|
| 获取难度 | 需商务签约，个人无门 | npm/Docker 即起 | 需登录 profile + 选择器维护 |
| 覆盖 | 未知（偏播放授权） | 歌单/歌曲/歌词/评论/记录全覆盖 | 页面有什么有什么 |
| 稳定性 | 合同期内高 | 中（协议年更） | 高（UI 不变即可） |
| 速度/成本 | 低延迟、有配额 | 低延迟、零成本 | 秒级、资源占用高 |
| 账号风险 | 低 | 中（频控/验证） | 中高（自动化特征） |
| 合规 | 高（授权内） | 中（非官方接口） | 中高（明确违反自动化条款） |
| 建议 | 不作为个人方案 | **主力** | 仅兜底 |

### 6.2 给「AI 自己听歌」的产品建议

- **每日 20–40 首**（约 2–3 张歌单），而非全量刷库；其中 60% 来自「每日推荐/我的歌单」，30% 来自榜单/新碟，10% 探索。
- **听什么**：优先「用户最近一周循环 + 情绪标签匹配」的歌；每首取 1 段歌词（副歌）+ 3–5 条高赞评论，而不是全文。
- **Experience 结构**（建议 JSON）：
  ```json
  {
    "date": "2026-10-21",
    "mood": ["平静", "怀旧"],
    "songs": [{"id": 186016, "name": "晴天", "artist": "周杰伦", "reason": "连续三天在夜间播放"}],
    "lyric_moment": {"text": "从前从前有个人爱你很久", "start_ms": 112328},
    "comment_echo": [{"content": "高一听的…", "likes": 823163}],
    "reflection": "今天的关键词是‘下雨天’与‘教室’。"
  }
  ```
- **节奏**：每天固定一次（如 22:30）离线生成，避免实时轮询；生成后写入本地记忆库，供次日对话引用。
- **不要做**：自动点赞/评论/收藏、批量关注、公开分享歌单、把评论原文做成公开语料。

---

## 7. 结论与决策点

**可行性评级**：
- 官方 API：**低**（个人无入口）。
- 社区 API 只读：**高**（技术可行，匿名已能覆盖大半；登录后补齐）。
- 长期稳定运行：**中**（协议与风控持续演进，需维护）。
- 作为对外产品/商业化：**低**（版权与 ToS 风险）。

**推荐路线（最小可跑通，1–2 天）**：
1. 本机 Node/Python 起只读客户端：`GET /api/song/lyric`、`GET /api/v1/resource/comments/...`、`GET /api/search/get`、`GET /api/toplist` 先跑通（零加密）。
2. 实现 weapi（AES 双次 + RSA 无填充）→ `/api/v6/playlist/detail`、`/weapi/user/playlist`、`/api/v1/play/record`。
3. 扫码登录拿 `MUSIC_U`，读「我的歌单 + 每日推荐 + 最近播放」。
4. 落 SQLite 缓存 + 每日 20–40 首的 Experience 生成；Playwright 暂不接入。

**仍需用户确认的 5 个决策点**：
1. **登录方式**：扫码（推荐）还是手动粘贴 Cookie？是否接受账号被要求二次验证的风险？
2. **数据边界**：只读元数据/听歌记录，还是也要歌词全文与评论正文（版权敏感度更高）？
3. **运行位置**：本机家宽（推荐）还是云服务器（460/503 概率高）？
4. **技术依赖**：自研 weapi 客户端（可控）还是直接依赖 api-enhanced（MIT，快但受上游影响）？
5. **产品形态**：纯本地自用、家庭内多设备，还是未来对外分发/商业化？这决定合规等级与是否必须转向官方授权。

---

## 附：主要来源

- 官方入口：`http://music.163.com/open`（实测为「网易开源」）；`https://music.163.com/st/web-sublicense/home`；`http://music.163.com/st/sublicense-doc/open-doc/online-play/api-view`；`music.163.com/st/creatordoc/...`
- 源码：`https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced`（`util/crypto.js`、`module/user_record.js`、`module/playlist_detail.js`、`module/comment_music.js`、`module/lyric.js`）
- GitHub 元数据：`https://api.github.com/repos/Binaryify/NeteaseCloudMusicApi`、`.../api-enhanced`、`.../YesPlayMusic`、`.../MusicFree`、`.../listen1_chrome_extension`（2026-10-21）
- 原版文档镜像：`https://raw.githubusercontent.com/hudawei996/NeteaseCloudMusicApi/master/docs/README.md`
- 加密分析：`https://github.com/metowolf/NeteaseCloudMusicApi/wiki`（weapi 早期分析）
- 风控案例：`https://github.com/Binaryify/NeteaseCloudMusicApi/issues/1190`、`/issues/1561`、`/issues/1806`
- 错误码语义：`https://docs.rs/ncm-api-rs/latest/ncm_api_rs/error/enum.NcmError.html`
- 社区 2026 实测报告：`https://raw.githubusercontent.com/kendu76/dsh-music-player/main/docs/netease-integration-research.md`
- 免责声明：本报告仅用于个人学习与技术研究，不含破解付费/绕过版权的内容；请遵守平台用户协议与著作权法。
