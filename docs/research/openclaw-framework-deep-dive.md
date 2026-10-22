# OpenClaw 的框架与逻辑 —— 技术调研

> 调研时间：**2026-10-21**（Asia/Shanghai）。下文所有在线资料、GitHub API 数据、发布信息的访问日期均为 2026-10-21。
> 无法从一手材料确认的内容，统一标注「未证实」。

---

## 0. 结论先行（TL;DR）

1. **当前最主流的 "OpenClaw" 指代**：一个自托管（self-hosted）的开源 **个人 AI 助理 / 智能体网关**，TypeScript 编写、MIT 协议、仓库 `github.com/openclaw/openclaw`，截至 2026-10-21 约 **39.26 万 star**。它**不是**游戏项目（游戏项目是另一个同名仓库，见 §1）。
2. **它的"框架"本质**是一句话：**一个常驻 Gateway 守护进程 + 一组通道插件 + 会话/队列/写入栅栏 + 内嵌 agent loop + 文件式分层记忆 + 统一调度器**。所有客户端（CLI、Web 控制台、macOS/iOS/Android 节点）都通过**同一条 WebSocket 协议**接入这个 Gateway。
3. **它的"逻辑"本质**是一条固定的串行流水线：`消息进入 → 路由算出 sessionKey → 串行化 turn（占位/排队）→ 组装系统提示（基础提示 + 技能快照 + bootstrap 上下文 + 记忆注入）→ 调模型 → 工具循环（schema 校验 → 执行 → 事件流）→ 回复整形（NO_REPLY 静默/去重/送达确认）→ 按原路分发回来源通道`。旁路有四条：**compaction（压缩）**、**memory flush（压缩前记忆落盘）**、**dreaming（离线记忆整合）**、**heartbeat/cron（主动唤醒）**。
4. 最值得借鉴的三个设计思想：**「可信网关 / 不可信执行 / 策略即代码」的信任边界**、**记忆的写入期 provenance（来源）闸门**（而不是检索期检测）、**把"主动行为"编译成调度（cron + standing intent）而不是塞进提示词**。
5. 最该避开的三个坑：**概念与文档体量已远超个人项目可维护范围**、**单写者 SQLite + 目录锁导致无法水平扩展**、**工具默认在宿主机执行（沙箱需显式开启）**。

---

## 1. 名称歧义确认：到底指哪个 OpenClaw

| # | 指代 | 关键证据 | 与"AI Agent / 个人助理"相关性 | 判断 |
|---|------|----------|------------------------------|------|
| 1 | **AI 助理 / Agent 网关**（本文主题） | `api.github.com/repos/openclaw/openclaw`：TypeScript、MIT、`stargazers_count=392645`、`created_at=2025-11-24`、homepage `https://openclaw.ai`、topics 含 `ai, assistant, personal, own-your-data` | 完全对应 | **≈99% 是用户所指** |
| 2 | **《Captain Claw》(1997) 重制版游戏** | `api.github.com/repos/pjasicek/OpenClaw`：`Reimplementation of Captain Claw (1997) platformer`、C++、GPL-3.0、`stargazers_count=517`、创建于 2017-03-08、最后一次 push 2022-10-24；FreeBSD ports 亦有 `games/openclaw`；另有 PSVita 移植 `theheroGAC/OpenClaw-Vita` | 无关 | 同名历史项目，仅作歧义说明 |
| 3 | 生态衍生/仿冒仓库 | 如 `lpding888/openclaw`（README 与官方几乎同文）、`Haderach-Ram/openclaw-radar`（生态雷达）、`jal-co/openclaw-webclaw`（插件） | 属于 #1 的 fork/插件 | 说明 #1 已有生态外溢 |

**歧义消解依据**：搜索 `OpenClaw AI agent framework` / `OpenClaw 开源 AI 助手 框架` 返回的前 8 条结果**全部**指向 #1（官方文档站 `docs.openclaw.ai`、`openclaws.io` 中文镜像、GitHub 仓库、中文媒体报道"养龙虾"）；而 #1 的体量（39 万 star）是 #2（517 star）的约 760 倍。中文语境里"小龙虾 / 养龙虾 / 龙虾助手"是 #1 的社群昵称（其吉祥物是一只太空龙虾 Molty 🦞）。

> 若用户实际想问的是游戏 #2，则本文 §3–§10 不适用；此时最接近"AI Agent 框架"需求的替代参考见 §9 的对比表。

---

## 2. 项目定位与基本信息

| 项目 | 内容 |
|------|------|
| 一句话定位 | "The AI that really does things. Any OS. Any Platform. The lobster way. 🦞" —— 跑在自己硬件上、在你已有的聊天软件里出现的 AI 助理 |
| 更准确的技术定位 | **self-hosted gateway**：把 Discord/Slack/Telegram/WhatsApp/iMessage… 等聊天通道，接到"可换的模型 + 可换的 agent harness"上 |
| 作者 / 组织 | 最初由 **Peter Steinberger（@steipete）** 为 AI 助理 **Molty** 而做，社区共同开发；现由 **OpenClaw Foundation**（独立 501(c)(3) 非营利）托管并签署发布 |
| 开源协议 | **MIT**（`license.spdx_id = MIT`） |
| 仓库 | https://github.com/openclaw/openclaw （org: `openclaw`） |
| Star / Fork / Open Issues | **392,645** / **82,541** / **9,632**（2026-10-21，GitHub API） |
| Watchers / Subscribers | 392,645（watchers 与 star 同值）/ 1,703 |
| 主语言 / 构建 | **TypeScript**；pnpm workspace 单仓（`apps/`、`packages/`、`src/`、`ui/`、`skills/`、`tools/`、`docs/`、`qa/`、`test/`、`security/`）；`tsdown` 打包；仓库体积约 **9.97 GB**（`size: 9972419` KB） |
| 创建时间 | 2025-11-24 |
| 最近 push | 2026-10-21（调研当日仍在活跃提交） |
| 最新版本 | **v2026.10.5**，发布于 **2026-10-18**（npm `openclaw@2026.10.5`，同版发布 macOS arm64 dmg / Linux AppImage / deb） |
| 版本号风格 | **CalVer**（`YYYY.M.micro`），发布极频繁；`v2026.8.1` 被官方文档标注为 **"AKA OpenClaw 2.0"**（该版本移除了内置 OpenProse 插件与 `/prose` 命令） |
| 运行时要求 | Node **26 推荐**，或 Node 24.16+ / 26.1+ |
| 官网 / 文档 | https://openclaw.ai ／ https://docs.openclaw.ai （另有社区镜像 `openclaws.io`、`clawdocs.org`） |
| 社区 | Discord `discord.gg/clawd`、Reddit `r/openclaw`、X `@openclaw`；插件/技能市场 **ClawHub**（`clawhub.ai`） |
| 治理与商业化 | 无付费版、无托管服务、无代币；默认仅"每日版本检查"联网，匿名特性统计需 opt-in，`update.checkOnStart: false` 可全关；OpenAI 是捐赠方而非所有者 |

