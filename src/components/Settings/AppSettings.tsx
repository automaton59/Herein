import { useState } from 'react';
import { Monitor, Moon, Sun, Volume2 } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings';
import type { ThemeMode, VoiceProvider } from '../../services/interfaces';
import { APP_ZH_NAME } from '../../services/appIdentity';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  Icon: typeof Monitor;
}> = [
  {
    value: 'system',
    label: '跟随系统',
    description: '随操作系统自动切换。',
    Icon: Monitor,
  },
  {
    value: 'light',
    label: '浅色',
    description: '明亮、柔和的聊天空间。',
    Icon: Sun,
  },
  {
    value: 'dark',
    label: '深色',
    description: '低亮度的夜间聊天空间。',
    Icon: Moon,
  },
];

const VOICE_PROVIDER_OPTIONS: Array<{
  value: VoiceProvider;
  label: string;
  description: string;
}> = [
  {
    value: 'system',
    label: '系统 TTS',
    description: '使用系统内置朗读。',
  },
  {
    value: 'gpt-sovits',
    label: 'GPT-SoVITS',
    description: '连接本地 9880 服务。',
  },
  {
    value: 'qwen3-tts',
    label: 'Qwen3-TTS',
    description: '开箱内置音色，连接 9881 服务。',
  },
  {
    value: 'qwen3-tts-clone',
    label: 'Qwen3 Clone',
    description: '高级克隆音色，连接 9882 服务。',
  },
];

