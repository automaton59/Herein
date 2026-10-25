import React from 'react';
import {
  Activity,
  Bot,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Loader2,
  MessageCircle,
  Plug,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  Volume2,
  Wrench,
} from 'lucide-react';
import {
  CoreClient,
  type CorePluginHealth,
  type CorePluginSummary,
  type CorePluginView,
  type CoreStatus,
  type CoreStatusComponent,
} from '../../services/coreClient';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';
import { useSettingsStore } from '../../stores/settings';
import { SelectMenu } from '../UI/SelectMenu';

function createCoreClient() {
  const baseUrl = (localStorage.getItem(CORE_URL_KEY) || window.hereinCore?.url || '').trim();

  if (!baseUrl) {
    return null;
  }

  return new CoreClient({
    baseUrl,
    token: (localStorage.getItem(CORE_TOKEN_KEY) || window.hereinCore?.token || '').trim() || undefined,
  });
}

function statusDotTone(component: CoreStatusComponent | undefined) {
  switch (component?.status) {
    case 'ok':
      return 'bg-aqua-400 shadow-[0_0_0_3px_rgba(124,200,234,0.18)]';
    case 'degraded':
      return 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.16)]';
    case 'unavailable':
      return 'bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.14)]';
    case 'unconfigured':
      return 'bg-slate-300';
    default:
      return 'bg-slate-300';
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

function pluginHealthChip(health: CorePluginHealth) {
  switch (health.status) {
    case 'ok':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20';
    case 'degraded':
      return 'bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20';
    case 'failed':
      return 'bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20';
    default:
      return 'bg-slate-100 text-slate-600 ring-slate-200/70 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10';
  }
}

