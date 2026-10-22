import React from 'react';
import {
  Activity,
  Bot,
  CloudSun,
  Database,
  Loader2,
  MessageCircle,
  Plug,
  RefreshCw,
  Route,
  Server,
  Sparkles,
  Trash2,
  Volume2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  CoreClient,
  type CoreAgentCapability,
  type CoreAgentList,
  type CoreCharacterSummary,
  type CoreInitiativeResult,
  type CorePluginAudit,
  type CorePluginHealth,
  type CorePluginSummary,
  type CorePluginView,
  type CoreStatus,
  type CoreStatusComponent,
} from '../../services/coreClient';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';

interface WeatherResult {
  location: {
    name: string;
    country?: string;
    latitude: number;
    longitude: number;
  };
  current: {
    temperatureC: number;
    apparentC?: number;
    humidity?: number;
    windKph?: number;
    weather: string;
    weatherCode?: number;
    observedAt?: string;
  };
  source: string;
  cached: boolean;
}

function createCoreClient() {
  const baseUrl = localStorage.getItem(CORE_URL_KEY)?.trim();

  if (!baseUrl) {
    return null;
  }

  return new CoreClient({
    baseUrl,
    token: localStorage.getItem(CORE_TOKEN_KEY)?.trim() || undefined,
  });
}

function statusTone(component: CoreStatusComponent | undefined) {
  switch (component?.status) {
    case 'ok':
      return 'text-emerald-600 bg-emerald-50 border-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/20';
    case 'degraded':
      return 'text-amber-700 bg-amber-50 border-amber-100 dark:text-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20';
    case 'unavailable':
      return 'text-sky-800 bg-sky-50 border-sky-100 dark:text-sky-200 dark:bg-sky-700/10 dark:border-sky-500/20';
    case 'unconfigured':
      return 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-white/5 dark:border-white/10';
    default:
      return 'text-slate-500 bg-slate-50 border-slate-200 dark:text-slate-400 dark:bg-white/5 dark:border-white/10';
  }
}

function statusLabel(component: CoreStatusComponent | undefined) {
  switch (component?.status) {
    case 'ok':
      return '正常';
    case 'degraded':
      return '降级';
    case 'unavailable':
      return '不可用';
    case 'unconfigured':
      return '未配置';
    default:
      return '未知';
  }
}

function pluginHealthLabel(health: CorePluginHealth) {
  switch (health.status) {
    case 'ok':
      return '正常';
    case 'degraded':
      return '降级';
    case 'failed':
      return '失败';
    default:
      return '未知';
  }
}

function formatUptime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