**活跃度判断**：创建不到 12 个月即达 39 万 star、8.2 万 fork、9,632 个未关闭 issue，且当日仍有 push —— 属于"超高热度 + 超高 issue 压力"的项目。这种比例通常意味着：**迭代极快、API/SDK 稳定性弱、大量 issue 长期未收敛**（9,632 open issues 相对 39 万 star 是典型"过大社区 vs 有限维护带宽"形态）。

---

## 3. 整体架构

### 3.1 文字版架构图

```
                        ┌────────────────────────── 外部世界 ──────────────────────────┐
                        │ Telegram  Discord  Slack  WhatsApp  iMessage  Signal  Matrix │
                        │ Teams  GoogleChat  Feishu  QQ  WeChat(ext)  LINE  SMS  X  …   │
                        └───────────────────────────┬──────────────────────────────────┘
                                                    │ webhook / bot API / QR session / poll
┌───────────────────────────────────────────────────▼──────────────────────────────────────────────┐
│  Gateway 守护进程（唯一，单主机一个；默认 127.0.0.1:18789，WS + HTTP 同端口）                    │
│                                                                                                  │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────────┐   ┌──────────────┐  │
│  │ Channel     │   │ Router       │   │ Session       │   │ Agent Runtime  │   │ Scheduler    │  │
│  │ Plugins     │──▶│ (bindings,   │──▶│ Controller    │──▶│ (embedded loop)│   │ Gateway      │  │
│  │ (adapter +  │   │  9 级优先级) │   │ 队列/占位/    │   │ + 可换 harness │   │ Scheduler    │  │
│  │  message    │   │              │   │ writer claim  │   │ (Claude/Codex/ │   │ cron/heartbeat│ │
│  │  adapter)   │   │              │   │               │   │  local…)       │   └──────┬───────┘  │
│  └─────────────┘   └──────────────┘   └───────────────┘   └───────┬────────┘          │          │
│         │                                                          │                   │          │
│  ┌──────▼──────────┐  ┌───────────────┐  ┌────────────────┐  ┌─────▼─────────┐  ┌──────▼───────┐  │
│  │ Tool System     │  │ Memory Core   │  │ Storage        │  │ Context Engine│  │ Hooks        │  │
│  │ (policy before  │  │ (files+SQLite │  │ (per-agent     │  │ (compaction,  │  │ (internal +  │  │
│  │  model call)    │  │  index)       │  │  SQLite, WAL)  │  │  recall)      │  │  plugin)     │  │
│  └─────────────────┘  └───────────────┘  └────────────────┘  └───────────────┘  └──────────────┘  │
│                                                                                                  │
│  WS 协议：{type:"req"| "res" | "event"}，TypeBox→JSON Schema→Swift 模型；事件 agent/chat/         │
│           presence/health/heartbeat/cron                                                         │
└───────────────┬──────────────────────────────┬───────────────────────────────┬───────────────────┘
                │ WS (role: operator)          │ WS (role: node)               │ HTTP
        ┌───────▼────────┐            ┌────────▼─────────┐          ┌──────────▼──────────┐
        │ CLI / TUI      │            │ macOS/iOS/Android│          │ Control UI (Web)    │
        │ macOS 菜单栏 app│            │ /headless 节点    │          │ /__openclaw__/canvas│
        │                │            │ camera/screen/   │          │ /__openclaw__/a2ui  │
        │                │            │ location/canvas  │          │                     │
        └────────────────┘            └──────────────────┘          └─────────────────────┘
```

三个"平面"：

- **接入面**：通道插件（每种 IM 一个插件，负责鉴权、收消息、发消息、媒体、回执）。
- **控制面**：Gateway 的 WS API + 会话存储 + 路由 + 调度 + 策略（谁能给谁发消息、模型能不能看到某个工具）。
- **执行面**：Agent Runtime（模型 + 工具循环）+ 沙箱/子进程 + 节点设备能力。

### 3.2 核心模块表

| 模块 | 代码/文档位置（可核对的命名） | 职责 | 关键设计点 |
|------|------------------------------|------|-----------|
| **Gateway（守护进程）** | `src/daemon/`、`src/runtime.ts`、`openclaw gateway` | 维护所有通道连接、暴露 typed WS API、校验入站帧（JSON Schema）、发事件 | 单主机**只有一个** Gateway；"唯一持有 WhatsApp/Baileys 会话的地方" |
| **Channel Plugins** | `src/channels/`、`docs/plugins/sdk-channel-plugins/` | 每平台一个插件；实现 inbound monitor + `message` adapter | 用 `defineChannelMessageAdapter` 声明能力；发送返回 `MessageReceipt` |
| **Router** | `src/routing/`、`docs/channels/channel-routing.md` | 按 9 级优先级把入站消息映射到 **agentId**（决定 workspace + 会话库） | 精确 peer → 父 peer → 通配 → guild+roles → guild → team → account → channel → fallback owner |
| **Session Controller** | `src/sessions/`、`src/state/`、`docs/concepts/session-controller.md` | 按物理会话身份串行化 turn；排队模式；写入栅栏 | `activeWriterRunId` 乐观并发栅栏；每 agent 一条 SQLite 写队列；状态目录锁 |
| **Agent Runtime** | `src/agents/`、`src/context-engine/` | 组装 prompt、调模型、跑工具循环、流式输出、超时与重试 | 可替换 harness（内置 OpenClaw、Codex app-server、Copilot SDK、Muse、CLI backend） |
| **Tool System** | `src/agents`(tools)、`docs/tools/`、`docs/gateway/config-tools.md` | 工具 schema、策略裁剪、执行、审批、结果清洗 | **策略在模型调用前生效**：被裁掉的工具模型根本看不到 schema |
| **Memory Core** | `src/skills`? 否 → 记忆由插件 `memory-core` 提供；`docs/concepts/memory-architecture.md` | 分层记忆：文件 + 一个 SQLite 索引 + dreaming 整合 | 写入期 provenance；分层信任；两档召回 |
| **Scheduler** | `src/cron/`、`docs/gateway/heartbeat.md` | **一个** `GatewayScheduler` 统一驱动 cron 与维护任务 | 单主机定时器；`beginClose()/stop()` 生命周期；睡醒后合并错过的 tick |
| **Nodes** | `src/nodes`（文档 `docs/nodes/`）、`role: node` | 设备能力：`camera.*`、`screen.record`、`location.get`、`canvas.*` | 设备级配对（device identity + 挑战签名 v3） |
| **Control UI / CLI / TUI** | `ui/`、`src/cli/`、`src/tui/` | 控制台、命令行、终端界面 | 三者都是 WS 客户端，无独立后端 |
| **Plugin SDK / ClawHub** | `packages/`、`docs/plugins/`、`clawhub.ai` | 插件可加工具、通道、provider、语音、hook、技能 | 插件是"能力扩展的唯一正路" |
| **Storage** | `src/storage/`、`src/state/` | SQLite（WAL）、凭据、锁、备份 | 单写者；`<state-dir>.update-captures/` 保留升级前快照 |

---

## 4. 运行逻辑：一条用户消息的完整链路

### 4.1 分阶段说明

