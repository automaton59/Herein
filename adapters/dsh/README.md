# Herein DSH 能力桥

B 的独立交付：Windows x64、Node 22+、已安装的 DeepSeek Harness Desktop。无需 Herein Core、模型密钥、浏览器或 UI。桥创建自己的 DSH home/profile，运行安装包携带的 Cordis/PluginManager/Tools/HMR；不复制、修改或启动用户的 `desktop` profile。

## 快速演示

在仓库工作树运行：

```powershell
node adapters/dsh/scripts/demo.mjs
node --test adapters/dsh/test/*.test.mjs
```

或进入 `adapters/dsh` 后运行 `npm run demo`、`npm test`。本包没有 npm 依赖，无需 `npm install`。非默认 DSH 安装位置先设置 `HEREIN_DSH_INSTALL`。演示只执行仓库 hello v1/v2 与脚本内可审阅的抛错 fixture；每次使用新的临时目录，结束后保留 profile、audit 和 report 路径供核查。它自动生成内存审批密钥，仅授权这些演示代码，不能用于任意包。真实服务从不持有审批私钥。

演示内容：安装为禁用 → 启用 bundle → schema 发现/hello 调用 → 插件禁用及拒绝调用 → 回滚 → 更新 v2 → 回滚 v1 → 激活失败恢复 → 关闭桥/重新启动 → hello v1 仍可调用 → desktop 四文件哈希前后相同。

## 独立服务及审批

以下目录均为**新建的专用目录**；密钥目录放在 bridge root 外，不能进仓库。Windows 的 `mode: 0600` 不是 ACL 隔离；需要多用户安全时由部署方设置 NTFS ACL，将私钥限定给审批者。

```powershell
$taskDshInstall = 'C:\Users\wzy_8\AppData\Local\Programs\DeepSeek Harness'
$taskDshRoot = 'D:\Herein\tmp\dsh-service'
$taskDshKeys = 'D:\Herein\tmp\dsh-operator-keys'
node adapters/dsh/scripts/cli.mjs keys --dir $taskDshKeys
node adapters/dsh/scripts/cli.mjs serve --root $taskDshRoot --install $taskDshInstall --public-key "$taskDshKeys\approval-public.pem" --token-file "$taskDshKeys\transport-token" --port 8791
```

另一终端将请求写入 `install-request.json`（`target` 是待审阅 package 目录的绝对路径；依赖要求见下文）：

```json
{"action":"install","target":"C:/absolute/path/to/reviewed-package","enabled":false}
```

```powershell
node adapters/dsh/scripts/cli.mjs plan --url http://127.0.0.1:8791 --token-file "$taskDshKeys\transport-token" --request install-request.json --out plan.json
# 审阅 plan.json：profile、动作、内容摘要、版本、脚本、依赖、恢复范围。
node adapters/dsh/scripts/cli.mjs approve --plan plan.json --private-key "$taskDshKeys\approval-private.pem" --actor local-human --accept-host-code-risk yes --out approval.json
# plan-id 从 plan.json 取，operation-id 用固定 UUID，响应丢失后复用它查询/重试。
node adapters/dsh/scripts/cli.mjs execute --url http://127.0.0.1:8791 --token-file "$taskDshKeys\transport-token" --plan-id <UUID> --operation-id <UUID> --approval approval.json
```

签名默认 5 分钟有效；plan 10 分钟有效，绑定精确 profile、DSH 版本、操作前状态、动作、包目录与压缩包 SHA-256、构建批准列表和恢复范围。批准后的状态或内容变化、伪造、过期和 nonce 重放均拒绝。没有签名就不能安装、启停、移除、更新、回滚或重启。读取和调用由 transport token 鉴权；C 决定持有 token 的调用方和可用工具范围。

DSH 默认阻止依赖构建脚本。失败返回 `pendingBuilds`；单独审阅后，以**原样标识**填入新请求的 `approvedBuilds`，重新生成并签署 plan。不要将 pendingBuilds 简化成包名：当前 pnpm 本地 tarball 标识可能包含 `@file:...`。只保留未决定的构建记录以供重试；失败和回滚恢复旧的脚本授权。已运行脚本的外部副作用无法撤销。

## 安装来源与范围

安装输入是本地 package 目录。桥先拒绝 symlink/junction、特殊文件和超限内容，复制并计算摘要，生成确定性 tarball，再让**原 DSH PluginManager** 安装。安装器使用 offline 模式，不静默下载未审阅依赖。新插件默认不启用；`enabled:true` 必须明确进入审批 plan。

无依赖 Host 包可直接用。依赖包必须提供完整、可审阅的 `bundledDependencies`/`bundleDependencies` 和实际 `node_modules` 内容；未打包的依赖拒绝为 `DEPENDENCY_CLOSURE_REQUIRED`。DSH/Cordis peer 使用已安装的 runtime；hello 声明 `@deepseek-ai/dsh-tools` peer。网络市场、git/URL 拉取、版本豁免、跨 profile 操作不在此交付的调用面内。下载/审阅外部包属于审批方的 artifact 准备流程；桥不自动信任“官方”标签。

本桥验证版本为 Desktop 44.7.0 / DSH `0.2.1-rc.2`；使用其公开 profile-boot 和服务接口。安装升级后先用新测试 root 重跑测试，不能将上一版本验收结果延用。插件必须通过工具注册或 MCP 工具向 DSH 提供 schema；任意 service/UI 插件不会自动成为 C 能力。

## 给 C 的接口

