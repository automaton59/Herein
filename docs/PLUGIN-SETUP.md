# 插件配置指南（手动配置，不需要 AI）

这份文档面向「clone 下来跑起来」的使用者：所有插件都能在界面里手动配置，不需要让模型帮你改代码，也不需要读源码。照着每节的步骤做即可。

插件全部跑在本机的 Core 进程里，没有云端账号体系。配置存在本机数据库，随应用一起走。

- 开发/打包都适用；打包版同样在「系统 → 插件管理」里操作。
- 遇到问题时先看「状态标签」和「排错」两节。

---

## 0. 三个位置先记住

| 东西 | Windows 路径 | 说明 |
| --- | --- | --- |
| 用户数据目录 | `%APPDATA%\herein\data` | 数据库、素材、token 都在这里 |
| 数据库 | `%APPDATA%\herein\data\app.db` | 插件配置存在 `plugin_registry` 表，**明文** |
| 素材根目录 | `%APPDATA%\herein\data\assets` | 通过 `http://127.0.0.1:<port>/assets/...` 提供给界面 |

- 设置里如果改过数据目录（或出现过「数据目录不可写」提示），以实际生效的目录为准。
- 日志：默认输出到启动它的终端；用 `HEREIN_MAIN_LOG=<文件>` 启动时写入该文件。

## 1. 通用流程

1. 打开左侧「系统」。
2. 找到插件卡片 → 点「安装」。
3. 展开卡片里的「配置」，按提示填。
4. 点「保存配置」。
5. 点「检查」（或等 15 秒轮询）看右侧状态标签。

状态标签含义：

| 标签 | 含义 | 你要做什么 |
| --- | --- | --- |
| 正常 | 插件可用 | 无 |
| 降级 | 能加载，但条件不足（没配、没数据、桥离线） | 看卡片上的黄色说明 |
| 失败 | 配置非法或依赖缺失 | 看红色说明 |
| 未安装 | 只是发现了插件目录 | 点「安装」 |

「配置」里字段下面的小字是这一项的说明；`格式：password` 的字段默认打码，点右侧眼睛可临时显示；带「选择」的字段可以直接弹出文件/目录选择框。

---

## 2. 插件一览

| 插件 | 需要准备什么 | 是否需要联网 | 典型配置 |
| --- | --- | --- | --- |
| 天气 weather | 一个城市名 | 是（Open-Meteo，免费无 key） | `city: 杭州` |
| B 站 bilibili | 无（可选：B 站 Cookie） | 是 | 默认即可；想回评论再加 `bilibili.json` |
| 网易云 netease | 无 | 是 | 默认即可 |
| 表情包 stickers | 自己的 gif/png | 否 | 默认目录即可 |
| QQ Bot qq | QQ 开放平台 AppID/AppSecret | 是 | `qqbot.json` |
| DSH dsh | 本机 DSH + 桥进程 + token | 本机 | `url` + token |

---

## 3. 天气 weather