| 阶段 | 发生了什么 | 一手依据 |
|------|-----------|---------|
| **① 接入** | 通道插件收到平台事件（webhook/bot 长连接/QR 会话），做鉴权与 allowlist/配对检查，规范化为内部入站消息（含 `ReplyToId/Body/Sender`、媒体、thread/topic 信息） | `docs/channels/channel-routing.md`、`docs/channels/index.md` |
| **② 路由** | Router 按 9 级优先级选出 **agentId**；再由 `session.dmScope` / `session.groupScope` / binding 覆盖算出 **sessionKey**（如 `agent:main:telegram:group:-100…:topic:42`） | 同上 |
| **③ 会话与排队** | Session Controller 以物理会话身份**串行化**：同一会话的 turn 有序；跨会话可并发。通道选择队列模式 `steer / followup / collect / interrupt`。入队后先做**容量准入**（global capacity） | `docs/concepts/agent-loop.md`、`docs/concepts/queue` |
| **④ 占位与栅栏** | 准入后记录 `activeWriterRunId`；之后每次 transcript 追加/重写都要带 `expectedWriterRunId`，提交事务内校验，**被取代的 run 无法写入过期数据** | 同上（"Queueing and concurrency"） |
| **⑤ 准备会话** | 解析/创建 workspace（沙箱运行可重定向到 sandbox workspace root）；加载**技能快照**并注入 env 与 prompt；准备 embedded settings（global/plugin/project，每会话一次，配置或 workspace 变更才刷新）；解析 bootstrap/context 文件 | 同上（"Session and workspace preparation"） |
| **⑥ 组装 prompt** | `基础 prompt + 技能 prompt + bootstrap 上下文 + 每轮 override`；再叠加记忆注入（bootstrap 注入 `MEMORY.md`/`USER.md`、ranked search 命中、trigger 注入 ≤3 条、standing intent 命中）；执行模型相关的 token 上限与 compaction 预留 | `docs/concepts/system-prompt`、`docs/concepts/memory-architecture.md` |
| **⑦ 调模型** | `runEmbeddedAgent`：解析 model + auth profile，订阅 runtime 事件，流式转发 assistant/tool delta，对**当前 attempt** 施加超时（超时 abort 该 attempt，fallback 用新预算） | `docs/concepts/agent-loop.md` |
| **⑧ 工具循环** | 工具参数先按 schema 校验（含 `anyOf/oneOf` 参数恢复，保留原值类型），执行后发 `tool` 流事件；结果按大小/图片做清洗；消息类工具发送会被跟踪以**抑制重复的助手确认** | 同上（"Tool execution"） |
| **⑨ 结束判定** | 对当前来源会话的**已确认**最终发送（reply/thread reply/poll，或带 `final: true` 的 reaction）会**终止循环**；仅进度（`final:false`）、别处 reaction、未确认发送都不算 | 同上 |
| **⑩ 回复整形** | 由 assistant 文本（+可选推理）+ 内联工具摘要 + 错误文本组成；`NO_REPLY`（整条 trim 后大写等于）表示静默并**丢弃本轮未发送内容**；空最终不算静默，会记失败并给一条系统提示 | 同上（"Reply shaping"） |
| **⑪ 分发** | 按**消息来源**回发（模型不选通道，路由是固定规则）；同一条 outbound 可 `sessionKey` 镜像到别的 transcript，但不改投递路由 | `docs/channels/channel-routing.md` |
| **⑫ 旁路：压缩与记忆** | 接近上限时 auto-compaction 发 `compaction` 事件并可能重试；压缩前有一轮 **memory flush** 把未写内容落到当天日记，避免被摘要吃掉；会话结束后 transcript 进入可 ingest 的"情景记忆" | `docs/concepts/agent-loop.md`、`docs/concepts/memory-architecture.md` |

### 4.2 消息流伪代码（按官方文档语义重写）

```ts
// ── 入口 A：通道消息 ────────────────────────────────────────────────
async function onChannelInbound(channel, accountId, raw) {
  const msg = channel.normalize(raw);            // 统一消息模型（含 ReplyTo*、媒体、thread）
  if (!channel.isAllowed(msg)) return channel.drop(msg);      // allowlist / 配对 / 群 mention 门

  const agentId  = router.resolveAgent({channel, accountId, peer: msg.peer});   // 9 级优先级
  const sessionKey = router.resolveSessionKey({agentId, channel, msg, dmScope, groupScope});
  const mode = channel.queueMode(sessionKey);    // steer | followup | collect | interrupt

  await sessionController.enqueue(sessionKey, {msg, mode});    // 同会话串行，跨会话并发
}

// ── 入口 B：控制面 RPC（CLI/UI/agent.wait）──────────────────────────
rpc("agent", async (params) => {
  const {sessionKey} = resolveSession(params);                 // sessionKey / sessionId
  persistSessionMeta(sessionKey);
  const runId = newRunId();
  executor.spawn(() => runTurn({sessionKey, runId, input: params.input}));
  return {runId, acceptedAt: now()};                            // 立即返回 accepted
});

// ── 一个 turn ──────────────────────────────────────────────────────
async function runTurn({sessionKey, runId, input}) {
  const lease = await sessionController.admit(sessionKey);       // 占位（turn reservation）
  await capacity.acquireGlobal();                               // 全局并发准入
  const claim = await transcripts.claimWriter(sessionKey, runId); // activeWriterRunId

  const ws        = await workspace.resolve(sessionKey);         // 沙箱可重定向
  const skills    = await skills.snapshot(ws);                   // 技能快照
  const bootstrap = await bootstrapFiles.resolve(ws);            // AGENTS.md / SOUL.md / …
  const memory    = await memoryCore.recall({sessionKey, input}); // 见 §6：两档召回

  const {model, auth} = await resolveModel(sessionKey, input);   // 可被 before_model_resolve 覆盖

  const prompt = buildSystemPrompt({                               // 每轮重建（预算受控）
    base: BASE_PROMPT, skills, bootstrap,
    prependContext: memory.prepend, systemPrompt: memory.system,
    appendSystemContext: memory.append,
  });

  const tools = toolPolicy.effective({                            // ★ 模型调用前裁剪
    agentId, channel, provider: model.provider, sandbox: ws.sandbox, pluginTools,
  });

  let messages = await transcripts.load(sessionKey);
  messages.push(userMessage(input));

  for (let step = 0; step < MAX_STEPS; step++) {
    const attempt = startAttemptBudget(agents.defaults.timeoutSeconds); // 默认 48h
    const resp = await model.stream({prompt, messages, tools, signal: attempt.signal,
      onDelta: d => emit("assistant", d),                        // stream: "assistant"
      idleTimeout: model.cloud ? 120_000 : 300_000,
    });

    if (resp.toolCalls.length === 0) {                            // 没有工具 → 收敛
      messages.push(resp.message);
      break;
    }
    for (const call of resp.toolCalls) {
      const tool = tools.find(call.name);                          // 不存在 → 直接报错给模型
      validateArgs(tool.schema, call.args);                        // schema + anyOf/oneOf 恢复
      if (hook("before_tool_call", call).block) {                  // 插件可拦截（terminal）
        messages.push(toolResult(call, "blocked")); continue;
      }
      emit("tool", {phase: "start", call});
      const result = await tool.run(call.args, {sandbox: ws.sandbox}); // 宿主机或沙箱
      emit("tool", {phase: "end", call, result: sanitize(result)});
      messages.push(toolResult(call, result));                     // 可被 tool_result_persist 改写
      if (result.finalSendConfirmed && call.target === sourceConversation) {
        return finalize({reason: "delivered"});                   // ★ 确认送达即结束循环
      }
    }
  }

  const reply = shapeReply(messages, {allowNoReply: true});
  if (reply.kind === "silent") return finalize({reason: "NO_REPLY"});  // 丢弃未发送内容
  if (reply.empty && reply.required) return finalize({reason: "failed_empty"});

  await deliver(reply, {channel: msg.channel, peer: msg.peer, thread: msg.thread}); // 回原路
  await transcripts.commit(claim, messages);                      // 带 writer 栅栏提交
  await memoryCore.flush(sessionKey, messages);                   // 压缩前/会话末落盘
  await lease.release();
}
```

