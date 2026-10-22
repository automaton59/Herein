import type {
  AgentCapabilityDescriptor,
  AgentOperationResult,
  AgentProvider,
} from './agentProvider';
import { PluginError, type PluginHealth } from './types';

export interface DshBridgeHealth {
  protocol?: number;
  profileId?: string;
  runtimeVersion?: string;
  host?: 'running' | 'offline';
}

export interface DshCapability {
  name: string;
  description?: string;
  parameters?: unknown;
  output?: unknown;
  parallelSafe?: boolean;
}

export interface DshInventory {
  plugins: Array<Record<string, unknown>>;
  bundles: Array<Record<string, unknown>>;
  capabilities: DshCapability[];
}

export interface DshCallResult {
  isError?: boolean;
  content?: unknown;
  value?: unknown;
  error?: {
    code?: string;
    message?: string;
    info?: { code?: string };
  };
}

export interface DshBridgeClientOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class DshBridgeClient {
  readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DshBridgeClientOptions) {
    this.url = options.url.trim().replace(/\/+$/, '');
    this.token = options.token.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;

    if (!this.url) {
      throw new PluginError('invalid_manifest', 'DSH bridge URL is required');
    }

    if (!this.token) {
      throw new PluginError('invalid_manifest', 'DSH bridge token is required');
    }
  }

  async health(): Promise<DshBridgeHealth> {
    return this.request<DshBridgeHealth>('/health');
  }

  async inventory(): Promise<DshInventory> {
    return this.request<DshInventory>('/v1/inventory');
  }

  async call(name: string, args: Record<string, unknown>): Promise<DshCallResult> {
    return this.request<DshCallResult>('/v1/call', {
      method: 'POST',
      body: JSON.stringify({
        name,
        arguments: args,
        timeoutMs: this.timeoutMs,
      }),
    });
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
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
      const parsed = text ? JSON.parse(text) as unknown : null;

      if (!response.ok) {
        const detail = parsed as { error?: { code?: string } } | null;
        throw new Error(`DSH bridge HTTP ${response.status}: ${detail?.error?.code ?? 'UNKNOWN'}`);
      }

      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function dshHealth(raw: DshBridgeHealth, latencyMs: number): PluginHealth {
  return {
    status: raw.host === 'running' ? 'ok' : 'degraded',
    message: raw.host === 'running' ? undefined : 'DSH host is offline',
    checkedAt: new Date().toISOString(),
    latencyMs,
  };
}

async function probeDshHealth(client: DshBridgeClient): Promise<PluginHealth> {
  const startedAt = Date.now();

  try {
    const raw = await client.health();
    return dshHealth(raw, Date.now() - startedAt);
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'DSH bridge unreachable',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  }
}

export function createDshAgentProvider(options: DshBridgeClientOptions): AgentProvider {
  const client = new DshBridgeClient(options);

  const unsupported = async (capabilityId: string): Promise<AgentOperationResult> => ({
    providerId: 'dsh',
    capabilityId,
    status: 'failed',
    message: 'DSH lifecycle changes require a separately signed approval; use adapters/dsh/scripts/cli.mjs',
  });

  return {
    id: 'dsh',
    name: 'DeepSeek Harness',

    async health() {
      return probeDshHealth(client);
    },

    async listCapabilities(): Promise<AgentCapabilityDescriptor[]> {
      const startedAt = Date.now();
      const health = await probeDshHealth(client);

      if (health.status === 'failed') {
        return [];
      }

      const inventory = await client.inventory();
      const checkedAt = new Date().toISOString();
      return inventory.capabilities.map(capability => ({
        providerId: 'dsh',
        id: capability.name,
        name: capability.name,
        version: 'dsh',
        description: capability.description,
        permissions: [],
        health: {
          ...health,
          checkedAt,
          latencyMs: health.latencyMs ?? Date.now() - startedAt,
        },
        installed: true,
        enabled: true,
        lifecycle: 'external',
        actions: ['call'],
        inputSchema: capability.parameters,
      }));
    },

    install: unsupported,
    enable: unsupported,
    disable: unsupported,
    remove: unsupported,

    async invoke(capabilityId, action, input) {
      if (action !== 'call') {
        throw new PluginError('plugin_failed', `unsupported DSH action: ${action}`, 400);
      }

      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new PluginError('plugin_failed', 'DSH call input must be an object', 400);
      }

      return client.call(capabilityId, input as Record<string, unknown>);
    },
  };
}
