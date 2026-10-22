import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { createPhase2Client } from '../../services/phase2/client';

interface CharacterArchiveControlsProps {
  characterId: string;
  onExportArchive?: (characterId: string, mode: 'profile' | 'full') => Promise<string>;
  onImportArchive?: (archivePath: string) => Promise<string>;
}

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

export function CharacterArchiveControls({
  characterId,
  onExportArchive,
  onImportArchive,
}: CharacterArchiveControlsProps) {
  const [archivePath, setArchivePath] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const exportArchive = onExportArchive ?? ((id: string, mode: 'profile' | 'full') =>
    createPhase2Client().characterArchive.export(id, mode));
  const importArchive = onImportArchive ?? ((path: string) =>
    createPhase2Client().characterArchive.import(path));

  const handleExport = async (mode: 'profile' | 'full') => {
    setIsWorking(true);
    setFeedback(null);

    try {
      const outputPath = await exportArchive(characterId, mode);
      setFeedback({ type: 'success', message: `已导出：${outputPath}` });
    } catch (error) {
      setFeedback({ type: 'error', message: `导出失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsWorking(false);
    }
  };

  const handleImport = async () => {
    const path = archivePath.trim();

    if (!path) {
      setFeedback({ type: 'error', message: '请填写角色归档路径' });
      return;
    }

    setIsWorking(true);
    setFeedback(null);

    try {
      const importedId = await importArchive(path);
      setFeedback({ type: 'success', message: `已导入角色：${importedId}` });
    } catch (error) {
      setFeedback({ type: 'error', message: `导入失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-rose-100 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-rose-50">角色导入/导出</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">角色档案默认不包含私人记忆；完整归档用于自己的迁移和备份。</p>
      </div>

      {feedback && (
        <div className={`border-l-4 px-3 py-2 text-sm ${
          feedback.type === 'success'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100'
            : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-100'
        }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void handleExport('profile')}
          disabled={isWorking}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
        >
          <Download size={16} />
          导出角色档案
        </button>
        <button
          type="button"
          onClick={() => void handleExport('full')}
          disabled={isWorking}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-rose-400 dark:text-[#1b1018] dark:hover:bg-rose-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          <Download size={16} />
          导出完整归档
        </button>
      </div>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">角色归档路径</span>
        <input
          aria-label="角色归档路径"
          value={archivePath}
          onChange={(event) => setArchivePath(event.target.value)}
          placeholder="D:/backup/herein-character.zip"
          className="h-10 w-full rounded-xl border border-rose-100 px-3 text-sm text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:placeholder:text-slate-500 dark:focus:border-rose-300/60 dark:focus:ring-rose-300/10"
        />
      </label>
      <button
        type="button"
        onClick={() => void handleImport()}
        disabled={isWorking}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
      >
        <Upload size={16} />
        导入角色归档
      </button>
    </div>
  );
}