### 4.3 关键不变量与超时（官方明示）

| 不变量 / 超时 | 值 | 含义 |
|--------------|-----|------|
| 单主机 Gateway 数 | 1 | 同一个 Baileys 会话只能有一个持有者；状态目录锁阻止第二个 Gateway 或 `openclaw agent --local` 并发 |
| 握手 | 强制 | 第一帧必须是 `connect`；非 JSON / 非 connect 直接硬关闭 |
| 事件 | 不重放 | 客户端必须自己刷新补齐 |
| 副作用方法 | 必须幂等键 | `send`、`agent` 需要 idempotency key，服务端有短期去重缓存 |
| `agent.wait` | 默认 30s | 只等不杀；超时返回 `{runId, status:"timeout"}` |
| Agent runtime 每 attempt | 默认 172800s（48h） | 每个 fallback 拿新预算；`0` = 无限 |
| 模型空闲超时 | 云端 120s / 自托管 300s | 无 chunk 且无 SSE keepalive 即 abort |
| 重试宽限 | 15s | 可重试错误保留 15s 宽限等待 fallback |
| 清理预算 | 10s | transport lease 清理 |

### 4.4 Hook 时序（扩展点全景）

`before_model_resolve` → 会话加载 → `before_prompt_build` → `before_agent_reply` → 模型 →（每工具）`before_tool_call` / `after_tool_call` / `tool_result_persist` → `agent_end`；旁路 `before_compaction` / `after_compaction`；出入站 `message_received` / `message_sending` / `message_sent`；生命周期 `session_start/end`、`gateway_start/stop`。

---

## 5. 工具 / 技能 / 插件系统

### 5.1 三者的分工（官方定义）

| 概念 | 是什么 | 何时用 |
|------|--------|--------|
| **Tool（工具）** | 一个**带类型签名的可调用函数**，以结构化 function definition 发给模型 | 智能体需要"动手"：跑命令、改文件、发消息、调 provider |
| **Skill（技能）** | 一个 `SKILL.md` **指令包**，被加载进 prompt | 工具有了，但需要可复用的流程/检查清单/约束 |
| **Plugin（插件）** | 运行时能力包：工具 + 通道 + provider + 语音 + 搜索 + hook + 打包技能 | 需要代码、凭据、生命周期、可安装分发 |

- 技能位置：workspace / 共享技能目录 / OpenClaw 托管技能根 / 插件包内。分发走 **ClawHub**。
- 插件工具注册：`api.registerTool(...)` + manifest 的 `contracts.tools`。

### 5.2 内置工具面（代表性，非全量）

| 类别 | 代表工具 | 说明 |
|------|---------|------|
| 运行时 | `exec`、`process`、`terminal`、`code_execution` | 命令执行、后台进程、共享操作员终端、provider 侧 Python |
| 文件 | `read`、`write`、`edit`、`apply_patch` | 工作区文件读写与补丁 |
| 人类输入 | `ask_user`、`secrets` | 结构化提问；不暴露明文地取凭据 |
| 网络 | `web_search`、`x_search`、`web_fetch` | 搜索与可读正文抓取 |
| 浏览器 | `browser` | OpenClaw 托管的浏览器会话（profile、远程 CDP、隔离） |
| 消息 | `message` | 发送/回复/媒体/reaction；schema 会按当前通道收窄 |
| 会话与智能体 | `sessions_*`、`subagents`、`agents_wait`、`agent_send`、`goal`、`steer`、`swarm` | 会话检索、子智能体、目标、插话、并发编排 |
| 自动化 | `cron`、`heartbeat_respond` | 排程与心跳应答 |
| 网关与节点 | `gateway`、`nodes` | 网关状态、已配对设备 |
| 媒体 | `view_image`、`image_generate`、`music_generate`、`video_generate`、`tts` | 多模态 |
| 大目录工具 | `tool_search`、`tool_describe`、`dispatch_action`、`exec`+`wait`（Code Mode） | 不把全部 schema 塞进 prompt |

> 注意：`image` 已被 `view_image` 取代，旧配置需 `openclaw doctor --fix` 迁移。

### 5.3 权限与沙箱（三层，官方明确区分）

1. **工具策略（Tool Policy）**：profile + `tools.allow` / `tools.deny` + provider 限制 + 通道权限 + 插件可用性 → **在模型调用前**决定模型能看到哪些 schema。
2. **沙箱（Sandbox）**：默认**关闭**；开启后可用 Docker / Podman / SSH / OpenShell 后端；沙箱运行可把 workspace 重定向到 sandbox root。
3. **提权执行（Elevated）**：`/elevated` 或 exec approvals，在沙箱外受控执行。

外加**审批门**：`exec approvals`（宿主机命令审批）、`ask_user`、MCP 的 Codex 审批（`approve|prompt|auto`）、Slack 原生审批按钮。

> 官方明确警告：**未配置沙箱时，工具在宿主机上运行**；接入他人或暴露公网前必须先读 security / exposure-runbook / sandboxing 三篇。

### 5.4 MCP 支持

- 配置在 `mcp.servers`，三种传输：**stdio**、**SSE**、**Streamable HTTP**。
- 支持 `toolFilter.include/exclude`、`connectionTimeoutMs`、`requestTimeoutMs`、`auth: "oauth" | "enterprise"`、headers/env 走 secret 机制。
- 命令行：`openclaw mcp add / doctor <name> --probe / status / probe / login / reload`；Control UI 里 Settings → MCP 或聊天框 `+ → Connectors`（可"仅本会话"或"全局"）。
- **MCP 工具走同一套 tool-profile / tool-policy**——"连接服务器不会绕过你的策略"。
- 反向也支持：`openclaw mcp serve` 把 OpenClaw 的通道会话暴露给别的 MCP 客户端。
- 失败退避：30s 起、指数翻倍至 10min；恢复在后台进行，**turn 不会等重试**；保留上次成功列出的工具 schema（但不授予执行权）。

---

## 6. 记忆与上下文

### 6.1 五层记忆模型（Memory Core 插件，默认）

| 层 | 载体 | 谁写 | 何时进上下文 |
|----|------|------|-------------|
| **指令** | `AGENTS.md` 等工作区指令文件 | **仅人类** | 会话开始，始终注入 |
| **精编核心** | `MEMORY.md`、`USER.md` | **dreaming 整合**；或用户直接要求 | 会话开始（provenance 合格时，受预算约束）；每轮刷新 |
| **情景** | `memory/YYYY-MM-DD.md` 日记 + 会话 transcript | 智能体工作期间、memory flush、transcript 采集 | **按召回**，不在会话开始注入 |
| **前瞻** | standing intents（SQLite）+ cron 任务 | `intent` 工具、排程 | **仅触发时**注入 |
| **复盘** | `DREAMS.md`、dreaming 报告 | dreaming 各阶段 | **从不**注入，仅供人读 |

