#!/usr/bin/env node
/**
 * QQ Bot 真机探针：取 token → 连 WebSocket → 打印 READY 与事件。
 *
 * 用法：
 *   node scripts/qq-probe.mjs [configPath] [--seconds=60] [--echo]
 *   HEREIN_QQ_CONFIG=D:/Herein/private/credentials/qqbot.json node scripts/qq-probe.mjs
 *
 * --echo：收到单聊/群 @ 消息时用被动 msg_id 回一句「收到：...」，验证发送链路。
 *
 * 退出码：0 = 成功连上并跑完；1 = 连接/超时失败；2 = 凭据错误。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const echo = args.includes('--echo');
const secondsArg = args.find((item) => item.startsWith('--seconds='));
const positional = args.filter((item) => !item.startsWith('--'));
const seconds = Math.max(5, Number(secondsArg?.split('=')[1] ?? process.env.QQ_PROBE_SECONDS ?? 60));
const configPath = path.resolve(
  positional[0] ?? process.env.HEREIN_QQ_CONFIG ?? 'private/credentials/qqbot.json',
);

const { QQBotClient, QQGateway, normalizeQQEvent } = await import('../adapters/qq/dist/index.js');

function mask(value) {
  return typeof value === 'string' && value.length > 8
    ? `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`
    : '<empty>';
}

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

let config;
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  console.error(`✗ 读不到配置 ${configPath}: ${error.message}`);
  process.exit(1);
}

console.log(`配置: ${configPath}`);
console.log(`AppID: ${config.appId}`);
console.log(`AppSecret: ${mask(config.appSecret)}`);

const client = new QQBotClient({ config });

let token;
try {
  token = await client.getAccessToken();
  console.log(`✓ AccessToken: ${mask(token)}`);
} catch (error) {
  const body = error?.message ?? String(error);
  console.error(`✗ 取 token 失败 (HTTP ${error?.status ?? '?'}): ${body.slice(0, 300)}`);
  if (body.includes('100016')) {
    console.error('  提示：AppID 存在但 AppSecret 不对，通常是没复制全（或已被重置）。');
  } else if (body.includes('100007') || body.includes('10004')) {
    console.error('  提示：AppID 不存在或机器人已被删除。');
  }
  process.exit(2);
}

const gatewayInfo = await client.getGateway();
console.log(`✓ Gateway: ${gatewayInfo.url}`);

let ready = false;
let eventCount = 0;
const gateway = new QQGateway({
  client,
  intents: 1 << 25,
  autoReconnect: false,
  onReady: () => {
    ready = true;
    console.log(`[${stamp()}] ✓ READY，开始监听 ${seconds}s（单聊/群 @ 消息都会打印）`);
  },
  onEvent: (event) => {
    eventCount += 1;
    const draft = normalizeQQEvent(event);
    const where = draft
      ? `${draft.conversationKind}:${draft.conversationId.slice(0, 12)}…`
      : '-';
    const text = draft?.content?.replace(/\s+/g, ' ').slice(0, 80) ?? '';
    console.log(`[${stamp()}] ${event.t} ${where} ${text}`);

    if (!echo || !draft) {
      return;
    }

    if (event.t !== 'C2C_MESSAGE_CREATE' && event.t !== 'GROUP_AT_MESSAGE_CREATE') {
      return;
    }

    const reply = `收到：${draft.content}`.slice(0, 100);
    const pending = draft.conversationKind === 'group'
      ? client.sendGroupMessage(draft.conversationId, reply, draft.id)
      : client.sendC2CMessage(draft.conversationId, reply, draft.id);

    pending
      .then((result) => {
        console.log(`[${stamp()}] ↩ 已回复 msg_id=${result?.id ?? '-'}`);
      })
      .catch((error) => {
        console.error(`[${stamp()}] ✗ 回复失败: ${error.message}`);
      });
  },
});

const startedAt = Date.now();
await gateway.connect();

const timer = setTimeout(() => {
  console.log(`[${stamp()}] 结束：READY=${ready} 事件数=${eventCount} 用时=${Math.round((Date.now() - startedAt) / 1000)}s`);
  gateway.close();
  process.exit(ready ? 0 : 1);
}, seconds * 1000);

process.on('SIGINT', () => {
  console.log('\n中断，关闭连接');
  gateway.close();
  process.exit(0);
});

// 连接阶段兜底：15s 内没 READY 就报错退出
setTimeout(() => {
  if (!ready) {
    console.error('✗ 15s 内没有收到 READY（检查网络 / 机器人是否可用 / intents 权限）');
    gateway.close();
    process.exit(1);
  }
}, 15_000).unref?.();

// 保持进程存活直到 timer
void timer;
