import type { CharacterConfig } from '../../services/interfaces';

interface CharacterCardProps {
  character: CharacterConfig;
  onEdit?: () => void;
  compact?: boolean;
}

export function CharacterCard({ character, onEdit, compact = false }: CharacterCardProps) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4 p-5'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-sky-400 dark:text-sky-300">角色卡</p>
          <h2 className="mt-1 truncate text-2xl font-semibold text-slate-950 dark:text-sky-50">{character.name}</h2>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-full border border-sky-100 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
          >
            编辑
          </button>
        )}
      </div>

      <div className={compact ? 'grid gap-2 text-sm' : 'grid gap-4 text-sm'}>
        <section>
          <h3 className="font-medium text-slate-800 dark:text-sky-100">设定</h3>
          <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600 dark:text-slate-300">{character.description}</p>
        </section>

        {!compact && character.scenario && (
          <section>
            <h3 className="font-medium text-slate-800 dark:text-sky-100">场景</h3>
            <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600 dark:text-slate-300">{character.scenario}</p>
          </section>
        )}

        {!compact && character.firstMessage && (
          <section>
            <h3 className="font-medium text-slate-800 dark:text-sky-100">开场白</h3>
            <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600 dark:text-slate-300">{character.firstMessage}</p>
          </section>
        )}
      </div>
    </div>
  );
}
