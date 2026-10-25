import { useEffect, useState } from 'react';
import { Monitor, Moon, Pin, Power, Rocket, Sun, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings';
import type { ThemeMode, VoiceProvider } from '../../services/interfaces';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';
import {
  getDesktopShell,
  type DesktopShellState,
} from '../../services/desktopPresence';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; Icon: LucideIcon }> = [
  { value: 'system', label: '跟随系统', Icon: Monitor },
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
];

const VOICE_PROVIDER_OPTIONS: Array<{ value: VoiceProvider; label: string }> = [
  { value: 'system', label: '系统 TTS' },
  { value: 'gpt-sovits', label: 'GPT-SoVITS' },
  { value: 'qwen3-tts', label: 'Qwen3-TTS' },
  { value: 'qwen3-tts-clone', label: 'Qwen3 Clone' },
];

interface ChoiceProps {
  active: boolean;
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
}

function Choice({ active, label, Icon, onClick }: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? 'border-[#3B4474] bg-[#3B4474] text-[#FFFFFF] shadow-[0_8px_20px_-16px_rgba(59,68,116,0.9)] dark:border-[#7C8FD0] dark:bg-[#4A5590]'
          : 'border-[#E6E5F0] bg-[#FFFFFF] text-[#41495C] hover:border-[#D8DCF0] hover:bg-[#F6F7FC] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.06]'
      }`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
          active
            ? 'bg-white/12 text-[#C9D4F2]'
            : 'bg-[#F1F2F9] text-[#3B4474] dark:bg-white/5 dark:text-sky-300'
        }`}
      >
        <Icon size={15} />
      </span>
      <span className="truncate text-[13px] font-semibold">{label}</span>
    </button>
  );
}

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
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const desktopShell = getDesktopShell();

  useEffect(() => {
    if (!desktopShell) {
      return undefined;
    }

    void desktopShell.presence.getShellState().then(setShellState).catch(() => undefined);
    const unsubscribe = desktopShell.presence.onShellState(setShellState);

    return unsubscribe;
  }, [desktopShell]);

  const updateShellState = async (action: Promise<DesktopShellState>) => {
    try {
      setShellState(await action);
    } catch (error) {
      console.warn('desktop shell setting failed', error);
    }
  };

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
      setCoreStatus(url ? '已保存' : '已清除');
    } catch {
      setCoreStatus('保存失败');
    }
  };

  const provider = voiceConfig.provider;

  return (
    <section className="settings-card space-y-5">
      <header>
        <h2 className="settings-title">应用设置</h2>
        <p className="settings-sub">主题、语音和可选的 Core 连接。</p>
      </header>

      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A819A] dark:text-slate-400">
          主题
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map(option => (
            <Choice
              key={option.value}
              active={themeMode === option.value}
              label={option.label}
              Icon={option.Icon}
              onClick={() => setThemeMode(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-[#EEEDF5] pt-4 dark:border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A819A] dark:text-slate-400">
              桌面陪伴与托管
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-[#69718A] dark:text-slate-400">
              关闭主窗口后应用进入托管：本地服务继续运行，桌面形象保持在线。托盘图标可能被 Windows 收进「显示隐藏的图标」里，也可以直接用下面的「退出此间」结束后台。
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
            shellState?.hosting
              ? 'bg-[#7C8FD0]/15 text-[#5967A0] dark:bg-[#7C8FD0]/20 dark:text-[#C9D4F2]'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
          }`}>
            {shellState?.hosting ? '托管中' : '主窗口在线'}
          </span>
        </div>

        {desktopShell ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice
              active={shellState?.presenceEnabled ?? true}
              label="桌面形象"
              Icon={Monitor}
              onClick={() => void updateShellState(
                desktopShell.app.setPresenceEnabled(!(shellState?.presenceEnabled ?? true)),
              )}
            />
            <Choice
              active={shellState?.alwaysOnTop ?? true}
              label="形象置顶"
              Icon={Pin}
              onClick={() => void updateShellState(
                desktopShell.app.setAlwaysOnTop(!(shellState?.alwaysOnTop ?? true)),
              )}
            />
            <Choice
              active={shellState?.closeToHosting ?? true}
              label="关闭进托管"
              Icon={Power}
              onClick={() => void updateShellState(
                desktopShell.app.setCloseToHosting(!(shellState?.closeToHosting ?? true)),
              )}
            />
            <Choice
              active={shellState?.launchAtLogin ?? false}
              label="开机启动"
              Icon={Rocket}
              onClick={() => void updateShellState(
                desktopShell.app.setLaunchAtLogin(!(shellState?.launchAtLogin ?? false)),
              )}
            />
          </div>
        ) : (
          <p className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-3 text-[12px] text-[#7A819A] dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
            桌面形象与托管仅在 Electron 桌面版可用。
          </p>
        )}

        {desktopShell && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void desktopShell.app.showMain()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E6E5F0] bg-[#FFFFFF] px-3 text-[12px] font-medium text-[#41495C] hover:bg-[#F1F2F9] dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
            >
              <Monitor size={14} />
              打开主窗口
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('退出此间？桌面形象和本地服务会一起停止。')) {
                  void desktopShell.app.quit();
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-100 bg-[#FFFFFF] px-3 text-[12px] font-medium text-red-600 hover:bg-red-50 dark:border-red-400/20 dark:bg-white/5 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              <Power size={14} />
              退出此间
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-[#EEEDF5] pt-4 dark:border-white/10">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A819A] dark:text-slate-400">
          语音引擎
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VOICE_PROVIDER_OPTIONS.map(option => (
            <Choice
              key={option.value}
              active={provider === option.value}
              label={option.label}
              Icon={Volume2}
              onClick={() => updateVoiceConfig({ provider: option.value })}
            />
          ))}
        </div>

        <div className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-3 dark:border-white/10 dark:bg-white/[0.02]">
          {provider === 'system' && (
            <p className="text-[12.5px] text-[#69718A] dark:text-slate-400">
              使用系统内置朗读，无需额外配置。
            </p>
          )}

          {provider === 'gpt-sovits' && (
            <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
              Endpoint
              <input
                type="text"
                value={voiceConfig.gptSovits.endpoint}
                onChange={event => updateVoiceConfig({ gptSovits: { endpoint: event.target.value } })}
                className="field"
              />
            </label>
          )}

          {provider === 'qwen3-tts' && (
            <div className="grid gap-2.5">
              <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                Endpoint
                <input
                  type="text"
                  value={voiceConfig.qwen3Tts.endpoint}
                  onChange={event => updateVoiceConfig({ qwen3Tts: { endpoint: event.target.value } })}
                  className="field"
                />
              </label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                  Language
                  <input
                    type="text"
                    value={voiceConfig.qwen3Tts.language}
                    onChange={event => updateVoiceConfig({ qwen3Tts: { language: event.target.value } })}
                    className="field"
                  />
                </label>
                <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                  Speaker
                  <input
                    type="text"
                    value={voiceConfig.qwen3Tts.speaker}
                    onChange={event => updateVoiceConfig({ qwen3Tts: { speaker: event.target.value } })}
                    className="field"
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                Default voice instruct
                <input
                  type="text"
                  value={voiceConfig.qwen3Tts.defaultInstruct}
                  onChange={event => updateVoiceConfig({ qwen3Tts: { defaultInstruct: event.target.value } })}
                  className="field"
                />
              </label>
            </div>
          )}

          {provider === 'qwen3-tts-clone' && (
            <div className="grid gap-2.5">
              <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                Endpoint
                <input
                  type="text"
                  value={voiceConfig.qwen3VoiceClone.endpoint}
                  onChange={event => updateVoiceConfig({ qwen3VoiceClone: { endpoint: event.target.value } })}
                  className="field"
                />
              </label>
              <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                Language
                <input
                  type="text"
                  value={voiceConfig.qwen3VoiceClone.language}
                  onChange={event => updateVoiceConfig({ qwen3VoiceClone: { language: event.target.value } })}
                  className="field"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={voiceConfig.qwen3VoiceClone.xVectorOnlyMode}
                  onChange={event => updateVoiceConfig({ qwen3VoiceClone: { xVectorOnlyMode: event.target.checked } })}
                  className="h-4 w-4 rounded border-[#D8DCF0] text-[#3B4474] focus:ring-[#9CA3D4]"
                />
                只用 x-vector
              </label>
            </div>
          )}
        </div>

        <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
          <input
            type="checkbox"
            checked={voiceConfig.fallbackToSystem}
            onChange={event => updateVoiceConfig({ fallbackToSystem: event.target.checked })}
            className="h-4 w-4 rounded border-[#D8DCF0] text-[#3B4474] focus:ring-[#9CA3D4]"
          />
          失败时回退系统 TTS
        </label>
      </div>

      <details className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-3 dark:border-white/10 dark:bg-white/[0.02]">
        <summary className="cursor-pointer select-none text-[12px] font-semibold text-[#5F6780] dark:text-slate-300">
          Core 连接（可选）
        </summary>
        <div className="mt-3 grid gap-2.5">
          <p className="text-[11.5px] leading-5 text-[#7A819A] dark:text-slate-400">
            留空时使用桌面内嵌 Core。
          </p>
          <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
            Core 地址
            <input
              type="text"
              value={coreUrl}
              onChange={event => setCoreUrl(event.target.value)}
              placeholder="http://127.0.0.1:8787"
              className="field"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-medium text-[#5F6780] dark:text-slate-300">
            Core Token
            <input
              type="password"
              value={coreToken}
              onChange={event => setCoreToken(event.target.value)}
              placeholder="可留空"
              className="field"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveCoreSettings}
              className="rounded-lg bg-[#3B4474] px-3.5 py-2 text-[12px] font-semibold text-[#FFFFFF] hover:bg-[#323962] dark:bg-[#7C8FD0] dark:text-[#0B1020] dark:hover:bg-[#9CA3D4]"
            >
              保存
            </button>
            {coreStatus && <span className="text-[11.5px] text-[#7A819A] dark:text-slate-400">{coreStatus}</span>}
          </div>
        </div>
      </details>
    </section>
  );
}