function pluginKindIcon(kind: string) {
  switch (kind) {
    case 'tool':
      return <Wrench size={15} />;
    case 'source':
      return <Globe size={15} />;
    case 'agent':
      return <Bot size={15} />;
    default:
      return <Plug size={15} />;
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
    <div className="rounded-xl border border-[#E6E5F0] bg-[#FFFFFF] p-3 dark:border-white/10 dark:bg-[#0E1424]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-[#41495C] dark:text-slate-200">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#F6F7FC] text-[#3B4474] dark:bg-white/5 dark:text-sky-200">
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </div>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotTone(component)}`}
          title={statusLabel(component)}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-[#69718A] dark:text-slate-400">
          {detail || component?.message || '—'}
        </span>
        <span className="shrink-0 text-[10px] font-medium text-[#7A819A] dark:text-slate-500">
          {statusLabel(component)}
        </span>
      </div>
    </div>
  );
}

type PluginConfigProperty = NonNullable<NonNullable<CorePluginView['manifest']['configSchema']>['properties']>[string];

function isBlank(value: unknown) {
  return value === undefined
    || value === null
    || (typeof value === 'string' && !value.trim());
}

function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? '操作失败');

  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; error?: unknown };

    if (typeof parsed.detail === 'string' && parsed.detail) {
      return parsed.detail;
    }

    if (typeof parsed.error === 'string' && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Not JSON; use the raw text.
  }

  return raw;
}

function validateDraft(
  entries: Array<[string, PluginConfigProperty]>,
  required: string[],
  draft: Record<string, unknown>,
) {
  const errors: Record<string, string> = {};

  for (const key of required) {
    if (isBlank(draft[key])) {
      errors[key] = '这一项必须填写';
    }
  }

  for (const [key, property] of entries) {
    const value = draft[key];

    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (property.type === 'number' && typeof value === 'number') {
      if (property.minimum !== undefined && value < property.minimum) {
        errors[key] = `不能小于 ${property.minimum}`;
      }

      if (property.maximum !== undefined && value > property.maximum) {
        errors[key] = `不能大于 ${property.maximum}`;
      }
    }

    if (property.type === 'string' && typeof value === 'string' && property.format === 'url' && value.trim()) {
      if (!/^https?:\/\//i.test(value.trim())) {
        errors[key] = '请填写完整地址，例如 http://127.0.0.1:8791';
      }
    }
  }

  return errors;
}

function ConfigFieldHint({
  property,
  onPick,
}: {
  property: PluginConfigProperty;
  onPick?: () => void;
}) {
  if (!property.description && !onPick) {
    return null;
  }

  return (
    <div className="mt-1 flex items-start justify-between gap-2">
      <p className="min-w-0 text-[11px] leading-4 text-[#7A819A] dark:text-slate-500">
        {property.description}
      </p>
      {onPick && (
        <button
          type="button"
          onClick={onPick}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-100 bg-white px-1.5 py-1 text-[11px] text-slate-600 transition hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <FolderOpen size={11} />
          选择
        </button>
      )}
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
  const schema = plugin.manifest.configSchema;
  const entries = Object.entries(schema?.properties ?? {}) as Array<[string, PluginConfigProperty]>;
  const required = schema?.required ?? [];
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ ...plugin.config });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [saved, setSaved] = React.useState(false);

  const missing = required.filter(key => isBlank(draft[key]));
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setDraft({ ...plugin.config });
    setErrors({});
    setSaved(false);
  }, [plugin.manifest.id, plugin.updatedAt]);

  if (entries.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-sky-100 px-3 py-2 text-[11.5px] leading-5 text-[#69718A] dark:border-white/10 dark:text-slate-400">
        {plugin.manifest.setup || '这个插件不需要配置，安装并启用即可。'}
      </p>
    );
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
    setErrors(current => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const pickPath = async (key: string, property: PluginConfigProperty) => {
    const dialog = window.hereinShell?.dialog;

    if (!dialog) {
      return;
    }

    const picked = await dialog.pickFile({
      title: property.title || '选择路径',
      mode: property.format === 'directory' ? 'directory' : 'file',
    });

    if (picked) {
      update(key, picked);
    }
  };

  const submit = async () => {
    const nextErrors = validateDraft(entries, required, draft);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setOpen(true);
      return;
    }

    try {
      await onSave(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    } catch (error) {
      const message = readableError(error);
      const field = /config\.([A-Za-z0-9_]+)/.exec(message)?.[1];

      if (field) {
        setErrors({ [field]: message.replace(/^config\.[A-Za-z0-9_]+\s*/, '') });
      } else {
        setErrors({ __form: message });
      }

      setOpen(true);
    }
  };

  return (
    <details
      className="mt-3 rounded-xl border border-sky-100 bg-white/70 px-3 py-2 dark:border-sky-900/40 dark:bg-white/[0.03]"
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-sky-700 dark:text-sky-200">
        <span className="inline-flex items-center gap-1.5">
          配置
          {missing.length > 0 && (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20">
              还差 {missing.length} 项
            </span>
          )}
        </span>
        <span className="text-[11px] font-normal text-[#7A819A] dark:text-slate-500">
          {open ? '收起' : '展开'}
        </span>
      </summary>

      {plugin.manifest.setup && (
        <p className="mt-2 rounded-lg bg-[#F6F7FC] px-2.5 py-2 text-[11.5px] leading-5 text-[#69718A] dark:bg-white/5 dark:text-slate-400">
          {plugin.manifest.setup}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map(([key, property]) => {
          const value = draft[key];
          const label = property.title || key;
          const isRequired = required.includes(key);
          const error = errors[key];
          const inputTone = error
            ? 'border-rose-300 focus:border-rose-400 dark:border-rose-400/40'
            : 'border-sky-100 focus:border-sky-400 dark:border-sky-900/50';

          const hint = (
            <ConfigFieldHint
              property={property}
              onPick={property.format === 'path' || property.format === 'directory'
                ? () => void pickPath(key, property)
                : undefined}
            />
          );

          if (property.enum) {
            return (
              <div key={key} className="block text-xs text-slate-600 dark:text-slate-300">
                <span className="mb-1 block font-medium">
                  {label}
                  {isRequired && <span className="ml-0.5 text-rose-500">*</span>}
                </span>
                <SelectMenu
                  value={String(value ?? '')}
                  onChange={next => update(key, next)}
                  options={property.enum.map(option => ({
                    value: String(option),
                    label: String(option),
                  }))}
                />
                {hint}
                {error && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}
              </div>
            );
          }

          if (property.type === 'boolean') {
            return (
              <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={event => update(key, event.target.checked)}
                    className="h-4 w-4 rounded border-sky-200 text-sky-700"
                  />
                  {label}
                  {isRequired && <span className="text-rose-500">*</span>}
                </span>
                {hint}
                {error && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}
              </label>
            );
          }

          if (property.type === 'number') {
            return (
              <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">
                <span className="mb-1 block font-medium">
                  {label}
                  {isRequired && <span className="ml-0.5 text-rose-500">*</span>}
                </span>
                <input
                  type="number"
                  value={typeof value === 'number' ? value : ''}
                  min={property.minimum}
                  max={property.maximum}
                  placeholder={property.placeholder}
                  onChange={event => update(key, event.target.value === '' ? undefined : Number(event.target.value))}
                  className={`mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-xs outline-none transition dark:bg-[#07131f] dark:text-sky-50 ${inputTone}`}
                />
                {hint}
                {error && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}
              </label>
            );
          }

          const masked = property.format === 'password';
          const show = revealed[key] === true;

          return (
            <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">
              <span className="mb-1 block font-medium">
                {label}
                {isRequired && <span className="ml-0.5 text-rose-500">*</span>}
              </span>
              <span className="relative block">
                <input
                  type={masked && !show ? 'password' : 'text'}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={property.placeholder || property.examples?.[0]}
                  onChange={event => update(key, event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className={`mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-xs outline-none transition dark:bg-[#07131f] dark:text-sky-50 ${inputTone} ${masked ? 'pr-8' : ''}`}
                />
                {masked && (
                  <button
                    type="button"
                    onClick={() => setRevealed(current => ({ ...current, [key]: !show }))}
                    className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-[#7A819A] hover:bg-sky-50 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-white/10"
                    aria-label={show ? '隐藏' : '显示'}
                    title={show ? '隐藏' : '显示'}
                  >
                    {show ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
              </span>
              {hint}
              {!value && property.examples && property.examples.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {property.examples.map(example => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => update(key, example)}
                      className="rounded-md border border-sky-100 bg-white px-1.5 py-0.5 text-[10.5px] text-slate-500 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                      {example}
                    </button>
                  ))}
                </span>
              )}
              {error && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}
            </label>
          );
        })}
      </div>

      {errors.__form && (
        <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
          {errors.__form}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存配置'}
        </button>
        {saved && <span className="text-[11px] text-emerald-600 dark:text-emerald-300">已保存</span>}
        {plugin.manifest.helpUrl && (
          /^https?:\/\//i.test(plugin.manifest.helpUrl) ? (
            <button
              type="button"
              onClick={() => void window.hereinShell?.dialog?.openExternal(plugin.manifest.helpUrl as string)}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#7A819A] hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
              title={plugin.manifest.helpUrl}
            >
              <ExternalLink size={11} />
              配置文档
            </button>
          ) : (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#7A819A] dark:text-slate-500"
              title={`仓库文档：${plugin.manifest.helpUrl}`}
            >
              <ExternalLink size={11} />
              {plugin.manifest.helpUrl}
            </span>
          )
        )}
      </div>
    </details>
  );
}