**依赖**：无。使用 [Open-Meteo](https://open-meteo.com/)，不需要 API key。

**步骤**

1. 安装并启用。
2. 配置里填「城市」，例如 `杭州`；或同时填「纬度 / 经度」。
3. 保存 → 检查，应显示「正常」。

**字段**

| 字段 | 说明 |
| --- | --- |
| 城市 | 中文城市名，和经纬度二选一 |
| 纬度 / 经度 | 城市名解析不到时使用 |
| 显示名 | 可选，覆盖展示名（例如「家」） |
| 缓存分钟 | 默认 15，避免频繁请求 |

**验证**：健康显示「正常」；聊天里问「今天天气怎么样」会带上天气材料。未配置时状态是「降级 / 配置城市或经纬度后可用」。

---

## 4. B 站 bilibili

**依赖**：无。默认不登录：拉公开推荐流、读公开评论区都不需要 Cookie。

**步骤**：安装 → 启用即可。默认每次抓 20 条，想改再动「每次扫描条数」。

**验证**：健康显示「正常」，状态文案是「匿名只读」（首次扫描前可能是「待首次扫描」）。

> 如果你所在网络访问不了 B 站，卡片会变成「降级」并显示失败原因，不影响其他插件。

### 可选：登录（让她能看你账号能看到的内容、发评论）

1. 在浏览器登录 B 站，F12 → Network/存储里复制**整串 Cookie**（至少包含 `SESSDATA` 和 `bili_jct`）。
2. 在用户数据目录（默认 `%APPDATA%\herein\data\`）新建 `bilibili.json`：

   ```json
   { "cookie": "SESSDATA=...; bili_jct=...; DedeUserID=..." }
   ```

   （或拆开写：`{ "sessdata": "...", "biliJct": "...", "dedeUserId": "..." }`）

3. 在插件配置里填「登录凭据文件」路径（留空则默认找上面的位置），保存后健康状态应显示「已登录」。
4. 「允许发评论」是**独立总开关，默认关闭**。打开后 `postComment` / `reply` 动作才会真的发送；每次发送都会写进插件审计。只登录不开这个开关时，她是「已登录但只读」。

**安全提示**：Cookie 等同账号登录态，只放在本地文件里，不要提交进仓库、不要发给别人；想收回权限，改掉 B 站密码即可让 Cookie 失效。发评论是对外动作，B 站有频率与风控限制（如 12061 评论过频），失败会原样报错，不会自动重试。

---

## 5. 网易云 netease

**依赖**：无，匿名只读公开榜单/搜索。

**步骤**：安装 → 启用即可。默认 10 首候选。

**验证**：与 B 站相同。

---

## 6. 表情包 stickers

**依赖**：你自己的图片，不需要联网。

**目录结构**

默认目录是 `%APPDATA%\herein\data\assets\stickers`（首次启动会自动创建）。往里放：

```
%APPDATA%\herein\data\assets\stickers\
  自己\                 ← 一级：套组
    开心\               ← 二级：情绪（中文名会映射到模型情绪）
      摸鱼.gif
      转圈.gif
    搞怪\
      猫猫.gif
```

- 图片格式：`gif / webp / png / jpg`。
- 文件名就是表情名，也会被切成标签参与匹配。
- 目录**空着也没关系**：状态是「降级 / 目录里还没有图片」，不是失败。
- 在仓库里开发时，也可以用 `private/assets/stickers/`（同样结构）；存在内容时优先使用它。

**可选标注**：在套组目录放 `stickers.json`：

```json
[
  { "file": "摸鱼.gif", "name": "摸鱼", "emotion": "playful", "tags": ["摸鱼", "下班"], "use": "想偷懒时" }
]
```

**字段**

| 字段 | 说明 |
| --- | --- |
| 表情目录 | 留空用默认目录；填绝对路径时必须位于素材根目录下（如 `...\data\assets\...`），否则图片无法通过 `/assets/*` 提供 |
| 套组 | 只启用某个子目录 |
| 频率 | rare / normal / often |
| 最少间隔条数 | 最近 N 条内发过就不再发 |
| 按情绪匹配 | 用中文情绪目录名对齐模型情绪 |

**验证**：放图后点「检查」，应显示「1 套 / 3 张」这类结果（不用重启，检查会重新读盘）。

---

## 7. QQ Bot qq

**依赖**：QQ 开放平台的机器人（AppID + AppSecret）。个人主体只能把机器人加到自己当群主/管理员的群。

**步骤**

1. 在 [QQ 开放平台](https://q.qq.com/) 建机器人，拿到 AppID / AppSecret。
2. 在 `%APPDATA%\herein\data\qqbot.json` 写入：

   ```json
   {
     "appId": "1020xxxxx",
     "appSecret": "你的AppSecret"
   }
   ```

   可选字段：`mode`（`websocket` 默认 / `webhook`）、`devTestUsers`（沙箱测试用户 openid 数组）。

3. 系统 → 插件 → QQ Bot → 安装 → 启用。
4. 需要自动回复就勾上「自动回复」（用的是当前人格的模型配置）。

**字段**

| 字段 | 说明 |
| --- | --- |
| 凭据文件 | 留空等于用 `%APPDATA%\herein\data\qqbot.json`；也可以指向别处的 JSON |
| 自动回复 | 开启后被动回复 @ 消息，默认关闭 |

**验证**：健康显示「正常 / listening」。群里 @ 机器人应能收到被动回复。

**常见问题**

- `100016 invalid appid or secret`：AppSecret 复制错了（注意大小写 `l` / `I`）或已重置。
- 收不到群消息：群设置里要添加机器人并开启「接收全量消息」「主动推送消息」。

---

## 8. DeepSeek Harness dsh

**依赖**：本机已安装 DeepSeek Harness Desktop，并且 DSH 桥进程在跑。

插件本身**不会**替你启动桥，也不会安装/卸载 DSH 插件（那需要单独签名的审批）；它只读清单、调工具。

### 8.1 启动桥（一次性）

在仓库里执行（目录自选，密钥目录别放进仓库）：

```powershell
# 1) 生成审批密钥 + transport token
node adapters\dsh\scripts\cli.mjs keys --dir D:\dsh-keys

# 2) 起桥，端口和界面里的「桥地址」一致
node adapters\dsh\scripts\cli.mjs serve --root D:\dsh-service ^
  --install "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness" ^
  --public-key D:\dsh-keys\approval-public.pem ^
  --token-file D:\dsh-keys\transport-token --port 8791
```

看到监听 8791 后，`curl http://127.0.0.1:8791/health` 应返回 JSON。

### 8.2 填 token（三种方式，任选）

1. **放到约定位置**（最省事）：把 `transport-token` 复制成
   `%APPDATA%\herein\data\dsh\transport-token`（目录首次启动会自动建好），配置留空即可。
2. **指向文件**：配置里「Token 文件」填 `D:\dsh-keys\transport-token`（相对路径按用户数据目录解析）。
3. **直接粘贴**：配置里「Transport token」贴 token 内容（本地数据库明文保存）。

环境变量 `HEREIN_DSH_TOKEN` / `HEREIN_DSH_TOKEN_FILE` 只在开发启动时方便，打包版请用上面三种。

### 8.3 字段

| 字段 | 说明 |
| --- | --- |
| 桥地址 | 默认 `http://127.0.0.1:8791`，只允许本机 |
| Transport token | 与桥的 `--token-file` 内容一致 |
| Token 文件 | 不想粘贴时指向文件 |
| 超时 | 默认 10000ms |

**验证**：安装 → 启用 → 检查，显示「正常 / DSH <runtime 版本>」。

排错：

- `缺少 transport token`：三种方式都没命中，检查路径和文件名。
- `连不上 DSH 桥 ...`：桥进程没起、端口被占、或地址写错。
- `token 不对`：token 与控制台不一致，重新复制或重新生成。

更完整的桥协议与审批流程见 [DSH-HARNESS.md](DSH-HARNESS.md)。

---

## 9. 用 HTTP 手动改配置（可选）

界面之外的等价操作（`<token>` 是启动日志里 Core 的 access token）：

```bash
curl -X PATCH http://127.0.0.1:<port>/v1/plugins/weather/config \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"config":{"city":"杭州"}}'
```

常用接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/v1/plugins` | 列表 + 汇总 |
| POST | `/v1/plugins/install` | 安装（body: `{"id":"weather"}`） |
| POST | `/v1/plugins/:id/enable`、`/disable` | 启停 |
| PATCH | `/v1/plugins/:id/config` | 改配置 |
| POST | `/v1/plugins/:id/health` | 立即检查一次（会更新健康状态） |
| POST | `/v1/plugins/:id/invoke` | 调用插件动作 |

---

## 10. 写自己的插件

插件目录放在 `plugins/<id>/`，至少需要 `plugin.json` + entry 文件（`.js/.mjs/.cjs`），打包版对应 `resources/plugins/<id>/`。

`plugin.json` 关键字段：

```json
{
  "id": "demo",
  "name": "示例",
  "version": "0.1.0",
  "kind": "tool",
  "description": "一句话说明这个插件做什么",
  "setup": "使用者需要先做什么（显示在配置面板顶部）",
  "helpUrl": "docs/PLUGIN-SETUP.md#demo",
  "entry": "index.mjs",
  "permissions": [{ "kind": "filesystem", "value": "assets/demo", "reason": "读取素材" }],
  "configSchema": {
    "type": "object",
    "properties": {
      "token": {
        "type": "string",
        "title": "Token",
        "description": "去哪里拿、填什么",
        "placeholder": "粘贴 token",
        "format": "password"
      }
    },
    "required": ["token"],
    "additionalProperties": false
  }
}
```

配置项支持的展示关键字（都会直接渲染进设置面板，不用改前端）：

| 关键字 | 作用 |
| --- | --- |
| `title` / `description` | 字段名 / 字段下方说明 |
| `placeholder` | 输入框占位符 |
| `examples` | 示例值（点击可填入） |
| `format` | `text` / `password`（打码）/ `url`（校验 http(s)）/ `path`（文件选择）/ `directory`（目录选择） |
| `helpUrl` | 该字段的文档链接（http(s) 或仓库相对路径） |
| `default` / `minimum` / `maximum` / `enum` | 默认值与校验，保存前后都会检查 |

插件实例契约与权限、健康检查的细节见 [PLUGINS.md](PLUGINS.md)。

---

## 11. 安全提醒

- 插件配置（含 QQ secret、DSH token）以**明文**存在 `app.db` 的 `plugin_registry` 表里；不要把 `app.db` 或备份发给别人。
- 备份/迁移时如果包含插件配置，等同于包含这些凭据。
- 插件只能访问 manifest `permissions` 里声明的域名（网络请求会被 Core 拦截并记审计）；本地文件读取请限制在素材根目录内。
