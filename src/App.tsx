import React, { useState } from 'react';
import { ChatWindow } from './components/Chat/ChatWindow';
import { SettingsPage, type SettingsSection } from './components/Settings/SettingsPage';
import { SystemPage } from './components/System/SystemPage';
import { useSettingsStore } from './stores/settings';
import { applyThemeMode, watchSystemTheme } from './services/theme';

type Tab = 'system' | 'chat' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('system');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('app');
  const { isConfigured, isHydrated, themeMode } = useSettingsStore();

  React.useEffect(() => {
    if (!isConfigured) {
      setActiveTab('settings');
      setSettingsSection('api');
    }
  }, [isConfigured]);

  React.useEffect(() => {
    const applyTheme = () => {
      applyThemeMode(themeMode);
    };

    applyTheme();
    return watchSystemTheme(themeMode, applyTheme);
  }, [themeMode]);

  const openSettingsSection = (section: SettingsSection) => {
    setSettingsSection(section);
    setActiveTab('settings');
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#f6fbff] text-slate-950 transition-colors dark:bg-[#04101a] dark:text-sky-50">
      <div className="shrink-0 border-b border-sky-100 bg-white/80 backdrop-blur dark:border-sky-900/40 dark:bg-[#07131f]/90">
        <div className="flex items-center justify-between px-3">
          <div className="flex">
            <button
              onClick={() => setActiveTab('system')}
              className={`px-5 py-3 font-medium border-b-2 transition-colors ${
                activeTab === 'system'
                  ? 'border-sky-500 text-sky-700 dark:border-sky-300 dark:text-sky-200'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-sky-100'
              }`}
            >
              系统
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-5 py-3 font-medium border-b-2 transition-colors ${
                activeTab === 'chat'
                  ? 'border-sky-500 text-sky-700 dark:border-sky-300 dark:text-sky-200'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-sky-100'
              }`}
            >
              聊天
              {!isConfigured && (
                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-100">
                  未配置
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-5 py-3 font-medium border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-sky-500 text-sky-700 dark:border-sky-300 dark:text-sky-200'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-sky-100'
              }`}
            >
              设置
            </button>
          </div>
          {!isHydrated && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
              正在读取本地数据
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'system' ? (
          <SystemPage onOpenSettings={() => openSettingsSection('app')} />
        ) : activeTab === 'chat' ? (
          isConfigured ? (
            <ChatWindow onEditCharacter={() => openSettingsSection('characters')} />
          ) : (
            <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top_left,#e6f7ff_0,#f8fcff_42%,#ffffff_90%)] px-5 dark:bg-[radial-gradient(circle_at_top_left,#082036_0,#06111d_42%,#02070c_90%)]">
              <div className="text-center">
                <p className="mb-4 text-slate-600 dark:text-slate-300">
                  请先完成 API 设置
                </p>
                <button
                  onClick={() => openSettingsSection('api')}
                  className="rounded-full bg-sky-500 px-5 py-2 text-white shadow-sm shadow-sky-200 hover:bg-sky-800 dark:bg-sky-400 dark:text-[#04101a] dark:shadow-none dark:hover:bg-sky-300"
                >
                  打开设置
                </button>
              </div>
            </div>
          )
        ) : (
          <SettingsPage activeSection={settingsSection} onSectionChange={setSettingsSection} />
        )}
      </div>
    </div>
  );
}

export default App;
