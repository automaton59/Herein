import { Brain, Database, KeyRound, SlidersHorizontal, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { APISettings } from './APISettings';
import { AppSettings } from './AppSettings';
import { CharacterSettings } from './CharacterSettings';
import { MemorySettings } from '../Memory/MemorySettings';
import { DataSettings } from './DataSettings';

export type SettingsSection = 'app' | 'api' | 'characters' | 'memory' | 'data';

interface SettingsPageProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    id: 'app',
    label: '应用设置',
    description: '主题与本地体验',
    Icon: SlidersHorizontal,
  },
  {
    id: 'api',
    label: 'API',
    description: '模型与连接',
    Icon: KeyRound,
  },
  {
    id: 'characters',
    label: '角色管理',
    description: '角色卡与开场白',
    Icon: UserRound,
  },
  {
    id: 'memory',
    label: '记忆',
    description: '总结与抽取',
    Icon: Brain,
  },
  {
    id: 'data',
    label: '数据',
    description: '备份与恢复',
    Icon: Database,
  },
];

function renderSection(section: SettingsSection) {
  switch (section) {
    case 'api':
      return <APISettings />;
    case 'characters':
      return <CharacterSettings />;
    case 'memory':
      return <MemorySettings />;
    case 'data':
      return <DataSettings />;
    default:
      return <AppSettings />;
  }
}

export function SettingsPage({ activeSection, onSectionChange }: SettingsPageProps) {
  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,#ffe4e6_0,#fff7ed_38%,#f8fafc_88%)] dark:bg-[radial-gradient(circle_at_top_left,#3a1728_0,#1b1018_38%,#0d1118_88%)]">
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-rose-100 bg-white/65 p-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#171018]/70 dark:shadow-none lg:sticky lg:top-6 lg:self-start">
          <nav className="grid gap-1 sm:grid-cols-5 lg:grid-cols-1">
            {SECTIONS.map(({ id, label, description, Icon }) => {
              const isActive = activeSection === id;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSectionChange(id)}
                  className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    isActive
                      ? 'bg-rose-500 text-white shadow-sm shadow-rose-200 dark:bg-rose-300 dark:text-[#1b1018] dark:shadow-none'
                      : 'text-slate-600 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-rose-100'
                  }`}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{label}</span>
                    <span className={`mt-0.5 hidden truncate text-xs sm:block ${isActive ? 'opacity-80' : 'text-slate-400 dark:text-slate-500'}`}>
                      {description}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {renderSection(activeSection)}
        </div>
      </div>
    </div>
  );
}
