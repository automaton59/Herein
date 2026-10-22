import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Plus, RefreshCw, Save, Trash2, Wifi } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings';
import type { LLMConfig, LLMModelInfo } from '../../services/interfaces';
import { resolveLLMBaseURL } from '../../services/llm/endpoints';
import { listLLMModels } from '../../services/llm/modelDiscovery';
import { SelectMenu } from '../UI/SelectMenu';

type Feedback = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

const PROVIDERS: Array<{ value: LLMConfig['provider']; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: 'Custom' },
];

function getProviderDefaults(provider: LLMConfig['provider']) {
  switch (provider) {
    case 'deepseek':
      return { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com' };
    case 'openai':
      return { model: 'gpt-4o-mini', baseURL: '' };
    default:
      return { model: '', baseURL: '' };
  }
}

function normalizeConfig(config: LLMConfig): LLMConfig {
  const baseURL = config.baseURL?.trim();

  return {
    ...config,
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    baseURL: baseURL || undefined,
  };
}

function validateConfig(config: LLMConfig): string[] {
  const errors: string[] = [];
  const normalized = normalizeConfig(config);
  const needsBaseURL = normalized.provider === 'deepseek' || normalized.provider === 'custom';

  if (!normalized.apiKey) {
    errors.push('API Key 不能为空');
  }

  if (/\s/.test(normalized.apiKey)) {
    errors.push('API Key 里不能有空格');
  }

  if (!normalized.model) {
    errors.push('模型名不能为空');
  }

  if (needsBaseURL && !normalized.baseURL) {
    errors.push('当前 Provider 需要 Base URL');
  }

  if (normalized.baseURL && !/^https?:\/\//.test(normalized.baseURL)) {
    errors.push('Base URL 必须以 http:// 或 https:// 开头');
  }

  return errors;
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'online':
      return '在线';
    case 'checking':
      return '正在连接';
    case 'typing':
      return '正在输入';
    case 'offline':
      return '离线';
    default:
      return '未配置';
  }
}