export function AppSettings() {
  const { themeMode, setThemeMode, voiceConfig, updateVoiceConfig } = useSettingsStore();
  const [coreUrl, setCoreUrl] = useState(() => {
    try {
      return localStorage.getItem(CORE_URL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [coreToken, setCoreToken] = useState(() => {
    try {
      return localStorage.getItem(CORE_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [coreStatus, setCoreStatus] = useState('');

  const saveCoreSettings = () => {
    try {
      const url = coreUrl.trim().replace(/\/+$/, '');

      if (url) {
        localStorage.setItem(CORE_URL_KEY, url);
      } else {
        localStorage.removeItem(CORE_URL_KEY);
      }

      if (coreToken.trim()) {
        localStorage.setItem(CORE_TOKEN_KEY, coreToken.trim());
      } else {
        localStorage.removeItem(CORE_TOKEN_KEY);
      }

      setCoreUrl(url);
      setCoreStatus(url ? '已保存；下次同步生效' : '已清除，桌面继续走 IPC');
    } catch {
      setCoreStatus('保存失败');
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-rose-100 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#171018]/80 dark:shadow-none">
      <div>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-rose-50">应用设置</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">调整 {APP_ZH_NAME} 的本地体验。</p>
      </div>

      <div className="grid gap-2">
        <div>
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">主题</h3>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          {THEME_OPTIONS.map(({ value, label, description, Icon }) => {
            const isActive = themeMode === value;

            return (
              <button
                key={value}
                type="button"
                onClick={() => setThemeMode(value)}
                className={`flex min-h-24 flex-col items-start justify-between rounded-2xl border p-4 text-left transition ${
                  isActive
                    ? 'border-rose-300 bg-rose-50 text-rose-700 ring-2 ring-rose-100 dark:border-rose-300/50 dark:bg-rose-300/10 dark:text-rose-100 dark:ring-rose-300/10'
                    : 'border-rose-100 bg-white text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-500 shadow-sm shadow-rose-100 dark:bg-white/10 dark:text-rose-200 dark:shadow-none">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-1 block text-xs opacity-75">{description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 border-t border-rose-100 pt-5 dark:border-white/10">
        <div>
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">语音引擎</h3>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {VOICE_PROVIDER_OPTIONS.map(({ value, label, description }) => {
            const isActive = voiceConfig.provider === value;

            return (
              <button
                key={value}
                type="button"
                onClick={() => updateVoiceConfig({ provider: value })}
                className={`flex min-h-20 flex-col items-start justify-between rounded-2xl border p-4 text-left transition ${
                  isActive
                    ? 'border-rose-300 bg-rose-50 text-rose-700 ring-2 ring-rose-100 dark:border-rose-300/50 dark:bg-rose-300/10 dark:text-rose-100 dark:ring-rose-300/10'
                    : 'border-rose-100 bg-white text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-500 shadow-sm shadow-rose-100 dark:bg-white/10 dark:text-rose-200 dark:shadow-none">
                  <Volume2 size={18} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-1 block text-xs opacity-75">{description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          GPT-SoVITS endpoint
          <input
            type="text"
            value={voiceConfig.gptSovits.endpoint}
            onChange={(event) => updateVoiceConfig({ gptSovits: { endpoint: event.target.value } })}
            className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
          />
        </label>

        <div className="grid gap-3 border-t border-rose-100 pt-3 dark:border-white/10">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            Qwen3-TTS endpoint
            <input
              type="text"
              value={voiceConfig.qwen3Tts.endpoint}
              onChange={(event) => updateVoiceConfig({ qwen3Tts: { endpoint: event.target.value } })}
              className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              Language
              <input
                type="text"
                value={voiceConfig.qwen3Tts.language}
                onChange={(event) => updateVoiceConfig({ qwen3Tts: { language: event.target.value } })}
                className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              Speaker
              <input
                type="text"
                value={voiceConfig.qwen3Tts.speaker}
                onChange={(event) => updateVoiceConfig({ qwen3Tts: { speaker: event.target.value } })}
                className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            Default voice instruct
            <input
              type="text"
              value={voiceConfig.qwen3Tts.defaultInstruct}
              onChange={(event) => updateVoiceConfig({ qwen3Tts: { defaultInstruct: event.target.value } })}
              className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
            />
          </label>

          <div className="grid gap-3 border-t border-rose-100 pt-3 dark:border-white/10">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              Qwen3 Clone endpoint
              <input
                type="text"
                value={voiceConfig.qwen3VoiceClone.endpoint}
                onChange={(event) => updateVoiceConfig({ qwen3VoiceClone: { endpoint: event.target.value } })}
                className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              Clone language
              <input
                type="text"
                value={voiceConfig.qwen3VoiceClone.language}
                onChange={(event) => updateVoiceConfig({ qwen3VoiceClone: { language: event.target.value } })}
                className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={voiceConfig.qwen3VoiceClone.xVectorOnlyMode}
                onChange={(event) => updateVoiceConfig({ qwen3VoiceClone: { xVectorOnlyMode: event.target.checked } })}
                className="h-4 w-4 rounded border-rose-200 text-rose-500 focus:ring-rose-200"
              />
              Clone 使用 x-vector only
            </label>
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={voiceConfig.fallbackToSystem}
            onChange={(event) => updateVoiceConfig({ fallbackToSystem: event.target.checked })}
            className="h-4 w-4 rounded border-rose-200 text-rose-500 focus:ring-rose-200"
          />
          失败时回退系统 TTS
        </label>
      </div>

      <div className="grid gap-3 border-t border-rose-100 pt-4 dark:border-white/10">
        <div>
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">Core 服务（可选）</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            留空时桌面走本地 API；填了地址后，聊天和记录同步都走 Core HTTP，Core 失败会自动回退本地 API。
          </p>
        </div>

        <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Core 地址
          <input
            type="text"
            value={coreUrl}
            onChange={(event) => setCoreUrl(event.target.value)}
            placeholder="http://127.0.0.1:8787"
            className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Core Token
          <input
            type="password"
            value={coreToken}
            onChange={(event) => setCoreToken(event.target.value)}
            placeholder="HEREIN_CORE_TOKEN（可留空）"
            className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={saveCoreSettings}
            className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600"
          >
            保存 Core 设置
          </button>
          {coreStatus && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{coreStatus}</span>
          )}
        </div>
      </div>
    </section>
  );
}
