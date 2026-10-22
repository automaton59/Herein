import type { createPhase2Repositories } from '../../data/repositories';
import type { LlmConfig } from '../../core/llm';
import { loadLlmConfig } from '../../core/llm';
import { createQQResponder } from '../../services/qqResponder';
import { startQQListener, type QQListenerHandle } from '../../services/qqListener';
import type { PluginInstance, PluginManifest } from '../types';

export const QQ_MANIFEST: PluginManifest = {
  id: 'qq',
  name: 'QQ Bot',
  version: '0.1.0',
  kind: 'channel',
  description: 'QQ 官方 Bot：全量群消息/私聊监听，可选被动回复；凭据在本地文件。',
  entry: 'builtin.js',
  permissions: [
    { kind: 'credentials', value: 'qqbot.json', reason: '读取 AppID/AppSecret' },
    { kind: 'send', value: 'qq', reason: '被动回复群/私聊' },
    { kind: 'network', value: 'api.sgroup.qq.com', reason: 'QQ Bot HTTP/WebSocket' },
  ],
  configSchema: {
    type: 'object',
    properties: {
      configPath: {
        type: 'string',
        title: '凭据文件',
        description: '默认 private/credentials/qqbot.json',
      },
      autoReply: {
        type: 'boolean',
        title: '自动回复',
        default: false,
      },
    },
    additionalProperties: false,
  },
};

export interface QQPluginOptions {
  repos: ReturnType<typeof createPhase2Repositories>;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  fetchImpl?: typeof fetch;
  configPath?: string;
  autoReply?: boolean;
}

export function createQQPlugin(options: QQPluginOptions): PluginInstance {
  let handle: QQListenerHandle | null = null;
  let lastError: string | null = null;

  return {
    async start(ctx) {
      const configPath = typeof ctx.config.configPath === 'string' && ctx.config.configPath.trim()
        ? ctx.config.configPath
        : options.configPath;
      const autoReply = typeof ctx.config.autoReply === 'boolean'
        ? ctx.config.autoReply
        : Boolean(options.autoReply);
      let responder;

      if (autoReply) {
        let llmConfig = options.llmConfig;

        if (!llmConfig) {
          try {
            llmConfig = await loadLlmConfig(options.llmConfigPath);
          } catch {
            llmConfig = undefined;
          }
        }

        if (llmConfig) {
          responder = createQQResponder({
            repos: options.repos,
            llmConfig,
            fetchImpl: options.fetchImpl,
          });
        }
      }

      try {
        handle = await startQQListener({
          repos: options.repos,
          configPath,
          fetchImpl: options.fetchImpl,
          responder,
        });
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },

    async stop() {
      handle?.stop();
      handle = null;
    },

    async health(ctx) {
      return {
        status: handle ? 'ok' : lastError ? 'failed' : 'degraded',
        message: lastError ?? (handle ? 'listening' : 'not started'),
        checkedAt: ctx.now().toISOString(),
      };
    },

    async invoke(action) {
      if (action === 'status') {
        return {
          running: Boolean(handle),
          error: lastError,
        };
      }

      throw new Error(`不支持的 QQ 动作：${action}`);
    },
  };
}
