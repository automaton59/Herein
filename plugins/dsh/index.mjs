/**
 * DeepSeek Harness bridge plugin.
 *
 * Talks to a local DSH bridge over HTTP. The bridge is a separate process owned
 * by the user; this plugin only reads inventory and calls tools. Installing or
 * removing DSH plugins is impossible from here by design — that needs a
 * separately signed approval handled by adapters/dsh.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_DSH_URL = 'http://127.0.0.1:8791';
const TOKEN_HINT = '填 token、指向 token 文件，或放到 <用户数据目录>/dsh/transport-token';

function describeBridgeError(error, url) {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|socket hang up|aborted/i.test(message)) {
    return `连不上 DSH 桥 ${url}：确认桥进程在运行、端口没被占用`;
  }

  if (/401|403|unauthorized|invalid token/i.test(message)) {
    return 'token 不对：重新复制 transport-token 的内容，或在桥端重新生成';
  }

  return message || 'DSH 桥请求失败';
}

function readTokenFile(file, dataDir) {
  if (!file || !file.trim()) {
    return '';
  }

  const resolved = path.isAbsolute(file.trim()) || !dataDir
    ? file.trim()
    : path.resolve(dataDir, file.trim());

  try {
    return readFileSync(resolved, 'utf8').trim();
  } catch {
    return '';
  }
}

function defaultTokenFile(dataDir) {
  return dataDir ? path.join(dataDir, 'dsh', 'transport-token') : '';
}

function resolveDshConfig(config, env, dataDir) {
  const url = (typeof config.url === 'string' && config.url.trim())
    ? config.url.trim()
    : (env.HEREIN_DSH_URL ?? '').trim() || DEFAULT_DSH_URL;

  let token = typeof config.token === 'string' ? config.token.trim() : '';
  const tokenFile = typeof config.tokenFile === 'string' ? config.tokenFile.trim() : '';

  if (!token) {
    token = readTokenFile(tokenFile, dataDir);
  }

  if (!token && env.HEREIN_DSH_TOKEN) {
    token = env.HEREIN_DSH_TOKEN.trim();
  }

  if (!token && env.HEREIN_DSH_TOKEN_FILE) {
    token = readTokenFile(env.HEREIN_DSH_TOKEN_FILE, dataDir);
  }

  if (!token) {
    token = readTokenFile(defaultTokenFile(dataDir), dataDir);
  }

  const timeout = Number(config.timeoutMs);

  return {
    url,
    token,
    timeoutMs: Number.isFinite(timeout) ? Math.max(1000, Math.min(120000, timeout)) : 10000,
  };
}

class DshBridgeClient {
  constructor(options) {
    this.url = options.url.trim().replace(/\/+$/, '');
    this.token = options.token.trim();
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 10000;

    if (!this.url) {
      throw new Error('DSH bridge URL is required');
    }

    if (!this.token) {
      throw new Error('DSH bridge token is required');
    }
  }

  async health() {
    return this.request('/health');
  }

  async inventory() {
    return this.request('/v1/inventory');
  }

  async call(name, args) {
    return this.request('/v1/call', {
      method: 'POST',
      body: JSON.stringify({ name, arguments: args, timeoutMs: this.timeoutMs }),
    });
  }

  async request(pathname, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.url}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) : null;

      if (!response.ok) {
        throw new Error(`DSH bridge HTTP ${response.status}: ${parsed?.error?.code ?? 'UNKNOWN'}`);
      }

      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createPlugin() {
  const env = process.env;
  let lastError = null;
  let lastSuccessAt;

  function clientFor(ctx) {
    const config = resolveDshConfig(ctx.config, env, ctx.dataDir);

    if (!config.url || !config.token) {
      return null;
    }

    let host;

    try {
      host = new URL(config.url).hostname;
    } catch {
      throw new Error(`桥地址不是合法 URL：${config.url}`);
    }

    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      throw new Error('DSH 桥只允许本机地址（127.0.0.1 / localhost）');
    }

    return {
      client: new DshBridgeClient({
        url: config.url,
        token: config.token,
        fetchImpl: ctx.fetch,
        timeoutMs: config.timeoutMs,
      }),
      config,
    };
  }

  return {
    async start() {
      lastError = null;
    },

    async stop() {
      lastError = null;
    },

    async health(ctx) {
      let resolved;

      try {
        resolved = clientFor(ctx);
      } catch (error) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : 'DSH 配置无效',
          checkedAt: ctx.now().toISOString(),
        };
      }

      if (!resolved) {
        const config = resolveDshConfig(ctx.config, env, ctx.dataDir);

        return {
          status: 'degraded',
          message: config.token
            ? 'DSH 桥地址无效，检查配置里的桥地址'
            : `缺少 transport token：${TOKEN_HINT}`,
          checkedAt: ctx.now().toISOString(),
        };
      }

      const startedAt = Date.now();

      try {
        const raw = await resolved.client.health();
        lastSuccessAt = ctx.now().toISOString();
        lastError = null;

        return {
          status: raw.host === 'running' ? 'ok' : 'degraded',
          message: raw.host === 'running'
            ? `DSH ${raw.runtimeVersion ?? ''}`.trim()
            : 'DSH host 离线',
          checkedAt: ctx.now().toISOString(),
          lastSuccessAt,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = describeBridgeError(error, resolved.config.url);

        return {
          status: 'failed',
          message: lastError,
          checkedAt: ctx.now().toISOString(),
          latencyMs: Date.now() - startedAt,
        };
      }
    },

    async invoke(action, input, ctx) {
      const resolved = clientFor(ctx);

      if (!resolved) {
        throw new Error(`DSH 未配置：${TOKEN_HINT}`);
      }

      if (action === 'health') {
        return resolved.client.health();
      }

      if (action === 'inventory') {
        return resolved.client.inventory();
      }

      if (action === 'call') {
        const body = input && typeof input === 'object' ? input : {};
        const name = typeof body.name === 'string' ? body.name : '';

        if (!name) {
          throw new Error('call 需要 name');
        }

        const args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
          ? body.arguments
          : {};

        return resolved.client.call(name, args);
      }

      throw new Error(`不支持的 DSH 动作：${action}`);
    },
  };
}
