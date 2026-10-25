# DeepSeek Harness

把本机 DSH 桥接进此间：列出 Harness 里的工具，并调用它们。

桥是独立进程，由你自己启动（见 `adapters/dsh/README.md`）。这个插件只读清单、调工具，**不能**安装或卸载 DSH 插件——那需要单独签名的审批，故意不从这里暴露。

## 配置

| 字段 | 说明 |
|---|---|
| `url` | 桥地址，只允许 `127.0.0.1` / `localhost`。留空读 `HEREIN_DSH_URL`，再不行用 `http://127.0.0.1:8791` |
| `token` | transport token，可直接粘贴 |
| `tokenFile` | 或指向桥生成的 `transport-token` 文件；相对路径按用户数据目录解析 |
| `timeoutMs` | 单次请求超时，默认 10000 |

token 解析顺序：`token` → `tokenFile` → `HEREIN_DSH_TOKEN` → `HEREIN_DSH_TOKEN_FILE` → `<dataDir>/dsh/transport-token`。

## 动作

| action | 说明 |
|---|---|
| `health` | 桥的协议版本与 host 状态 |
| `inventory` | 插件、bundle、可用工具清单 |
| `call` | `{ "name": "工具名", "arguments": { ... } }` |

## 排错

| 提示 | 原因 |
|---|---|
| 连不上 DSH 桥 | 桥没起、端口被占、地址写错 |
| token 不对 | token 复制不全，或桥端重新生成过 |
| 缺少 transport token | 五条来源都没拿到，按上表逐个检查 |
