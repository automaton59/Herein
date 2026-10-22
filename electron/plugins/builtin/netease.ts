import type { NeteaseCandidateSource } from '../../services/neteaseCandidates';
import { getNeteaseCandidates } from '../../services/neteaseCandidates';
import type { PluginInstance, PluginManifest } from '../types';

export const NETEASE_MANIFEST: PluginManifest = {
  id: 'netease',
  name: '网易云音乐',
  version: '0.1.0',
  kind: 'source',
  description: '匿名只读网易云榜单/搜索，产出歌曲候选，供聊天和主动性推荐使用。',
  entry: 'builtin.js',
  permissions: [
    { kind: 'network', value: 'music.163.com', reason: '读取公开榜单/搜索/歌词' },
  ],
  configSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        title: '候选数量',
        default: 10,
        minimum: 1,
        maximum: 30,
      },
    },
    additionalProperties: false,
  },
};

export interface NeteasePluginOptions {
  source?: NeteaseCandidateSource;
}

export function createNeteasePlugin(options: NeteasePluginOptions = {}): PluginInstance {
  let lastSuccessAt: string | undefined;
  let lastError: string | null = null;

  return {
    async start() {
      lastError = null;
    },

    async stop() {
      lastError = null;
    },

    async health(ctx) {
      if (lastError) {
        return {
          status: 'degraded',
          message: lastError,
          checkedAt: ctx.now().toISOString(),
          ...(lastSuccessAt ? { lastSuccessAt } : {}),
        };
      }

      return {
        status: 'ok',
        message: lastSuccessAt ? '最近候选成功' : '待首次调用',
        checkedAt: ctx.now().toISOString(),
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
      };
    },

    async invoke(action, input, ctx) {
      if (action !== 'candidates') {
        throw new Error(`不支持的网易云动作：${action}`);
      }

      const record = typeof input === 'object' && input !== null
        ? input as Record<string, unknown>
        : {};
      const query = typeof record.query === 'string' ? record.query : undefined;
      const configLimit = Number(ctx.config.limit);
      const inputLimit = typeof record.limit === 'number' ? record.limit : undefined;
      const limit = Math.max(
        1,
        Math.min(
          30,
          Math.round(
            inputLimit
              ?? (Number.isFinite(configLimit) ? configLimit : 10),
          ),
        ),
      );

      try {
        const candidates = await getNeteaseCandidates({
          query,
          limit,
          source: options.source,
        });
        lastSuccessAt = ctx.now().toISOString();
        lastError = null;
        return { candidates };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
}
