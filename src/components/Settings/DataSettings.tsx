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
    <section className="settings-card space-y-5">
      <div>
        <h2 className="settings-title">数据与备份</h2>
        <p className="settings-sub">本地数据库、角色资产与完整备份。</p>
      </div>

      {feedback && (
        <div className={`rounded-lg border-l-2 px-3 py-2 text-[12.5px] ${
          feedback.type === 'success'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100'
            : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-100'
        }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid max-w-[720px] gap-3">
        <div className="space-y-3 rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-3.5 dark:border-white/10 dark:bg-white/[0.02]">
          <div>
            <h3 className="text-[13px] font-semibold text-[#1C2333] dark:text-sky-50">完整备份</h3>
            <p className="mt-0.5 text-[11.5px] text-[#7A819A] dark:text-slate-400">manifest、数据库与资产。</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[#5F6780] dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(event) => setIncludeSecrets(event.target.checked)}
              className="h-4 w-4 rounded border-[#D8DCF0] text-[#3B4474] focus:ring-[#9CA3D4]"
            />
            包含 API Key 密文
          </label>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isWorking}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#3B4474] px-3 text-[12.5px] font-semibold text-[#FFFFFF] transition hover:bg-[#323962] disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#7C8FD0] dark:text-[#0B1020] dark:hover:bg-[#9CA3D4] dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            <Download size={15} />
            导出完整备份
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-3.5 dark:border-white/10 dark:bg-white/[0.02]">
          <div>
            <h3 className="text-[13px] font-semibold text-[#1C2333] dark:text-sky-50">恢复备份</h3>
            <p className="mt-0.5 text-[11.5px] text-[#7A819A] dark:text-slate-400">先校验，再为当前数据创建快照。</p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-[#5F6780] dark:text-slate-300">备份文件路径</span>
            <input
              aria-label="备份文件路径"
              value={backupPath}
              onChange={(event) => setBackupPath(event.target.value)}
              placeholder="D:/backup/herein-backup.zip"
              className="field"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={isWorking}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#E6E5F0] bg-[#FFFFFF] px-3 text-[12.5px] font-semibold text-[#41495C] transition hover:bg-[#F1F2F9] disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
          >
            <RotateCcw size={15} />
            恢复备份
          </button>
        </div>
      </div>
    </section>
  );
}
