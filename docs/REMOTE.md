# 远程访问（Caddy 80 + SSH 反向隧道）

## 架构

```text
手机/外面
  → http://147.224.56.120/herein/*
  → Caddy（80，已有）
  → 127.0.0.1:8787（服务器本地）
  → SSH -R 反向隧道
  → 家里 PC 的 Core 127.0.0.1:8787
```

没有新开端口，没有 relay 服务，不碰酒馆。

## 启动

```powershell
npm run tunnel
```

脚本会：

1. 确保 `dist-electron/core/server.js` 已编译；
2. 读/生成 `private/credentials/core-token.txt`；
3. 启动 Core（带 Bearer token；默认开 `HEREIN_PROACTIVE_SHARE=1`，90 分钟一次低频分享）；
4. 建 SSH 反向隧道；
5. Ctrl+C 停止隧道（脚本启动的 Core 也会停）。

手机 APP 填：

```text
http://147.224.56.120/herein
```

Token 填 `core-token.txt` 的内容。

## 验证

```powershell
# 不带 token → 401
curl.exe --noproxy "*" http://147.224.56.120/herein/health

# 带 token → 200
curl.exe --noproxy "*" -H "Authorization: Bearer <token>" http://147.224.56.120/herein/health
```

酒馆不受影响：

```powershell
curl.exe --noproxy "*" -o NUL -w "%{http_code}" http://147.224.56.120:8000/   # 401
```

## Caddy

已加：

```caddy
http://147.224.56.120 {
	handle_path /herein/* {
		reverse_proxy 127.0.0.1:8787
	}
	respond 404
}
```

备份：

```text
/etc/caddy/Caddyfile.bak-20261021-154729
```

回退：

```bash
sudo cp /etc/caddy/Caddyfile.bak-20261021-154729 /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 隧道状态

Core 可以自查公网入口。启动前设置：

```powershell
$env:HEREIN_RELAY_URL = "http://147.224.56.120/herein"
$env:HEREIN_RELAY_TOKEN = "<core-token>"
```

`/v1/status` 的 `relay` 组件会请求 `<relay>/health`（2 秒超时），桌面/Android 状态里显示“隧道 正常/不可用/未配置”。未设置 URL 时是 `unknown`，不影响本地使用。

## 安全

- Core 绑定 `127.0.0.1`，只通过 SSH 隧道暴露给服务器本机。
- Core 要求 `Authorization: Bearer <token>`；没 token 是 401。
- 公网这一段是明文 HTTP；token 和内容在链路上可见。个人自用可接受，后续可换 Tailscale 或 TLS。
- 不要把 `core-token.txt` 发聊天/截图。
- 隧道没开时 `/herein/*` 返回 502，这是正常的；`npm run tunnel` 后恢复。