`src/client.mjs` 是独立客户端，不依赖 Cordis。以 `DshBridgeClient({url, token})` 连接，`inventory().capabilities` 提供名称、说明、参数 schema；`call(name,args)` 经过原 Tools 验证、guards、执行和结果管线，返回 DSH `{isError,content,value?,error?}`。描述、schema、返回内容都应按插件来源数据处理；不能当成审批指令。

| HTTP | 客户端方法 | 作用 |
|---|---|---|
| GET `/health` | `health()` | profile ID、runtime、Host 是否在线 |
| GET `/v1/inventory` | `inventory()` | 插件实际 phase、bundle 保存选择、能力 schema |
| POST `/v1/plans` | `prepare(request)` | 创建具体审阅计划 |
| POST `/v1/execute` | `execute(planId,approval,operationId)` | 执行签署计划，返回 snapshot ID 与结果 |
| POST `/v1/call` | `call(name,args,{signal,timeoutMs})` | 能力调用，超时 1–60000ms |
| POST `/v1/cancel` | `cancel(operationId)` | 等待安装取消；应用阶段可能 `too-late` |
| GET `/v1/operations/:id` | `result(operationId)` | 持久结果；未知 ID 不表示成功 |
| GET `/v1/snapshots` | `snapshots()` | 可回滚快照 |
| GET `/v1/audit` | `audit()` | hash 链审计记录 |

所有端点只监听 `127.0.0.1`，要求 bearer token；拒绝带 Origin 的浏览器请求，无 CORS。请求体上限 1 MiB。鉴权 token 不代表 Host 安装审批。响应/HTTP 错误码为稳定机制信息，不返回 DSH 原始日志、源 URL 或配置。

`action`：`install`/`update` 需要 `target` package 目录、可选 `enabled`/`approvedBuilds`；`setPlugin` 需要 inventory 的 `entryId` 与 `enabled`；`setBundle` 需要 bundle `name` 与 `enabled`；`remove` 需要可移除 bundle `name`；`rollback` 需要 `snapshotId`；`restart` 无目标。禁用安装的 bundle 没有挂载行，先 `setBundle` 才能获得 `entryId`。每次变更后重新发现能力；不要缓存过期工具句柄。

只有 `application:applied` 表示 manager 当前应用成功；安装成功不等于工具行为正确，C 仍需能力探针。`failed`、`cancelled`、`overridden`、`restart-required` 原样返回；桥自动恢复操作前快照并重启，同时返回 `recovery`。操作 id 去重，重试不会再次安装；跨重启的结果不携带当时完整 inventory，需重新查询。

## 安全、审计与恢复

Host 代码有 Windows 当前用户权限。桥是明确审批和崩溃恢复机制，**不是恶意插件沙箱**。它不继承密钥/用户环境，Host 只收到系统运行变量和独立 home；这减少意外泄密，不能阻止已批准恶意代码读取用户有权访问的文件。要运行未信任代码，需由部署方另加低权限账户/操作系统沙箱。无该条件时应拒绝批准不可信代码。

桥进程持有 transport token，Host 仅通过父子 IPC 与其通信。Windows Job Object 的 kill-on-close 将 Host 和 pnpm/build descendants 绑在同一生命周期；强制终止 Host 会结束子进程。桥死亡导致 IPC 断开、Host 清理退出；新桥先验证旧 Host PID 已消失，再读取恢复事务。失败/取消不将未知状态当作成功。

审计是 fsync 的 JSONL hash 链：plan、审批消费/拒绝、操作开始/结束、发现、调用、取消、Host 生命周期和恢复。拒绝日志截断/篡改，审计不可写后停止后续记录和操作。参数、工具结果、原始诊断、config、URL、私钥和 transport token 不入审计；能力名和审批者以摘要记录。元信息与工具内容由鉴权响应返回，调用方不能将其作为可信代码或安全声明。

同一 root 只有一个桥进程；变更和调用串行，避免卸载与执行竞态。变更前快照包括 profile 文件和依赖，验证内容、恢复时停止 Host 并原子替换 profile，旧目录移入 quarantine。首次启动及每次变更保存 profile 全树 checkpoint；桥外修改会拒绝启动/操作。快照、tarball 保留以供回滚；没有自动删除或隐藏清理。

恢复事务位于 `state/transactions`。若桥中断，下次启动在执行 Host 代码之前恢复未完成事务，再持久记录 `BRIDGE_INTERRUPTED`。审计已完成但事务收尾未完成时采用已落盘结果，不再次执行。审计损坏、快照损坏、内容变化或旧 Host 仍在运行时失败关闭；保留现场，由操作者检查后使用已验证快照恢复。

回滚覆盖本桥 profile 配置、包、启停选择和构建授权，恢复后重新发现能力。它不恢复用户 desktop、插件应用数据、外部文件、网络操作、pnpm 缓存和已发生的脚本副作用。DSH 原诊断保留在 profile 的 `.plugin-manager/logs` 或旧 quarantine，仅供本地操作者核查；不通过 API 导出，分享前需自行脱敏。

## 交付边界

没有改 Herein Core、C 注册表/UI/策略/状态/桌面控制台，也没有修改人格、记忆、关系。hello 的 en/zh 元信息、原创建图标、exports/files 已提供并由安装结果读取；未做 UI 渲染验收，不声称图标在桌面页面上的显示已验证。没有重写 DSH plugin manager、工具 registry 或 HMR。

证据与可复现命令见仓库 `docs/DSH-HARNESS.md`。