设计原则（官方五条）：**无隐藏状态**（模型只能记住写进文件的东西，可用文本编辑器审阅/修改）、**写比读难**（长程评测显示"写了什么"比"怎么索引"更决定成败，引 LongMemEval arXiv:2410.10813）、**写路径即安全边界**、**固定规则 + 规则内的模型判断**、**记忆失败绝不阻塞回复**（每步都有超时或兜底）。

### 6.2 写入路径（唯一主写者：dreaming）

```
交互会话 ──(笔记 / flush)──┐
会话结束 ──(transcript 采集)─┼──▶ 情景层 + SQLite 索引（带 provenance）
压缩前   ──(事实写入日记)──┘            │
                                        ▼
                        dreaming: light/REM（去重、候选、主题反思）
                                        │ 闸门①：规则打分（检索相关性、召回频次、
                                        │        查询多样性、新近度、多日复现、概念丰富度）
                                        │        ★ untrusted / system 在进 prompt 前结构性排除
                                        ▼
                        闸门②：整合模型改写 MEMORY.md（合并/按 supersession key 取代/保留来源锚点）
                                        │
                                        ├─▶ MEMORY.md / USER.md（精编核心）
                                        └─▶ DREAMS.md（摘要 + 改写前镜像，供人审阅）
```

写入安全：`MEMORY.md` 替换用**乐观并发**（改写前重算内容哈希，变了就 abort 该轮并退化为 append-only）；保留改写前镜像；结构校验 + bootstrap 预算校验 + 丢失比例上限。

### 6.3 provenance（来源）—— 整个记忆系统的安全基石

每个索引条目在 **SQLite 列**里带来源元数据（模型无法用自然语言伪造）：

- **origin class**（闭集）：`owner`（主人在可信通道亲手输入）、`agent`（智能体从主人内容推导）、`untrusted`（来自网页/工具输出/群里非主人）、`system`（运行时指令）。无法判定时**保守降级**：外部推导的算 untrusted，含运行时指令的算 system，**绝不默认 owner**。
- **session kind**：interactive / cron / heartbeat / sub-agent。**cron、heartbeat、sub-agent 会话不产生可提升的持久记忆候选**（防"心跳噪音/运行时指令复述"污染）。
- **observed timestamp + supersession key**：新事实取代旧事实，而不是并存。
- **recall-loop 防护**：曾被注入上下文的内容（bootstrap、搜索结果、召回的 transcript 片段）被**结构性标记**，永不再被抽取为新记忆——"被召回一百次的事实仍然是一条事实"。
- **taint 传播**：若某工具结果声明为网络来源，则该 turn 之后产生的所有 assistant 消息都带污点，记忆分类按 `untrusted` 处理；**下一条用户消息才清除**。已知缺口：只覆盖"主动声明"的工具（如本地文件读取不污染）。

### 6.4 两档召回（Recall）

| 档 | 机制 | 成本 |
|----|------|------|
| **Lane 1（默认、常开）** | ① **bootstrap 注入**：`MEMORY.md`/`USER.md` 在 provenance 合格时进上下文（每轮在预算内刷新）；② **ranked search**：`memory_search` = 混合相关性 × 指数新近衰减（**30 天半衰期**）× 重要性倍数（写入时打 1–10 分）；③ **trigger 注入**：条目尾注释 `<!-- trigger: … -->`，每条入站消息做词法+向量预过滤，**≥0.65** 命中才注入，**每轮最多 3 条** | **0 次模型调用** |
| **Lane 2（升级档）** | **Active Memory**：一个真实的阻塞式子智能体 turn，可跨历史/跨会话检索 | 一次真实 agent turn，只在"① 消息显示回忆意图 ② Lane 1 无强命中"时触发；`mode:"always"` / `"off"` 可调 |

**关键安全限制**：自动注入**只限精编层**（`MEMORY.md`/`USER.md`）；日记与 transcript **永不自动注入**，只能通过显式搜索工具或 Lane 2 触达（且结果包裹为"不可信内容"）。

`MEMORY.md` 条目写法示例（官方）：

```markdown
- Keep the gateway on loopback. <!-- trigger: gateway setup, network safety --> <!-- importance: 9 -->
- Use the release helper for package validation. <!-- project: github.com/openclaw/openclaw -->
```

### 6.5 用户模型（`USER.md`）与前瞻记忆（standing intents）

- `USER.md` 与 `MEMORY.md` **分家**：偏好遵循与事实回忆的失效模式不同（引 PrefEval, ICLR 2025：偏好只在上下文里出现几轮后就失效，把指令**在查询附近重述**比重型检索更有效）。格式契约：写成**祈使句指令**（"Always / Never / Prefer"），带观察到的时间与 active/superseded 状态，**原地取代**而非追加（追加会导致模型用旧值回答）。
- **Standing intents**：把"记得要做"从模型里**编译出去**。时间型 → 立刻转 cron；事件型 → 进每 agent 的 SQLite 表，带**机器可校验的触发字段**（关键词、可选触发向量、通道/发送者范围、过期、触发预算、冷却）；每条入站消息做**规则预过滤**，命中才作为隐藏上下文注入，**匹配路径 0 次模型调用**。生命周期是显式状态（pending/armed/fired/done/cancelled/expired）；抗打扰是结构性的：默认冷却 **24h**、预算 **3 次**、**90 天**过期、每轮最多 **3 条**。

### 6.6 会话存储与隔离

| 项 | 值 |
|----|-----|
| 会话库 | `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite` |
| 归档 transcript | `~/.openclaw/agents/<agentId>/sessions/` |
| 旧版迁移 | 旧 `sessions.json` + JSONL 需停机 `openclaw doctor --fix` 导入；启动发现旧库会**拒绝就绪**而不是静默空历史 |
| DM 隔离 | `session.dmScope`: `main`（默认，所有 DM 共用一个主会话）/ `per-peer` / `per-channel-peer`（推荐）/ `per-account-channel-peer` |
| 群/房隔离 | `session.groupScope`: `per-group`（默认）/ `main` |
| 身份合并 | `session.identityLinks` 把同一个人在多通道的身份映射成一个 peer id |
| 保留策略 | `session.maintenance`：`pruneAfter: 30d`、`archiveDashboardAfter: 7d`、`maxEntries: 5000`、可选 `preserveRecent` |
| 阅后即焚 | **Incognito**：仅 Control UI 新建线程可选，会话行/transcript/压缩状态只留内存，**24h 或 Gateway 重启即过期**；不跑 memory flush、不留归档（注意：Codex runtime 仍会写 `logs_2.sqlite`） |
| 重启恢复 | Gateway 重启打断已准入 turn 时，自动重放（保留已记录的工具调用与结果、复用原用户消息）；三次失败耗尽预算，之后用 WebChat 的 **Resume** 手动续跑 |

---

## 7. 多平台 / 多通道接入

