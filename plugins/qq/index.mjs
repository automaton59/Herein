/**
 * QQ Bot channel plugin.
 *
 * Owns the QQ protocol: credentials file, gateway websocket, event
 * normalization and message sending. It reports each received message to the
 * Core through `ctx.emit` — the Core persists it and (when auto-reply is on)
 * generates the reply with persona, memory and the configured model. This
 * plugin only sends text back. It never touches the database.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPLYABLE = new Set(['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE']);

async function loadCredentials(ctx) {
  const configPath = typeof ctx.config.configPath === 'string' && ctx.config.configPath.trim()
    ? ctx.config.configPath.trim()
    : path.join(ctx.dataDir ?? process.cwd(), 'qqbot.json');

  const resolved = path.isAbsolute(configPath)
    ? configPath
    : path.join(ctx.dataDir ?? process.cwd(), configPath);

  let parsed;

  try {
    parsed = JSON.parse(await readFile(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read QQ config at ${resolved}: ${error instanceof Error ? error.message : error}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('QQ config must be a JSON object');
  }

  for (const key of ['appId', 'appSecret']) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
      throw new Error(`QQ config field "${key}" must be a non-empty string`);
    }
  }

  return parsed;
}

export function createPlugin() {
  let gateway = null;
  let client = null;
  let lastError = null;
  let adapterPromise = null;

  async function getAdapter(ctx) {
    if (!adapterPromise) {
      adapterPromise = ctx.loadModule('adapters/qq/dist/index.js');
    }

    return adapterPromise;
  }

  return {
    async start(ctx) {
      const credentials = await loadCredentials(ctx);
      const autoReply = ctx.config.autoReply === true;
      const adapter = await getAdapter(ctx);

      if (typeof adapter.QQBotClient !== 'function' || typeof adapter.QQGateway !== 'function') {
        throw new Error('qq adapter does not export QQBotClient / QQGateway');
      }

      client = new adapter.QQBotClient({ config: credentials });

      // 1 << 25 = GROUP_AND_C2C_EVENT intents: both group @s and direct messages.
      gateway = new adapter.QQGateway({
        client,
        intents: 1 << 25,
        autoReconnect: true,
        onEvent: event => {
          void (async () => {
            try {
              const draft = await adapter.normalizeQQEvent(event);

              if (!draft) {
                return;
              }

              const shouldReply = autoReply && REPLYABLE.has(event.t ?? '');

              await ctx.emit({
                type: 'channel.message',
                payload: {
                  ...draft,
                  id: draft.id,
                  msgId: draft.id,
                  shouldReply,
                },
              });
            } catch (error) {
              // A failed event must not kill the listener loop.
              lastError = error instanceof Error ? error.message : String(error);
              ctx.log('warn', 'qq event handling failed', error);
            }
          })();
        },
      });

      try {
        await gateway.connect();
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        gateway = null;
        throw error;
      }
    },

    async stop() {
      gateway?.close();
      gateway = null;
      client = null;
      lastError = null;
    },

    async health(ctx) {
      return {
        status: gateway ? 'ok' : lastError ? 'failed' : 'degraded',
        message: lastError ?? (gateway ? 'listening' : 'not started'),
        checkedAt: ctx.now().toISOString(),
      };
    },

    async invoke(action, input, ctx) {
      if (action === 'status') {
        return {
          running: Boolean(gateway),
          error: lastError,
        };
      }

      if (action === 'send') {
        const body = input && typeof input === 'object' ? input : {};
        const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
        const conversationKind = body.conversationKind === 'group' ? 'group' : 'dm';
        const content = typeof body.content === 'string' ? body.content : '';
        const msgId = typeof body.msgId === 'string' ? body.msgId : undefined;

        if (!conversationId || !content.trim()) {
          throw new Error('send 需要 conversationId 和 content');
        }

        const sendAdapter = await getAdapter(ctx);
        const sentClient = client ?? new sendAdapter.QQBotClient({
          config: await loadCredentials(ctx),
        });

        return conversationKind === 'group'
          ? sentClient.sendGroupMessage(conversationId, content.trim(), msgId)
          : sentClient.sendC2CMessage(conversationId, content.trim(), msgId);
      }

      throw new Error(`不支持的 QQ 动作：${action}`);
    },
  };
}
