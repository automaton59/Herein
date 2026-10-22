import { PhoneOff } from 'lucide-react';

interface CallMiniWindowProps {
  displayName: string;
  imageSrc?: string;
  subtitle?: string;
  onRestore: () => void;
  onClose: () => void;
}

export function CallMiniWindow({
  displayName,
  imageSrc,
  subtitle,
  onRestore,
  onClose,
}: CallMiniWindowProps) {
  return (
    <div className="fixed bottom-5 right-5 z-50 grid w-64 gap-2 rounded-2xl border border-white/70 bg-white/90 p-2 shadow-2xl shadow-slate-950/20 backdrop-blur dark:border-white/10 dark:bg-[#171018]/90 dark:shadow-black/40">
      <button
        type="button"
        aria-label={`恢复 ${displayName} 通话`}
        onClick={onRestore}
        className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-xl p-1 text-left hover:bg-rose-50 dark:hover:bg-white/10"
      >
        <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl bg-rose-50 text-lg font-semibold text-rose-400 dark:bg-white/10 dark:text-rose-200">
          {imageSrc ? (
            <img src={imageSrc} alt="" className="h-full w-full object-contain" />
          ) : (
            displayName.slice(0, 1).toUpperCase()
          )}
        </div>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-950 dark:text-rose-50">{displayName}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500 dark:text-slate-400">
            {subtitle || '通话中'}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`结束 ${displayName} 通话`}
        onClick={onClose}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-xl bg-red-50 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
      >
        <PhoneOff size={14} />
        结束通话
      </button>
    </div>
  );
}