### 7.1 支持矩阵（官方 catalog，30+）

| 分类 | 通道 | 打包方式 |
|------|------|---------|
| 主流 IM | **Telegram**（grammY）、**Discord**、**Slack**（Socket Mode / HTTP Request URL / relay）、**WhatsApp**（Baileys，QR 配对）、**iMessage**（via imsg，JSON-RPC over stdio）、**Signal**（signal-cli）、**Microsoft Teams**、**Google Chat**、**Matrix**、**SMS**（Twilio）、**LINE** | Telegram/A2A/Reef/X 为 bundled；其余多为 official plugin（`openclaw plugins install @openclaw/<id>`） |
| 国内 | **飞书 Feishu**、**QQ bot**、**微信 WeChat**（external plugin `openclaw-weixin`）、**企业微信 WeCom**（external）、**元宝 Yuanbao**（external） | 外部插件为主，需自行确认维护状态 |
| 开发者/自托管 | IRC、Mattermost、Nextcloud Talk、Nostr（NIP-04）、Twitch、Tlon/Urbit、Synology Chat、Buzz、ClickClack、Raft、Reef | official / bundled |
| Agent 互操作 | **A2A**（A2A 1.0 JSON-RPC） | bundled plugin |
| 内置 | **WebChat**（Control UI，走 Gateway WS） | core |

补充：**邮件**不是通道，而是**触发器**（Gmail PubSub trigger、IMAP email trigger）——邮件到来可以唤醒 agent，但回复不走"邮件通道"抽象。语音电话是独立插件（Plivo / Telnyx / Twilio）。

### 7.2 Adapter 怎么做（插件 SDK 契约）

```ts
// 出站：声明能力 + 返回回执
export const message = defineChannelMessageAdapter({
  live: {
    capabilities: ["draftPreview", "previewFinalization", "progressUpdates",
                   "nativeStreaming", "quietFinalization"],
    finalizer: { capabilities: ["finalEdit", "normalFallback", "discardPending",
                                "previewReceipt", "retainOnAmbiguousFailure"] },
  },
  tts: { voice: { synthesisTarget: "voice-note", captionedFinalText: true } },
  receive: { defaultAckPolicy: "after-admit", supportedAckPolicies: [...] },
  async send(target, payload) { /* … */ return receipt; },   // → MessageReceipt
});
```

- 只声明**原生 transport 真的支持**的能力，并且必须由契约测试（`verifyChannelMessageLiveCapabilityAdapterProofs` 等）证明副作用与回执。
- 能力漂移 = 测试失败：这是"多平台一致性"能维持住的关键工程手段。
- 旧路径：已有 `outbound` adapter 可用 `createChannelMessageAdapterFromOutbound(...)` 派生。
- 入站：`openclaw/plugin-sdk/channel-inbound`，`createAcceptedChannelDeliveryResult(...)` 聚合"已确认的可见发送"。

### 7.3 有统一消息模型吗？—— 有，但它是"分层统一"

| 层 | 统一的部分 | 不统一（通道特有）的部分 |
|----|-----------|------------------------|
| 入站 | 统一入站消息（body、媒体、`ReplyToId/Body/Sender`，引用上下文以 `[Replying to ...]` 追加到 body） | mention 规则、群策略、thread/topic 语义、历史可读性（Telegram Bot API 读不到入群前历史） |
| 路由 | `agentId` + `sessionKey` + 队列模式 | 平台 ID 大小写敏感性（Matrix room/thread、Signal group） |
| 出站 | `MessageReceipt`、能力位（draft/progress/nativeStreaming）、ack policy、TTS voice-note | 富消息形态（Slack blocks、Teams cards、Discord components） |
| 投递 | 幂等键、去重缓存、送达确认即终止循环 | 编辑/删除/表情回应能力 |

### 7.4 路由规则（9 级优先级，官方明示）

1. 精确 peer 匹配（`peer.kind` + `peer.id`）
2. 父 peer 匹配（线程继承）
3. peer 通配（`peer.id: "*"`）
4. Discord guild + roles
5. Discord guild
6. Slack team
7. account 匹配
8. channel 匹配（`accountId: "*"`）
9. fallback owner（调用方给的主人；否则唯一配置的 agent；多 agent 无 owner 时必须靠 binding，**不会取列表第一个**）

binding 里多个字段同时给出时，**必须全部匹配**。多 agent 并行回复用 `broadcast`（`strategy: "parallel"`，`maxRounds` / `maxTurns` 限流）。

---

## 8. 部署形态

| 形态 | 是否官方支持 | 关键点 |
|------|-------------|--------|
| **本地优先（默认）** | ✅ | 安装脚本 `curl -fsSL https://openclaw.ai/install.sh \| bash`（Windows PowerShell 版 `install.ps1`），或 `npm i -g openclaw@latest`；`openclaw onboard --install-daemon` → `openclaw gateway status` → `openclaw dashboard` |
| **常驻 daemon** | ✅ | `openclaw gateway`（前台，日志 stdout）/ `openclaw gateway install`（装后台服务）；**launchd / systemd** 监管自动重启；单主机一个 Gateway |
| **Web UI（Control UI）** | ✅ | 默认 http://127.0.0.1:18789/ ；同一端口还托管 `/__openclaw__/canvas/`（widget 文档）与 `/__openclaw__/a2ui/`（渲染资源） |
| **TUI / CLI** | ✅ | 都是 WS 客户端；`openclaw agent`、`openclaw sessions`、`openclaw mcp` … |
| **Docker** | ✅（可选） | `./scripts/docker/setup.sh`；镜像 `ghcr.io/openclaw/openclaw`（主）与 Docker Hub 镜像；变体 `slim` / `-browser` / `extended-stable`；**至少 6 GB RAM** 才能本地源码构建；`replicas: 1`、`Recreate` 策略（共享 volume **不能**用来扩副本） |
| **K8s / Compose / Podman / Nix** | ✅ | 文档齐全；`replicas: 1` + `stop-first` |
| **边缘/托管** | ✅ | Cloudflare Containers、Fly.io、Railway、Render、Daytona、Hetzner、Oracle、Raspberry Pi、macOS VM |
| **移动端** | ⚠️ 非"跑 gateway" | iOS/Android 作为 **node** 配对（camera / screen / location / voice / Canvas）；也有独立 App（App Store / APK），但 Android APK 在 2026.10.5 发布时被 **skipped**（`apps/android/version.json` 落后于发布线） |
| **资源占用** | 部分可推 | 默认镜像体积大（macOS arm64 zip ≈ 321 MB，dmg ≈ 238 MB，AppImage ≈ 175 MB，deb ≈ 50 MB）；browser 变体内置 Chromium，显著更大；运行期主要为 Node + SQLite（WAL）+ 通道长连接。**具体 RAM/CPU 官方未给基线，未证实** |

健康检查（无需鉴权）：`/healthz`（存活）、`/startupz`（启动与流量准入）、`/readyz`（深度、含通道就绪）。
状态目录：默认 `~/.openclaw`（容器内 `/home/node/.openclaw`），可用 `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` 覆盖；配置在 `~/.openclaw/openclaw.json`。

---

## 9. 与同类框架对比