export function APISettings() {
  const {
    llmConfig,
    apiProfiles,
    activeProfileId,
    isConfigured,
    connectionStatus,
    lastConnectionError,
    updateLLMConfig,
    createAPIProfile,
    selectAPIProfile,
    deleteAPIProfile,
    checkConnection,
  } = useSettingsStore();

  const activeProfile = useMemo(
    () => apiProfiles.find(profile => profile.id === activeProfileId),
    [apiProfiles, activeProfileId],
  );
  const [localConfig, setLocalConfig] = useState(llmConfig);
  const [profileName, setProfileName] = useState(activeProfile?.name || 'API');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [models, setModels] = useState<LLMModelInfo[]>([]);

  useEffect(() => {
    setLocalConfig(llmConfig);
    setModels([]);
  }, [llmConfig]);

  useEffect(() => {
    setProfileName(activeProfile?.name || 'API');
  }, [activeProfile]);

  const handleProviderChange = (provider: LLMConfig['provider']) => {
    const defaults = getProviderDefaults(provider);

    setLocalConfig({
      ...localConfig,
      provider,
      model: defaults.model || localConfig.model,
      baseURL: provider === 'openai' ? undefined : defaults.baseURL || localConfig.baseURL,
    });
    setModels([]);
    setFeedback(null);
  };

  const handleLoadModels = async () => {
    const config = normalizeConfig(localConfig);
    const errors = validateConfig({ ...config, model: config.model || 'model-probe' })
      .filter((error) => error !== '模型名不能为空');

    if (errors.length > 0) {
      setFeedback({ type: 'error', message: errors.join('；') });
      return;
    }

    setIsLoadingModels(true);
    setFeedback(null);

    try {
      const discoveredModels = await listLLMModels(config);
      setModels(discoveredModels);

      if (discoveredModels.length === 0) {
        setFeedback({ type: 'warning', message: '连接成功，但这个接口没有返回可用模型列表' });
        return;
      }

      const modelIds = discoveredModels.map((model) => model.id);
      const currentModelSupported = modelIds.includes(config.model);

      if (!config.model || !currentModelSupported) {
        setLocalConfig({ ...localConfig, model: modelIds[0] });
        setFeedback({
          type: 'warning',
          message: config.model
            ? `已获取 ${discoveredModels.length} 个模型；当前模型 ${config.model} 不在列表中，已临时选择 ${modelIds[0]}`
            : `已获取 ${discoveredModels.length} 个模型，已临时选择 ${modelIds[0]}`,
        });
        return;
      }

      setFeedback({ type: 'success', message: `已获取 ${discoveredModels.length} 个模型，当前模型可用` });
    } catch (error) {
      setModels([]);
      setFeedback({ type: 'error', message: `获取模型失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = async () => {
    const errors = validateConfig(localConfig);

    if (errors.length > 0) {
      setFeedback({ type: 'error', message: errors.join('；') });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      await updateLLMConfig(normalizeConfig(localConfig), profileName);
      setFeedback({ type: 'success', message: 'API Profile 已保存' });
    } catch (error) {
      setFeedback({ type: 'error', message: `保存失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    const errors = validateConfig(localConfig);

    if (errors.length > 0) {
      setFeedback({ type: 'error', message: errors.join('；') });
      return;
    }

    setIsTesting(true);
    setFeedback(null);

    try {
      await updateLLMConfig(normalizeConfig(localConfig), profileName);
      const ok = await checkConnection();
      setFeedback(ok
        ? { type: 'success', message: '连接测试通过' }
        : { type: 'error', message: '连接测试失败，请检查 Key、Base URL 和模型' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCreateProfile = async () => {
    await createAPIProfile();
    setFeedback({ type: 'success', message: '已创建新的 API Profile' });
  };

  const handleDeleteProfile = async () => {
    if (!activeProfileId) {
      return;
    }

    await deleteAPIProfile(activeProfileId);
    setFeedback({ type: 'success', message: 'API Profile 已删除' });
  };

  return (
    <section className="rounded-2xl border border-sky-100 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#07131f]/80 dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-sky-50">API 设置</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isConfigured ? `当前状态：${getStatusLabel(connectionStatus)}` : '请先补全 API 配置'}
          </p>
          {lastConnectionError && (
            <p className="mt-1 line-clamp-2 text-xs text-red-500 dark:text-red-300">{lastConnectionError}</p>
          )}
        </div>
        <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
          connectionStatus === 'online'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
            : connectionStatus === 'checking'
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
              : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'
        }`}
        >
          <span className={`h-2 w-2 rounded-full ${
            connectionStatus === 'online'
              ? 'bg-emerald-500'
              : connectionStatus === 'checking'
                ? 'bg-amber-500'
                : 'bg-slate-400'
          }`}
          />
          {getStatusLabel(connectionStatus)}
        </span>
      </div>

      {feedback && (
        <div
          className={`mt-4 border-l-4 px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100'
              : feedback.type === 'warning'
                ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100'
                : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-100'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="mt-5 grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">API Profile</span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <SelectMenu
              value={activeProfileId || ''}
              onChange={(nextProfileId) => void selectAPIProfile(nextProfileId)}
              options={apiProfiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
                description: profile.model,
              }))}
            />
            <button
              type="button"
              onClick={handleCreateProfile}
              className="inline-flex h-11 items-center gap-1 rounded-xl border border-sky-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
            >
              <Plus size={16} />
              新建
            </button>
            <button
              type="button"
              onClick={handleDeleteProfile}
              disabled={apiProfiles.length <= 1}
              className="inline-flex h-11 items-center gap-1 rounded-xl border border-red-100 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 dark:border-red-400/20 dark:bg-white/5 dark:text-red-300 dark:hover:bg-red-500/10 dark:disabled:border-white/10 dark:disabled:text-slate-600"
            >
              <Trash2 size={16} />
              删除
            </button>
          </div>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Profile 名称</span>
          <input
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            className="h-11 w-full rounded-xl border border-sky-100 px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:border-sky-300/60 dark:focus:ring-sky-300/10"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Provider</span>
          <SelectMenu
            value={localConfig.provider}
            onChange={(provider) => handleProviderChange(provider as LLMConfig['provider'])}
            options={PROVIDERS.map((provider) => ({
              value: provider.value,
              label: provider.label,
            }))}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">API Key</span>
          <div className="flex min-w-0 rounded-xl border border-sky-100 bg-white focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:focus-within:border-sky-300/60 dark:focus-within:ring-sky-300/10">
            <input
              type={showKey ? 'text' : 'password'}
              value={localConfig.apiKey}
              onChange={(event) => {
                setLocalConfig({ ...localConfig, apiKey: event.target.value });
                setModels([]);
              }}
              placeholder="sk-..."
              spellCheck={false}
              className="min-w-0 flex-1 rounded-l-xl bg-transparent px-3 py-2 text-slate-950 outline-none dark:text-sky-50"
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              className="shrink-0 border-l border-sky-100 px-3 text-slate-500 hover:bg-sky-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
              title={showKey ? '隐藏 API Key' : '显示 API Key'}
            >
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">模型</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            {models.length > 0 ? (
              <SelectMenu
                className="min-w-0 flex-1"
                value={localConfig.model}
                onChange={(model) => setLocalConfig({ ...localConfig, model })}
                options={models.map((model) => ({
                  value: model.id,
                  label: model.id,
                  description: model.ownedBy,
                }))}
              />
            ) : (
              <input
                type="text"
                value={localConfig.model}
                onChange={(event) => setLocalConfig({ ...localConfig, model: event.target.value })}
                placeholder="先获取模型，或手动输入模型 id"
                className="h-11 min-w-0 flex-1 rounded-xl border border-sky-100 px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:placeholder:text-slate-500 dark:focus:border-sky-300/60 dark:focus:ring-sky-300/10"
              />
            )}
            <button
              type="button"
              onClick={handleLoadModels}
              disabled={isLoadingModels}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-4 font-medium text-slate-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
            >
              <RefreshCw size={16} className={isLoadingModels ? 'animate-spin' : ''} />
              {isLoadingModels ? '获取中' : '获取模型'}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            请求地址：{resolveLLMBaseURL(normalizeConfig(localConfig)) || '未设置 Base URL'}
            {models.length > 0 ? `，已加载 ${models.length} 个模型` : ''}
          </p>
        </label>

        {(localConfig.provider === 'custom' || localConfig.provider === 'deepseek') && (
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Base URL</span>
            <input
              type="url"
              value={localConfig.baseURL || ''}
              onChange={(event) => {
                setLocalConfig({ ...localConfig, baseURL: event.target.value });
                setModels([]);
              }}
              placeholder="https://api.example.com/v1"
              className="h-11 w-full rounded-xl border border-sky-100 px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:placeholder:text-slate-500 dark:focus:border-sky-300/60 dark:focus:ring-sky-300/10"
            />
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 font-medium text-white shadow-sm shadow-sky-200 hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-sky-400 dark:text-[#04101a] dark:shadow-none dark:hover:bg-sky-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            <Save size={17} />
            {isSaving ? '保存中' : '保存 Profile'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-4 font-medium text-slate-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
          >
            <Wifi size={17} />
            {isTesting ? '测试中' : '测试连接'}
          </button>
        </div>
      </div>
    </section>
  );
}
