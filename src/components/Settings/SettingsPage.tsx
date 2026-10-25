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

const SECTIONS: Array<{ id: SettingsSection; label: string; Icon: LucideIcon }> = [
  { id: 'app', label: '应用', Icon: SlidersHorizontal },
  { id: 'api', label: 'API', Icon: KeyRound },
  { id: 'characters', label: '角色', Icon: UserRound },
  { id: 'memory', label: '记忆', Icon: Brain },
  { id: 'data', label: '数据', Icon: Database },
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1180px] gap-5 px-5 py-6 lg:grid-cols-[184px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <nav className="grid grid-cols-5 gap-1 rounded-2xl border border-[#E6E5F0] bg-[#FFFFFF]/80 p-1.5 dark:border-white/10 dark:bg-[#0E1424]/80 lg:grid-cols-1">
            {SECTIONS.map(({ id, label, Icon }) => {
              const isActive = activeSection === id;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSectionChange(id)}
                  className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2.5 py-2.5 text-[13px] transition-colors lg:justify-start lg:px-3 ${
                    isActive
                      ? 'bg-[#3B4474] font-semibold text-[#FFFFFF] shadow-[0_8px_18px_-14px_rgba(59,68,116,0.8)] dark:bg-[#7C8FD0] dark:text-[#0B1020]'
                      : 'font-medium text-[#5F6780] hover:bg-[#F1F2F9] hover:text-[#3B4474] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-sky-100'
                  }`}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 max-w-[920px]">
          {renderSection(activeSection)}
        </div>
      </div>
    </div>
  );
}
