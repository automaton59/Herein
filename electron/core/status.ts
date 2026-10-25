import type { Phase2Database } from '../data/database';
import type { PluginRegistry } from '../plugins/registry';
import type { InteractionDispatcher } from './interaction';
import { loadLlmConfig, type LlmConfig } from './llm';

export interface RelayStatusOptions {
  url?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CoreStatusOptions {
  db: Phase2Database;
  pluginRegistry: PluginRegistry;
  relay?: RelayStatusOptions;
  interaction?: InteractionDispatcher;
  startedAt: number;
  version: string;
  ttsUrl: string;
  ttsFetch: typeof fetch;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  now?: () => Date;
}

export interface StatusComponent {
  status: 'ok' | 'degraded' | 'unavailable' | 'unconfigured' | 'unknown';
  message?: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

export interface CoreStatus {
  ok: boolean;
  degraded: boolean;
  version: string;
  startedAt: string;
  uptimeMs: number;
  now: string;
  components: {
    core: StatusComponent;
    db: StatusComponent;
    llm: StatusComponent;
    tts: StatusComponent;
    plugins: StatusComponent;
    agents: StatusComponent;
    relay: StatusComponent;
    interaction: StatusComponent;
  };
}

async function checkTts(url: string, fetchImpl: typeof fetch): Promise<StatusComponent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        status: 'degraded',
        message: `TTS HTTP ${response.status}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      status: 'ok',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'TTS unreachable',
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkRelay(options: RelayStatusOptions | undefined): Promise<StatusComponent> {
  if (!options?.url?.trim()) {
    return {
      status: 'unknown',
      message: 'relay not configured',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
  const startedAt = Date.now();

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${options.url.replace(/\/+$/, '')}/health`,
      {
        signal: controller.signal,
        headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
      },
    );

    if (!response.ok) {
      return {
        status: 'unavailable',
        message: `relay HTTP ${response.status}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      status: 'ok',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'relay unreachable',
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkInteraction(dispatcher?: InteractionDispatcher): Promise<StatusComponent> {
  if (!dispatcher) {
    return {
      status: 'unknown',
      message: 'interaction not configured',
    };
  }

  const health = await dispatcher.health();
  return {
    status: health.status === 'ok'
      ? 'ok'
      : health.status === 'degraded'
        ? 'degraded'
        : 'unavailable',
    message: health.message,
    latencyMs: health.latencyMs,
  };
}

async function checkLlm(options: CoreStatusOptions): Promise<StatusComponent> {  if (options.llmConfig) {
    return {
      status: 'ok',
      detail: {
        provider: options.llmConfig.baseUrl ? 'openai-compatible' : 'configured',
        model: options.llmConfig.model,
      },
    };
  }

  try {
    const config = await loadLlmConfig(options.llmConfigPath);
    return {
      status: 'ok',
      detail: {
        provider: config.baseUrl ? 'openai-compatible' : 'configured',
        model: config.model,
      },
    };
  } catch (error) {
    return {
      status: 'unconfigured',
      message: error instanceof Error ? error.message : 'LLM is not configured',
    };
  }
}

export async function buildCoreStatus(options: CoreStatusOptions): Promise<CoreStatus> {
  const now = (options.now ?? (() => new Date()))();
  const uptimeMs = Math.max(0, now.getTime() - options.startedAt);

  let dbStatus: StatusComponent;

  try {
    options.db.prepare('select 1 as ok').get();
    dbStatus = { status: 'ok' };
  } catch (error) {
    dbStatus = {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'database unavailable',
    };
  }

  const [llm, tts, relay, interaction] = await Promise.all([
    checkLlm(options),
    checkTts(options.ttsUrl, options.ttsFetch),
    checkRelay(options.relay),
    checkInteraction(options.interaction),
  ]);

  const pluginSummary = options.pluginRegistry.summary();
  const plugins: StatusComponent = {
    status: pluginSummary.failed > 0 || pluginSummary.degraded > 0 ? 'degraded' : 'ok',
    message: pluginSummary.installed === 0
      ? 'no plugins installed'
      : `${pluginSummary.enabled}/${pluginSummary.installed} enabled`,
    detail: { ...pluginSummary },
  };

  // 「Agent」不再是独立子系统：agent-kind 插件就是 agent。状态只汇报这些插件的健康。
  const agentPlugins = options.pluginRegistry
    .list()
    .filter(plugin => plugin.manifest.kind === 'agent');
  const agentFailed = agentPlugins.filter(plugin => plugin.health.status === 'failed').length;
  const agentDegraded = agentPlugins.filter(plugin => plugin.health.status === 'degraded').length;
  const agents: StatusComponent = {
    status: agentFailed > 0 ? 'degraded' : agentDegraded > 0 ? 'degraded' : 'ok',
    message: agentPlugins.length === 0
      ? 'no agent plugins'
      : `${agentPlugins.filter(plugin => plugin.installed && plugin.enabled).length}/${agentPlugins.length} agent plugins enabled`,
    detail: {
      plugins: agentPlugins.length,
      failed: agentFailed,
      degraded: agentDegraded,
    },
  };

  const components = {
    core: {
      status: 'ok' as const,
      detail: {
        version: options.version,
        uptimeMs,
      },
    },
    db: dbStatus,
    llm,
    tts,
    plugins,
    agents,
    relay,
    interaction,
  };

  const degraded = [dbStatus, llm, tts, plugins, agents]
    .some(component => component.status !== 'ok')
    || (relay.status !== 'ok' && relay.status !== 'unknown')
    || (interaction.status !== 'ok' && interaction.status !== 'unknown');

  return {
    ok: true,
    degraded,
    version: options.version,
    startedAt: new Date(options.startedAt).toISOString(),
    uptimeMs,
    now: now.toISOString(),
    components,
  };
}