export function SystemPage({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [status, setStatus] = React.useState<CoreStatus | null>(null);
  const [plugins, setPlugins] = React.useState<CorePluginView[]>([]);
  const [summary, setSummary] = React.useState<CorePluginSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const isApiConfigured = useSettingsStore(state => state.isConfigured);
  const connectionStatus = useSettingsStore(state => state.connectionStatus);

  const load = React.useCallback(async () => {
    const core = createCoreClient();

    if (!core) {
      setError('还没有配置 Core 地址。先在设置里填 Core URL / Token。');
      return;
    }

    setLoading(true);

    try {
      const [nextStatus, nextPlugins] = await Promise.all([
        core.status(),
        core.listPlugins(),
      ]);
      setStatus(nextStatus);
      setPlugins(nextPlugins.plugins);
      setSummary(nextPlugins.summary);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Core 连接失败');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(readableError(actionError));
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
    await runPluginAction(pluginId, () => core.removePlugin(pluginId));
  };

  // Saving rethrows so the config form can show field-level errors; a later
  // health check tells the user whether the new settings actually work.
  const savePluginConfig = async (pluginId: string, config: Record<string, unknown>) => {
    const core = createCoreClient();

    if (!core) {
      throw new Error('还没有配置 Core 地址');
    }

    setBusyId(pluginId);
    setError('');

    try {
      await core.updatePluginConfig(pluginId, config);

      try {
        await core.checkPluginHealth(pluginId);
      } catch {
        // Health is best-effort; the config itself was saved.
      }

      await load();
    } catch (saveError) {
      setError(readableError(saveError));
      throw saveError;
    } finally {
      setBusyId(null);
    }
  };

  const checkPlugin = async (pluginId: string) => {
    const core = createCoreClient();
    if (!core) return;
    await runPluginAction(pluginId, () => core.checkPluginHealth(pluginId));
  };

  const installedCount = plugins.filter(plugin => plugin.installed).length;
  const enabledCount = plugins.filter(plugin => plugin.enabled).length;

  // 「对话」跟着 API 的连通状态走：能连上模型就能聊，不再单独显示一个永远未知的交互端口。
  const conversation: CoreStatusComponent = !isApiConfigured
    ? { status: 'unconfigured', message: '还没有配置模型 API' }
    : connectionStatus === 'online'
      ? { status: 'ok', message: 'API 在线' }
      : connectionStatus === 'checking'
        ? { status: 'degraded', message: '正在连接' }
        : { status: 'unavailable', message: '已断开，去 API 设置点「连接」' };

  return (
    <div className="h-full overflow-y-auto px-5 py-6 text-slate-900 dark:text-sky-50">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7A819A] dark:text-slate-500">
              <Activity size={13} />
              System
            </div>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-[#1C2333] dark:text-sky-50">系统</h1>
            <p className="mt-1 text-[12.5px] text-[#69718A] dark:text-slate-400">
              Core、声音、模型与插件。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E6E5F0] bg-[#FFFFFF] px-3 text-[12px] font-semibold text-[#41495C] transition hover:bg-[#F1F2F9] disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="h-9 rounded-lg border border-[#E6E5F0] bg-[#FFFFFF] px-3 text-[12px] font-semibold text-[#41495C] transition hover:bg-[#F1F2F9] dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
              >
                设置
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        )}

        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {statusCard('Core', status?.components.core, <Server size={16} />, status ? `v${status.version} · ${formatUptime(status.uptimeMs)}` : undefined)}
          {statusCard('数据库', status?.components.db, <Database size={16} />)}
          {statusCard('模型', status?.components.llm, <Sparkles size={16} />, status?.components.llm.detail?.model as string | undefined)}
          {statusCard('对话', conversation, <MessageCircle size={16} />)}
          {statusCard('声音', status?.components.tts, <Volume2 size={16} />, status?.components.tts.latencyMs ? `${status.components.tts.latencyMs}ms` : undefined)}
          {statusCard('插件', status?.components.plugins, <Plug size={16} />, summary ? `${summary.enabled}/${summary.installed} 已启用` : undefined)}
        </div>

        <section className="rounded-2xl border border-[#E6E5F0] bg-[#FFFFFF] p-5 shadow-[0_18px_40px_-40px_rgba(59,68,116,0.3)] dark:border-white/10 dark:bg-[#0E1424]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EEEEF6] pb-4 dark:border-white/5">
            <div>
              <h2 className="text-lg font-semibold">插件管理</h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-slate-400">
                能力由插件提供，什么时候用由运行时决定。安装、启用、配置和卸载都在这里完成。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#F6F7FC] px-3 py-1 text-xs font-medium text-[#3B4474] dark:bg-white/5 dark:text-sky-200">
                {plugins.length} 个插件 · {enabledCount} 启用 · {installedCount} 已安装
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {plugins.length === 0 && (
              <div className="rounded-2xl border border-dashed border-sky-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-sky-800 dark:text-slate-400">
                还没有发现插件。把插件目录放到 <code>plugins/</code> 下。
              </div>
            )}

            {plugins.map(plugin => {
              const busy = busyId === plugin.manifest.id;
              const schema = plugin.manifest.configSchema;
              const required = schema?.required ?? [];
              const missingRequired = plugin.installed
                ? required.filter(key => isBlank(plugin.config[key]))
                : [];
              // A disabled plugin keeps whatever health it had when it stopped,
              // which quickly turns into a stale claim; only show it while running.
              const healthNote = plugin.installed && plugin.enabled && plugin.health.status !== 'ok'
                ? plugin.health.message
                : undefined;

              return (
                <article
                  key={plugin.manifest.id}
                  className="flex flex-col rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-4 transition hover:border-[#C9CCE3] dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#3B4474] ring-1 ring-[#E6E5F0] dark:bg-white/5 dark:text-sky-200 dark:ring-white/10">
                        {pluginKindIcon(plugin.manifest.kind)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[14px] font-semibold text-[#1C2333] dark:text-sky-50">
                            {plugin.manifest.name}
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10">
                            {plugin.manifest.kind}
                          </span>
                          {plugin.installed ? (
                            plugin.enabled ? (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${pluginHealthChip(plugin.health)}`}>
                                {pluginHealthLabel(plugin.health)}
                              </span>
                            ) : (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-400 dark:ring-white/10">
                                已停用
                              </span>
                            )
                          ) : (
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-500 dark:ring-white/10">
                              未安装
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-[12px] leading-5 text-[#69718A] dark:text-slate-400">
                          {plugin.manifest.description || '没有描述'}
                        </p>
                        {missingRequired.length > 0 && (
                          <p className="mt-1 text-[11.5px] font-medium text-amber-700 dark:text-amber-300">
                            还差：{missingRequired.map(key => schema?.properties[key]?.title || key).join('、')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {busy ? (
                        <Loader2 size={15} className="animate-spin text-[#7A819A] dark:text-slate-400" />
                      ) : !plugin.installed ? (
                        <button
                          type="button"
                          onClick={() => void installPlugin(plugin.manifest.id)}
                          className="rounded-lg bg-[#3B4474] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#323962]"
                        >
                          安装
                        </button>
                      ) : (
                        <>
                          {plugin.enabled && (
                            <button
                              type="button"
                              onClick={() => void checkPlugin(plugin.manifest.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                              title="立即检查一次"
                            >
                              <Activity size={13} />
                              检查
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void togglePlugin(plugin)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              plugin.enabled
                                ? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                                : 'bg-[#3B4474] text-white hover:bg-[#323962]'
                            }`}
                          >
                            {plugin.enabled ? '停用' : '启用'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void removePlugin(plugin.manifest.id)}
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:text-rose-600 dark:border-white/10 dark:bg-white/5 dark:hover:text-rose-300"
                            aria-label={`卸载 ${plugin.manifest.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {plugin.lastError && (
                    <p className="mt-2.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11.5px] leading-5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
                      {plugin.lastError}
                    </p>
                  )}

                  {healthNote && healthNote !== plugin.lastError && (
                    <p className={`mt-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px] leading-5 ${
                      plugin.health.status === 'failed'
                        ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
                        : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
                    }`}>
                      {healthNote}
                    </p>
                  )}

                  {plugin.installed && (
                    <PluginConfigEditor
                      plugin={plugin}
                      busy={busy}
                      onSave={config => savePluginConfig(plugin.manifest.id, config)}
                    />
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