> 下表关于"其它框架"的描述属于**公开资料的一般性架构认知**，本次调研**未逐一打开其仓库核验版本细节**；OpenClaw 一列均有 §12 的一手来源。请把非 OpenClaw 列当作"定位级对比"而非精确事实。

| 维度 | **OpenClaw** | Claude Code / OpenClaude 类 | OpenHands | AutoGPT | LangGraph | Letta / MemGPT | Dify | n8n | Browser Use |
|------|--------------|------------------------------|-----------|---------|-----------|----------------|------|-----|-------------|
| 核心定位 | 自托管**多通道个人助理网关** | 终端里的**编码智能体** | 软件工程**智能体平台** | 早期**自主目标循环** | **图编排框架**（库） | **有状态记忆**智能体服务 | LLMOps / **应用平台** | **工作流自动化** | **浏览器操作**库 |
| 运行形态 | 常驻 Gateway 进程 + 通道插件 | CLI / IDE 会话 | 服务 + 沙箱容器 | 进程 + 循环 | 嵌入你的应用 | 服务 + DB | Web 服务 + 容器 | 服务 + 编辑器 | 库 / 服务 |
| 主循环归属 | 内置 loop，**可换 harness** | 自带 loop | 自带 loop | 自带 loop | **你**定义图 | 自带（记忆为中心） | 图形编排 | 节点图 | 单任务 loop |
| 工具扩展 | MCP + 插件 SDK + 技能 | MCP + hooks | 工具集 + 运行时 | 插件/工具 | 任意（你写节点） | 工具 + 记忆 API | 插件/工具 | 节点（400+ 集成） | 浏览器动作 |
| 记忆 | **文件分层 + provenance + dreaming + 两档召回** | 会话/CLAUDE.md 级 | 会话 + 工作区 | 向量库（弱） | 交给开发者（checkpoint） | **强项**：分层记忆 + 自编辑 | 会话变量 / 数据集 | 无（外部 DB） | 无 |
| 多通道 | **强项**：30+ IM 统一 | 无（终端） | Web UI 为主 | 无 | 无 | API/SDK | Web/API | Webhook/聊天触发器 | 无 |
| 主动行为 | **heartbeat + cron + standing intents** | 无 | 有限 | 有（循环） | 由你实现 | 有限 | 有限 | **强项**（定时/触发） | 无 |
| 权限/沙箱 | 策略先于模型 + 可选沙箱 + 审批 | 权限确认模式 | 容器沙箱 | 弱 | 无（自建） | 有限 | 有限 | 凭据管理 | 无 |
| 水平扩展 | **弱**（单 Gateway、`replicas:1`） | N/A | 中 | 弱 | 强（无状态图） | 中 | 中 | 中 | 强 |
| 最适合借鉴 | 通道抽象、记忆写入闸门、主动调度 | 工具审批 UX、编码 loop | 沙箱执行 | — | 状态机/可恢复性 | 记忆分层理论 | 可视化编排 | 触发器生态 | 浏览器工具设计 |

### OpenClaw 的真正差异点（4 条）

1. **"通道"是一等公民**：别家把"聊天平台"当集成，OpenClaw 把它当**架构中心**——统一消息模型 + adapter 能力声明 + 每通道群/线程/话题语义 + 配对与 allowlist。这决定了它天然是"陪伴型助理"而不是"编码工具"。
2. **可换 harness**：模型和 agent 运行时都是插件（Claude、Codex app-server、Copilot SDK、本地模型、CLI backend）。同一套会话/工具/记忆可以跑在不同"大脑"上，这是很少见的解耦层次。
3. **记忆是"写入期治理"而不是"检索期优化"**：provenance 列在 SQLite、分层信任、dreaming 双闸门、recall-loop 防护、taint 传播。多数框架止步于"向量库 + top-k"。
4. **"主动"被编译成调度**：heartbeat（默认 30m，可 `0m` 关）、cron、standing intents 三件套，且默认行为**极度克制**（`NO_REPLY`、抗打扰预算、activeHours），避免变成骚扰机器人。

---

## 10. 对"自主 AI 陪伴系统"可复用的设计，与必须避开的坑

### 10.1 可直接复用的 6 个架构思想

1. **单 Gateway + typed WS 协议（TypeBox → JSON Schema → 客户端模型）**
   一条协议同时服务 CLI、Web UI、桌面 app、移动 node；请求/响应/事件三态 + `hello-ok.features` 做能力发现。对陪伴系统意味着：**手机、音箱、车机、桌面端接同一套会话与状态**，不用为每端写后端。
2. **通道 adapter 的"能力声明 + 回执 + 契约测试"三元组**
   不要做"万能消息对象"，而是**声明式能力位**（能否编辑草稿、能否流式、能否原生语音条）+ 发送回执（`MessageReceipt`）+ 用测试锁死能力与实现一致。这一招能把"多平台差异"从无穷 if-else 变成可测试的矩阵。
3. **会话键由路由决定，而不是由模型决定**
   `agent:<agentId>:<channel>:group:<id>:topic:<id>` 这种**可读、可诊断、可配置覆盖**的键，加上 `dmScope` / `groupScope` / `identityLinks`，直接解决"同一个人多平台身份"与"群聊不该污染私聊"两个陪伴系统必踩的坑。
4. **写入期 provenance 闸门 + 离线整合（dreaming）**
   把"记忆写入"从回复热路径移到后台批处理；用**闭集来源标签**（owner/agent/untrusted/system）在 SQLite 列里做**不可伪造**的信任分层；用规则打分做候选、模型只做"规则内的改写"。这是目前最工程化的抗记忆投毒方案（对齐 OWASP ASI06 / MINJA 类攻击）。
5. **把"主动"变成调度对象**
   heartbeat prompt 默认是"只按 monitor scratch 行事，没事就 NO_REPLY，禁止从旧对话推断任务"；真正周期性的关怀必须显式建成 cron job。加上 `activeHours`、冷却、触发预算——**默认安静，主动需申请**。这比"让模型自己决定要不要说话"可靠一个量级。
6. **turn 级并发原语：队列模式 + writer claim + 幂等键**
   `steer/followup/collect/interrupt` 四种队列语义 + `activeWriterRunId` 乐观栅栏 + `send/agent` 的 idempotency key，解决了"用户连发三条""重连重试""后台任务和用户抢同一会话"的经典问题。陪伴系统的语音场景尤其需要 `interrupt`。

### 10.2 必须避开的 7 个坑

