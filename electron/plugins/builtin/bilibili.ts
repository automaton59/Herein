import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { createPhase2Repositories } from '../../data/repositories';
import {
  scanBilibiliFeed,
  type BilibiliFeedScanResult,
  type BilibiliFeedSource,
} from '../../services/bilibiliActivity';
import type { PluginInstance, PluginManifest } from '../types';

export const BILIBILI_MANIFEST: PluginManifest = {
  id: 'bilibili',
  name: 'B 站',
  version: '0.1.0',
  kind: 'source',
  description: '只读 B 站推荐流，把看过的视频沉淀成 observations 和 activity session。',
  entry: 'builtin.js',
  permissions: [
    { kind: 'network', value: 'api.bilibili.com', reason: '读取推荐流' },
    { kind: 'network', value: 'www.bilibili.com', reason: '读取视频页面信息' },
  ],
  configSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        title: '每次扫描条数',
        default: 20,
        minimum: 1,
        maximum: 50,
      },
    },
    additionalProperties: false,
  },
};

export interface BilibiliPluginOptions {
  repos: ReturnType<typeof createPhase2Repositories>;
  source?: BilibiliFeedSource;
  now?: () => Date;
}

async function loadDefaultSource(): Promise<BilibiliFeedSource> {
  const adapterPath = path.join(process.cwd(), 'adapters', 'bilibili', 'dist', 'index.js');
  const adapter = await import(pathToFileURL(adapterPath).href) as {
    BilibiliClient: new (options?: { minIntervalMs?: number }) => BilibiliFeedSource;
  };

  return new adapter.BilibiliClient({ minIntervalMs: 1200 });
}

export function createBilibiliPlugin(options: BilibiliPluginOptions): PluginInstance {
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
        message: lastSuccessAt ? '最近扫描成功' : '待首次扫描',
        checkedAt: ctx.now().toISOString(),
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
      };
    },

    async invoke(action, input, ctx) {
      if (action !== 'scan') {
        throw new Error(`不支持的 B 站动作：${action}`);
      }

      const rawLimit = typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).limit
        : undefined;
      const configLimit = Number(ctx.config.limit);
      const limit = Math.max(
        1,
        Math.min(
          50,
          Math.round(
            typeof rawLimit === 'number'
              ? rawLimit
              : Number.isFinite(configLimit)
                ? configLimit
                : 20,
          ),
        ),
      );

      try {
        const result = await scanBilibiliFeed({
          repos: options.repos,
          source: options.source ?? await loadDefaultSource(),
          limit,
          now: options.now,
        });
        lastSuccessAt = ctx.now().toISOString();
        lastError = null;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
}
