import { useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { createPhase2Client } from '../../services/phase2/client';

interface DataSettingsProps {
  onExportBackup?: (includeSecrets: boolean) => Promise<string>;
  onRestoreBackup?: (backupPath: string) => Promise<boolean>;
}

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

export function DataSettings({ onExportBackup, onRestoreBackup }: DataSettingsProps) {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [backupPath, setBackupPath] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const exportBackup = onExportBackup ?? ((withSecrets: boolean) =>
    createPhase2Client().backup.export(undefined, withSecrets));
  const restoreBackup = onRestoreBackup ?? ((path: string) =>
    createPhase2Client().backup.restore(path));

  const handleExport = async () => {
    setIsWorking(true);
    setFeedback(null);

    try {
      const outputPath = await exportBackup(includeSecrets);
      setFeedback({ type: 'success', message: `已导出：${outputPath}` });
    } catch (error) {
      setFeedback({ type: 'error', message: `导出失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsWorking(false);
    }
  };

  const handleRestore = async () => {
    const path = backupPath.trim();

    if (!path) {
      setFeedback({ type: 'error', message: '请填写备份文件路径' });
      return;
    }

    setIsWorking(true);
    setFeedback(null);

    try {
      await restoreBackup(path);
      setFeedback({ type: 'success', message: '备份已恢复，重启应用后生效' });
    } catch (error) {
      setFeedback({ type: 'error', message: `恢复失败：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-sky-100 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#07131f]/80 dark:shadow-none">
      <div>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-sky-50">数据与备份</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">管理本地 SQLite 数据库、角色资产和完整备份。</p>
      </div>

      {feedback && (
        <div className={`border-l-4 px-4 py-3 text-sm ${
          feedback.type === 'success'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100'
            : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-100'
        }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid gap-4">
        <div className="space-y-3 rounded-xl border border-sky-100 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-sky-50">完整备份</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">导出 manifest、app.db 和 assets。</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(event) => setIncludeSecrets(event.target.checked)}
              className="h-4 w-4 rounded border-sky-200 text-sky-700 focus:ring-sky-200"
            />
            包含 API Key 密文
          </label>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isWorking}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            <Download size={17} />
            导出完整备份
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-sky-100 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-sky-50">恢复备份</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">恢复前会验证 manifest，并为当前数据创建快照。</p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">备份文件路径</span>
            <input
              aria-label="备份文件路径"
              value={backupPath}
              onChange={(event) => setBackupPath(event.target.value)}
              placeholder="D:/backup/herein-backup.zip"
              className="h-11 w-full rounded-xl border border-sky-100 px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:placeholder:text-slate-500 dark:focus:border-sky-300/60 dark:focus:ring-sky-300/10"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={isWorking}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-4 font-medium text-slate-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
          >
            <RotateCcw size={17} />
            恢复备份
          </button>
        </div>
      </div>
    </section>
  );
}