1. **概念膨胀**：`dreaming` / `active memory` / `standing intents` / `context engine` / `Code Mode` / `Tool Search` / `Lobster` / `lossless claw` / `ACP` / `Swarm` … 文档体量已到"新人无法在一天内建立心智模型"的程度。自研时**先做 20% 的核心**（Gateway + 通道 + 会话 + 记忆分层），其余按需。
2. **单写者架构的上限**：SQLite + 状态目录锁 + `replicas: 1` 明确写着"共享 volume 不是扩副本的方式"。如果目标用户量 > 单机，必须从第一天就把**会话存储抽象成可换后端**（Postgres/Redis），否则后期重写成本极高。
3. **记忆的"延迟可见"**：dreaming 是后台 sweep，transcript 索引有 5s 合并窗口 + embedding 时间；`MEMORY.md` 的更新是"下一轮才可见"。产品上必须设计"我刚说的事它怎么还没记住"的兜底（OpenClaw 用 memory flush + 显式 memory 工具兜）。
4. **提示注入与 taint 覆盖不全**：官方自己承认 taint 只覆盖"声明为网络来源"的工具，本地文件读取不污染；群聊里非主人发言按 untrusted 处理但**主人的 turn 内仍可能被工具结果污染**。自研时要把"工具结果来源"做成**强制的**字段，而不是可选声明。
5. **通道语义泥潭**：编辑/删除/表情/线程/话题/引用/媒体转码/群成员事件，每个平台都不一样；OpenClaw 用"能力位 + 契约测试 + 大量特例文档"Hard 抗。不要低估这块的工作量——它通常比 agent loop 本身更耗时。
6. **默认无沙箱 + 出站网络**：工具默认在宿主机跑，安全依赖用户自己开沙箱、配 allowlist、配审批。任何面向普通用户的陪伴产品**不能**沿用这个默认值。
7. **超快迭代 vs 稳定性**：CalVer 几乎每周发版（2026.10.5 距 2026.8.1 仅两个月），插件 SDK 有 deprecation（`dispatchInboundReplyWithBase` 已废弃）、工具改名（`image` → `view_image`）、插件移除（OpenProse）。**不要**把产品建在其 SDK 的未稳定面上；优先用 MCP + 自建工具这种相对稳的边界。

---

## 11. 如果要把 OpenClaw 的思路用于本项目：5 条结论

1. **采用"单网关 + 通道适配层"的骨架，但把通道适配层当作独立可测组件。**
   定义统一入站消息（body/media/reply-to/thread）与统一出站回执，用**能力位 + 契约测试**约束每个平台适配器。这样新增微信/QQ/电话/车载只加 adapter，不动核心；同时避免"万能消息对象"最后变成巨型 switch。

2. **采用"会话键由路由算、并发由队列管、写入由栅栏保"的三件套。**
   `agent:channel:peer[:thread|:topic]` 式 sessionKey + `steer/followup/collect/interrupt` + 单写者 claim，是陪伴系统处理"多平台同一人""语音打断""后台任务插队"的最小可靠集。**但把存储抽象成接口**，别把 SQLite 单写者写死（这是 OpenClaw 最明确的扩展性债务）。

3. **记忆照搬"分层 + 写入期 provenance + 离线整合"，不要照搬它的规模。**
   最小可用版：`USER.md`（祈使句偏好，原地取代）+ `MEMORY.md`（精编事实，带 trigger/importance 注释）+ 日记/transcript（只搜不注入）+ 一个后台整合任务（规则打分 → 模型改写 → 结构校验 → 保留镜像）。**一条硬规则**：外部来源内容永不自动注入、永不提升进精编层。这一个规则就能挡掉大部分记忆投毒。

4. **主动行为一律编译成调度，且默认静默。**
   `heartbeat`（周期自检，没事就 `NO_REPLY`）+ `cron`（显式关怀任务）+ `intent` 表（"下次他提到 X 就提醒"）三件套；配 activeHours、冷却 24h、触发预算 3 次、每轮最多 3 条注入。**不要**让模型自由决定"要不要主动说话"——那是烧钱且不可控的。

5. **避开它的三处债务：默认无沙箱、单机不可扩、概念/文档膨胀。**
   第一天就定：工具默认沙箱（或至少默认只读 + 显式提权）、存储可换后端、核心概念不超过 8 个并在文档里给出"一条消息的旅程"作为唯一入口。OpenClaw 的能力值得学，它的**复杂度**不值得复制。

---

## 12. 来源清单（访问日期均为 2026-10-21）

**一手：GitHub API / 仓库原文**
- 仓库元数据（star/fork/license/语言/创建时间/最新 push）：https://api.github.com/repos/openclaw/openclaw
- 仓库根目录结构：https://api.github.com/repos/openclaw/openclaw/contents/
- `src/` 模块清单：https://api.github.com/repos/openclaw/openclaw/contents/src
- 最新 release（v2026.10.5，published 2026-10-18）：https://api.github.com/repos/openclaw/openclaw/releases/latest
- README：https://raw.githubusercontent.com/openclaw/openclaw/main/README.md
- 文档首页（配置路径 `~/.openclaw/openclaw.json`、快速开始、架构 mermaid）：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/index.md
- Gateway 架构：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/architecture.md
- Agent loop（运行逻辑主依据）：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/agent-loop.md
- 记忆架构：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/memory-architecture.md
- 会话管理：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/session.md
- 通道总览：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/channels/index.md
- 通道路由：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/channels/channel-routing.md
- 工具总览：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/tools/index.md
- MCP：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/tools/mcp.md
- 通道 message adapter SDK：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/plugins/sdk-channel-plugins/message-adapter.md
- Docker 部署：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/install/docker.md
- Heartbeat（主动行为）：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/gateway/heartbeat.md
- OpenProse 移除（v2026.8.1 变更证据）：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/prose.md

**一手：官方文档站 / 发布页**
- v2026.8.1 "AKA OpenClaw 2.0"：https://docs.openclaw.ai/releases/2026.8.1
- 官网：https://openclaw.ai
- 基金会：https://openclaw.org
- 插件/技能市场：https://clawhub.ai
- 生态页：https://openclaw.ai/ecosystem

**歧义对照**
- Captain Claw 重制（C++/GPL-3.0/517 star/2017 创建/2022 最后 push）：https://api.github.com/repos/pjasicek/OpenClaw
- PSVita 移植：https://github.com/theheroGAC/OpenClaw-Vita
- FreeBSD ports 条目：https://www.freshports.org/games/openclaw/

**中文二手（仅用于确认"主流指代"，不引用其技术细节）**
- 科普中国《一觉醒来，全网都在"养龙虾"？给普通人的 Open Claw 简析》：https://cloud.kepuchina.cn/newSearch/imgText?id=7429995237362819072
- 新浪科技《开源 AI 代理 OpenClaw 重构人机交互逻辑》：https://finance.sina.cn/2026-02-12/detail-inhmpcur7079047.d.html
- 北大《"手把手教你养一只自己的龙虾"讲座》：http://bda.pku.edu.cn/info/1003/3864.htm

---

## 13. 未证实 / 边界声明

- **v2026.8.1 的确切发布日**：文档只标注它是 "AKA OpenClaw 2.0"，未给出 ISO 日期 → **未证实**。
- **运行期资源基线（RAM/CPU/常驻内存）**：官方文档未给数字，仅给出镜像体积与"构建需 ≥6 GB RAM"→ **未证实**。
- **微信/企业微信/元宝通道的实际可用性**：文档明确标注为 **external plugin**（维护在 OpenClaw 仓库之外）→ 生产可用性**未证实**，需自行核验。
- **Android APK**：2026.10.5 发布说明中记为 **skipped**（`apps/android/version.json` 仍是 2026.8.2）→ 该版本移动端安装包状态**未证实**。
- **§9 对比表中非 OpenClaw 各列**：基于公开资料的定位级认知，本次未逐一核验其仓库/版本 → 视为**一般性描述**。
- **star/fork/issue 数**：为 2026-10-21 抓取快照，会持续变化。
