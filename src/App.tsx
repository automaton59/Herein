import React, { useState } from 'react';
import { Activity, KeyRound, MessageCircle, Settings2 } from 'lucide-react';
import { ChatWindow } from './components/Chat/ChatWindow';
import { SettingsPage, type SettingsSection } from './components/Settings/SettingsPage';
import { SystemPage } from './components/System/SystemPage';
import { useSettingsStore } from './stores/settings';
import { applyThemeMode, watchSystemTheme } from './services/theme';

type Tab = 'system' | 'chat' | 'settings';

const TABS: Array<{ id: Tab; label: string; Icon: typeof Activity }> = [
  { id: 'system', label: '系统', Icon: Activity },
  { id: 'chat', label: '聊天', Icon: MessageCircle },
  { id: 'settings', label: '设置', Icon: Settings2 },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('app');
  const { isConfigured, isHydrated, themeMode } = useSettingsStore();
  const [hasLocalCore] = useState(() => {
    try {
      return Boolean(window.hereinCore?.url || localStorage.getItem('herein-core-url'));
    } catch {
      return Boolean(window.hereinCore?.url);
    }
  });
  const canChat = isConfigured || hasLocalCore;

  React.useEffect(() => {
    if (isHydrated && !canChat) {
      setActiveTab('settings');
      setSettingsSection('api');
    }
  }, [canChat, isHydrated]);

  React.useEffect(() => {
    const applyTheme = () => {
      applyThemeMode(themeMode);
    };

    applyTheme();
    return watchSystemTheme(themeMode, applyTheme);
  }, [themeMode]);

  React.useEffect(() => {
    return window.hereinShell?.app.onOpenChat(messageId => {
      setActiveTab('chat');

      if (messageId) {
        window.dispatchEvent(new CustomEvent('herein:focus-message', { detail: messageId }));
      }
    });
  }, []);

  const openSettingsSection = (section: SettingsSection) => {
    setSettingsSection(section);
    setActiveTab('settings');
  };

  return (
    <div className="app-canvas flex h-[100dvh] min-h-0 flex-col overflow-hidden text-slate-950 transition-colors dark:text-sky-50">
      <header className="relative z-20 shrink-0 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="mx-auto flex w-full max-w-[1560px] items-center gap-2 rounded-[18px] border border-[#E6E5F0] bg-[#FFFFFF]/92 px-3 py-2.5 shadow-[0_18px_50px_-42px_rgba(59,68,116,0.45)] dark:border-white/10 dark:bg-[#0E1424]/88 sm:gap-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <img
              src="./herein-mark.png"
              alt=""
              aria-hidden="true"
              className="h-10 w-10 shrink-0"
            />
            <div className="min-w-0 leading-tight">
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-semibold tracking-[0.18em] text-[#1C2333] dark:text-sky-50">此间</span>
                <span className="hidden text-[9px] font-semibold uppercase tracking-[0.3em] text-[#3B4474]/45 sm:inline dark:text-sky-300/60">
                  Herein
                </span>
              </div>
            </div>
          </div>

          <nav
            aria-label="主导航"
            className="ml-0 flex items-center gap-1 rounded-full border border-[#E6E5F0] bg-[#F1F2F9] p-1 dark:border-white/10 dark:bg-white/5 sm:ml-2"
          >
            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;

              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors sm:px-3.5 ${
                    isActive
                      ? 'bg-[#3B4474] text-[#FFFFFF] shadow-[0_6px_16px_-10px_rgba(59,68,116,0.8)] dark:bg-[#7C8FD0] dark:text-[#0B1020]'
                      : 'text-[#5F6780] hover:bg-[#FFFFFF] hover:text-[#3B4474] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-sky-100'
                  }`}
                >
                  <Icon
                    size={15}
                    className={isActive ? 'text-[#A5E1F5] dark:text-[#0B1020]' : 'text-[#8C93A8] dark:text-slate-500'}
                  />
                  <span className={`hidden sm:inline ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {!isHydrated ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#E6E5F0] bg-[#FFFFFF] px-2.5 py-1.5 text-[11px] font-medium text-[#69718A] dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9CA3D4]" />
                <span className="hidden sm:inline">读取中</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => openSettingsSection('api')}
                className="inline-flex items-center gap-2 rounded-full border border-[#E6E5F0] bg-[#FFFFFF] px-2.5 py-1.5 text-[11px] font-medium text-[#5F6780] transition hover:border-[#D8DCF0] hover:text-[#3B4474] dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-sky-100"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${canChat ? 'bg-aqua-400 shadow-[0_0_0_3px_rgba(124,200,234,0.18)]' : 'bg-amber-500'}`} />
                <span className="hidden sm:inline">{canChat ? '已连接' : '未配置'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
        {!isHydrated ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="flex items-center gap-2 rounded-full border border-[#E6E5F0] bg-[#FFFFFF] px-4 py-2 text-[12px] font-medium text-[#69718A] dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9CA3D4]" />
              正在读取角色与本地数据
            </div>
          </div>
        ) : activeTab === 'system' ? (
          <SystemPage onOpenSettings={() => openSettingsSection('app')} />
        ) : activeTab === 'chat' ? (
          canChat ? (
            <ChatWindow onEditCharacter={() => openSettingsSection('characters')} />
          ) : (
            <div className="flex h-full items-center justify-center px-6">
              <div className="w-full max-w-sm rounded-[24px] border border-[#E6E5F0] bg-[#FFFFFF] p-7 text-center shadow-[0_28px_70px_-50px_rgba(59,68,116,0.45)] dark:border-white/10 dark:bg-[#0E1424]">
                <div className="mx-auto w-fit">
                  <img src="./herein-mark.png" alt="" aria-hidden="true" className="h-16 w-16" />
                </div>
                <h2 className="mt-5 text-lg font-semibold tracking-tight text-[#1C2333] dark:text-sky-50">
                  先完成一次配置
                </h2>
                <p className="mt-2 text-[13px] leading-5 text-[#69718A] dark:text-slate-400">
                  填入 API Key 后即可开始。
                </p>
                <button
                  onClick={() => openSettingsSection('api')}
                  className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#3B4474] px-5 text-[13px] font-semibold text-[#FFFFFF] transition hover:bg-[#323962] dark:bg-[#7C8FD0] dark:text-[#0B1020] dark:hover:bg-[#9CA3D4]"
                >
                  <KeyRound size={15} />
                  去配置
                </button>
              </div>
            </div>
          )
        ) : (
          <SettingsPage activeSection={settingsSection} onSectionChange={setSettingsSection} />
        )}
      </main>
    </div>
  );
}

export default App;