function statusCard(
  label: string,
  component: CoreStatusComponent | undefined,
  icon: React.ReactNode,
  detail?: string,
) {
  return (
    <div className="rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm dark:border-sky-900/40 dark:bg-[#0b1b2b]/80">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-sky-100">
          <span className="text-sky-700 dark:text-sky-300">{icon}</span>
          {label}
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(component)}`}>
          {statusLabel(component)}
        </span>
      </div>
      <div className="mt-3 truncate text-xs text-slate-500 dark:text-slate-400">
        {detail || component?.message || '—'}
      </div>
    </div>
  );
}

function PluginConfigEditor({
  plugin,
  busy,
  onSave,
}: {
  plugin: CorePluginView;
  busy: boolean;
  onSave: (config: Record<string, unknown>) => Promise<void>;
}) {
  const properties = plugin.manifest.configSchema?.properties ?? {};
  const entries = Object.entries(properties);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ ...plugin.config });

  React.useEffect(() => {
    setDraft({ ...plugin.config });
  }, [plugin.manifest.id, plugin.updatedAt]);

  if (entries.length === 0) {
    return null;
  }

  const update = (key: string, value: unknown) => {
    setDraft(current => {
      const next = { ...current };

      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }

      return next;
    });
  };

  return (
    <details className="mt-3 rounded-xl border border-sky-100 bg-white/70 px-3 py-2 dark:border-sky-900/40 dark:bg-white/[0.03]">
      <summary className="cursor-pointer text-xs font-medium text-sky-700 dark:text-sky-200">
        配置
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map(([key, property]) => {
          const value = draft[key];
          const label = property.title || key;

          if (property.enum) {
            return (
              <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">
                {label}
                <select
                  value={String(value ?? '')}
                  onChange={event => update(key, event.target.value)}
                  className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-sky-900/50 dark:bg-[#07131f] dark:text-sky-50"
                >
                  {property.enum.map(option => (
                    <option key={String(option)} value={String(option)}>{String(option)}</option>
                  ))}
                </select>
              </label>
            );
          }

          if (property.type === 'boolean') {
            return (
              <label key={key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={event => update(key, event.target.checked)}
                  className="h-4 w-4 rounded border-sky-200 text-sky-700"
                />
                {label}
              </label>
            );
          }

          if (property.type === 'number') {
            return (
              <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">
                {label}
                <input
                  type="number"
                  value={typeof value === 'number' ? value : ''}
                  min={property.minimum}
                  max={property.maximum}
                  onChange={event => update(key, event.target.value === '' ? undefined : Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-sky-900/50 dark:bg-[#07131f] dark:text-sky-50"
                />
              </label>
            );
          }

          return (
            <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">
              {label}
              <input
                value={typeof value === 'string' ? value : ''}
                onChange={event => update(key, event.target.value)}
                className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-400 dark:border-sky-900/50 dark:bg-[#07131f] dark:text-sky-50"
              />
            </label>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => void onSave(draft)}
        disabled={busy}
        className="mt-3 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
      >
        {busy ? '保存中…' : '保存配置'}
      </button>
    </details>
  );
}

export function SystemPage({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [status, setStatus] = React.useState<CoreStatus | null>(null);
  const [plugins, setPlugins] = React.useState<CorePluginView[]>([]);
  const [summary, setSummary] = React.useState<CorePluginSummary | null>(null);
  const [characters, setCharacters] = React.useState<CoreCharacterSummary[]>([]);
  const [characterId, setCharacterId] = React.useState('');
  const [agents, setAgents] = React.useState<CoreAgentList>({ providers: [], capabilities: [] });
  const [agentBusy, setAgentBusy] = React.useState('');
  const [agentOutput, setAgentOutput] = React.useState<{ id: string; text: string } | null>(null);
  const [initiativeResult, setInitiativeResult] = React.useState<CoreInitiativeResult | null>(null);
  const [initiativeBusy, setInitiativeBusy] = React.useState(false);
  const [audit, setAudit] = React.useState<CorePluginAudit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [weatherCity, setWeatherCity] = React.useState('');
  const [weatherResult, setWeatherResult] = React.useState<WeatherResult | null>(null);

  const weather = plugins.find(plugin => plugin.manifest.id === 'weather');

  const load = React.useCallback(async () => {
    const core = createCoreClient();

    if (!core) {
      setError('还没有配置 Core 地址。先在设置里填 Core URL / Token。');
      return;
    }

    setLoading(true);

    try {
      const [nextStatus, nextPlugins, nextAudit, nextCharacters, nextAgents] = await Promise.all([
        core.status(),
        core.listPlugins(),
        core.pluginAudit(12),
        core.listCharacters(),
        core.listAgents().catch(() => ({ providers: [], capabilities: [] } as CoreAgentList)),
      ]);
      setStatus(nextStatus);
      setPlugins(nextPlugins.plugins);
      setSummary(nextPlugins.summary);
      setAudit(nextAudit.audit);
      setCharacters(nextCharacters.characters);
      setAgents(nextAgents);
      setCharacterId(current => current || nextCharacters.characters[0]?.id || '');
      setError('');

      const nextWeather = nextPlugins.plugins.find(plugin => plugin.manifest.id === 'weather');
      if (nextWeather && !weatherCity) {
        const city = nextWeather.config.city;
        setWeatherCity(typeof city === 'string' ? city : '');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Core 连接失败');
    } finally {
      setLoading(false);
    }
  }, [weatherCity]);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);

    return () => clearInterval(timer);
  }, [load]);

  const runPluginAction = async (pluginId: string, action: () => Promise<unknown>) => {
    setBusyId(pluginId);
    setError('');

    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const installPlugin = async (pluginId: string) => {
    const core = createCoreClient();
    if (!core) return;
    await runPluginAction(pluginId, () => core.installPlugin(pluginId));
  };

  const togglePlugin = async (plugin: CorePluginView) => {
    const core = createCoreClient();
    if (!core) return;
    await runPluginAction(
      plugin.manifest.id,
      () => plugin.enabled
        ? core.disablePlugin(plugin.manifest.id)
        : core.enablePlugin(plugin.manifest.id),
    );
  };

  const removePlugin = async (pluginId: string) => {
    const core = createCoreClient();
    if (!core) return;
    await runPluginAction(pluginId, async () => {
      await core.removePlugin(pluginId);
      if (pluginId === 'weather') {
        setWeatherResult(null);
      }
    });
  };

  const saveWeather = async () => {
    const core = createCoreClient();
    if (!core || !weather || !weatherCity.trim()) return;
    await runPluginAction('weather', async () => {
      await core.updatePluginConfig('weather', {
        ...weather.config,
        city: weatherCity.trim(),
      });
      if (!weather.enabled) {
        await core.enablePlugin('weather');
      }
    });
  };

  const queryWeather = async () => {
    const core = createCoreClient();
    if (!core || !weather) return;
    await runPluginAction('weather', async () => {
      const response = await core.invokePlugin<WeatherResult>('weather', 'current');
      setWeatherResult(response.result);
    });
  };

  const runInitiative = async () => {
    const core = createCoreClient();
    if (!core) return;
    setInitiativeBusy(true);
    setError('');

    try {
      const result = await core.runInitiative(characterId || undefined);
      setInitiativeResult(result);
      await load();
    } catch (initiativeError) {
      setError(initiativeError instanceof Error ? initiativeError.message : '主动性运行失败');
    } finally {
      setInitiativeBusy(false);
    }
  };

  const runAgentAction = async (
    capability: CoreAgentCapability,
    key: string,
    action: (core: CoreClient) => Promise<unknown>,
  ) => {
    const core = createCoreClient();
    if (!core) return;
    setAgentBusy(`${capability.id}:${key}`);
    setError('');

    try {
      const result = await action(core);
      setAgentOutput({
        id: capability.id,
        text: JSON.stringify(result, null, 2),
      });
      await load();
    } catch (agentError) {
      setError(agentError instanceof Error ? agentError.message : 'Agent 操作失败');
    } finally {
      setAgentBusy('');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,#eef9ff_0,#f8fcff_38%,#ffffff_100%)] px-5 py-6 text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,#082036_0,#06111d_45%,#02070c_100%)] dark:text-sky-50">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-sky-700 dark:text-sky-300">
              <Activity size={14} />
              Herein Control
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">她的系统</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Core、声音、模型和插件，一眼看清她现在能不能被找到。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white/80 px-3 py-2 text-sm font-medium text-sky-700 shadow-sm transition hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:bg-[#0b1b2b] dark:text-sky-200 dark:hover:bg-[#10263a]"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
              >
                设置
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-700/10 dark:text-sky-200">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statusCard('Core', status?.components.core, <Server size={16} />, status ? `v${status.version} · ${formatUptime(status.uptimeMs)}` : undefined)}
          {statusCard('数据库', status?.components.db, <Database size={16} />)}
          {statusCard('模型', status?.components.llm, <Sparkles size={16} />, status?.components.llm.detail?.model as string | undefined)}
          {statusCard('声音', status?.components.tts, <Volume2 size={16} />, status?.components.tts.latencyMs ? `${status.components.tts.latencyMs}ms` : undefined)}
          {statusCard('插件', status?.components.plugins, <Plug size={16} />, summary ? `${summary.enabled}/${summary.installed} 已启用` : undefined)}
          {statusCard('Agent', status?.components.agents, <Bot size={16} />, status?.components.agents.message)}
          {statusCard('隧道', status?.components.relay, <Route size={16} />, status?.components.relay.latencyMs ? `${status.components.relay.latencyMs}ms` : status?.components.relay.message)}
          {statusCard('交互', status?.components.interaction, <MessageCircle size={16} />, status?.components.interaction.latencyMs ? `${status.components.interaction.latencyMs}ms` : status?.components.interaction.message)}
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="rounded-3xl border border-sky-100 bg-white/85 p-5 shadow-sm dark:border-sky-900/40 dark:bg-[#0b1b2b]/80">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">能力插件</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  插件只提供能力，什么时候用由运行时决定。
                </p>
              </div>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
                {summary?.total ?? plugins.length} 个可用
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {plugins.length === 0 && (
                <div className="rounded-2xl border border-dashed border-sky-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-sky-800 dark:text-slate-400">
                  还没有发现插件。把插件目录放到 <code>plugins/</code> 下。
                </div>
              )}

              {plugins.map(plugin => (
                <div
                  key={plugin.manifest.id}
                  className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4 dark:border-sky-900/40 dark:bg-white/[0.03]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{plugin.manifest.name}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10">
                          {plugin.manifest.kind}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          plugin.health.status === 'ok'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : plugin.health.status === 'degraded'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                              : 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300'
                        }`}>
                          {pluginHealthLabel(plugin.health)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {plugin.manifest.description || '没有描述'}
                      </p>
                      {plugin.lastError && (
                        <p className="mt-2 text-xs text-sky-700 dark:text-sky-300">{plugin.lastError}</p>
                      )}
                      {plugin.installed && plugin.manifest.id !== 'weather' && (
                        <PluginConfigEditor
                          plugin={plugin}
                          busy={busyId === plugin.manifest.id}
                          onSave={async config => {
                            const core = createCoreClient();
                            if (!core) return;
                            await runPluginAction(plugin.manifest.id, () => (
                              core.updatePluginConfig(plugin.manifest.id, config)
                            ));
                          }}
                        />
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {!plugin.installed ? (
                        <button
                          type="button"
                          onClick={() => void installPlugin(plugin.manifest.id)}
                          disabled={busyId === plugin.manifest.id}
                          className="rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
                        >
                          安装
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void togglePlugin(plugin)}
                            disabled={busyId === plugin.manifest.id}
                            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                              plugin.enabled
                                ? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                                : 'bg-sky-500 text-white hover:bg-sky-800'
                            }`}
                          >
                            {plugin.enabled ? '停用' : '启用'}
                          </button>
                          {plugin.manifest.id === 'weather' && (
                            <button
                              type="button"
                              onClick={() => void removePlugin(plugin.manifest.id)}
                              disabled={busyId === plugin.manifest.id}
                              className="rounded-xl border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:text-sky-700 disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
                              aria-label={`卸载 ${plugin.manifest.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-5">
            <section className="rounded-3xl border border-sky-100 bg-white/85 p-5 shadow-sm dark:border-sky-900/40 dark:bg-[#0b1b2b]/80">
              <div className="flex items-center gap-2">
                <CloudSun size={18} className="text-sky-700 dark:text-sky-300" />
                <h2 className="text-lg font-semibold">天气插件</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                第一个用来验证插件系统的能力：安装、配置、健康、调用、审计。
              </p>

              {!weather?.installed ? (
                <div className="mt-4 rounded-2xl border border-dashed border-sky-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-sky-800 dark:text-slate-400">
                  先安装天气插件。
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    城市
                    <input
                      value={weatherCity}
                      onChange={event => setWeatherCity(event.target.value)}
                      placeholder="杭州"
                      className="mt-1 w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-400 dark:border-sky-900/50 dark:bg-[#07131f] dark:text-sky-50"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveWeather()}
                      disabled={busyId === 'weather' || !weatherCity.trim()}
                      className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
                    >
                      保存并{weather.enabled ? '重启' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void queryWeather()}
                      disabled={busyId === 'weather' || !weather.enabled}
                      className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:bg-white/5 dark:text-sky-200"
                    >
                      {busyId === 'weather' ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
                      查询天气
                    </button>
                  </div>

                  {weatherResult ? (
                    <div className="rounded-2xl bg-sky-50/70 p-4 dark:bg-sky-500/10">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold">{Math.round(weatherResult.current.temperatureC)}°</span>
                        <span className="text-sm text-slate-600 dark:text-slate-300">{weatherResult.current.weather}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {weatherResult.location.name}
                        {weatherResult.current.apparentC !== undefined ? ` · 体感 ${Math.round(weatherResult.current.apparentC)}°` : ''}
                        {weatherResult.current.humidity !== undefined ? ` · 湿度 ${Math.round(weatherResult.current.humidity)}%` : ''}
                        {weatherResult.cached ? ' · 缓存' : ''}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
                      <WifiOff size={14} />
                      {weather.enabled ? '还没有查询过。' : '插件未启用。'}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-sky-100 bg-white/85 p-5 shadow-sm dark:border-sky-900/40 dark:bg-[#0b1b2b]/80">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-sky-700 dark:text-sky-300" />
                <h2 className="text-lg font-semibold">主动性</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                手动跑一次策略：免打扰、冷却、每日预算、在场判断都在这条链路里。
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <select
                  value={characterId}
                  onChange={event => setCharacterId(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-sky-900/50 dark:bg-[#07131f] dark:text-sky-50"
                >
                  {characters.length === 0 && <option value="">没有角色</option>}
                  {characters.map(character => (
                    <option key={character.id} value={character.id}>{character.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void runInitiative()}
                  disabled={initiativeBusy || !characterId}
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
                >
                  {initiativeBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  运行一次
                </button>
              </div>

              {initiativeResult && (
                <div className="mt-3 rounded-2xl bg-sky-50/70 px-4 py-3 text-xs dark:bg-sky-500/10">
                  <div className="font-medium text-slate-700 dark:text-sky-100">
                    {initiativeResult.status === 'spoke' ? '说了' : initiativeResult.status === 'skipped' ? '没说' : '失败'}
                  </div>
                  <div className="mt-1 text-slate-500 dark:text-slate-300">
                    {initiativeResult.message || initiativeResult.reason || initiativeResult.error || '—'}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-sky-100 bg-white/85 p-5 shadow-sm dark:border-sky-900/40 dark:bg-[#0b1b2b]/80">
              <h2 className="text-lg font-semibold">最近审计</h2>
              <div className="mt-3 space-y-2">
                {audit.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">还没有插件操作。</p>
                )}
                {audit.slice(0, 8).map(entry => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-slate-600 dark:text-slate-300">
                      {entry.pluginId} · {entry.action}
                    </span>
                    <span className={entry.status === 'ok' ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>
                      {entry.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <section className="rounded-3xl border border-sky-100 bg-white/85 p-5 shadow-sm dark:border-sky-900/40 dark:bg-[#0b1b2b]/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Bot size={18} className="text-sky-700 dark:text-sky-300" />
                <h2 className="text-lg font-semibold">Agent 能力</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                DSH 等 agent provider 暴露的能力；装什么、启停、调用都走同一条权限/审计边界。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {agents.providers.map(provider => (
                <span
                  key={provider.id}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                    provider.health.status === 'ok'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                  }`}
                >
                  {provider.name} · {pluginHealthLabel(provider.health)}
                </span>
              ))}
            </div>
          </div>

          {agents.capabilities.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-sky-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-sky-800 dark:text-slate-400">
              还没有 agent provider。B 的 DSH 桥接入后，能力会出现在这里。
            </div>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {agents.capabilities.map(capability => {
                const installed = capability.installed !== false;
                const enabled = capability.enabled !== false;
                const busy = agentBusy.startsWith(`${capability.id}:`);

                return (
                  <div
                    key={`${capability.providerId}:${capability.id}`}
                    className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4 dark:border-sky-900/40 dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{capability.name}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10">
                            {capability.providerId}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            capability.health.status === 'ok'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                          }`}>
                            {pluginHealthLabel(capability.health)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {capability.description || `${capability.id} · v${capability.version}`}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {!installed ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAgentAction(
                            capability,
                            'install',
                            core => core.installAgent(capability.providerId, capability.id),
                          )}
                          className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          安装
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runAgentAction(
                              capability,
                              enabled ? 'disable' : 'enable',
                              core => enabled
                                ? core.disableAgent(capability.providerId, capability.id)
                                : core.enableAgent(capability.providerId, capability.id),
                            )}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                              enabled
                                ? 'border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
                                : 'bg-sky-700 text-white'
                            }`}
                          >
                            {enabled ? '停用' : '启用'}
                          </button>
                          {(capability.actions ?? []).map(action => (
                            <button
                              key={action}
                              type="button"
                              disabled={busy || !enabled}
                              onClick={() => void runAgentAction(
                                capability,
                                `action:${action}`,
                                core => core.invokeAgent(
                                  capability.providerId,
                                  capability.id,
                                  action,
                                ),
                              )}
                              className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 disabled:opacity-50 dark:border-sky-800 dark:bg-white/5 dark:text-sky-200"
                            >
                              {action}
                            </button>
                          ))}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runAgentAction(
                              capability,
                              'remove',
                              core => core.removeAgent(capability.providerId, capability.id),
                            )}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                          >
                            移除
                          </button>
                        </>
                      )}
                    </div>

                    {agentOutput?.id === capability.id && (
                      <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-950/5 p-3 text-[11px] leading-5 text-slate-600 dark:bg-black/20 dark:text-slate-300">
                        {agentOutput.text}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
