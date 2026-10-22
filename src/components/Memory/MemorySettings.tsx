import { Brain, MessageSquare, ToggleLeft, ToggleRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings';
import type { APIProfile, AppConfig } from '../../services/interfaces';
import { SelectMenu } from '../UI/SelectMenu';

export type MemorySettingsValue = Pick<AppConfig,
  | 'memoryEnabled'
  | 'memoryProfileMode'
  | 'memoryProfileId'
  | 'summaryTriggerMessageCount'
>;

interface MemorySettingsProps {
  value?: MemorySettingsValue;
  apiProfiles?: APIProfile[];
  onChange?: (patch: Partial<MemorySettingsValue>) => void;
}

function clampTriggerCount(value: number) {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.max(2, Math.min(200, Math.round(value)));
}

export function MemorySettings({ value, apiProfiles, onChange }: MemorySettingsProps) {
  const store = useSettingsStore();
  const current: MemorySettingsValue = value ?? {
    memoryEnabled: store.memoryEnabled,
    memoryProfileMode: store.memoryProfileMode,
    memoryProfileId: store.memoryProfileId,
    summaryTriggerMessageCount: store.summaryTriggerMessageCount,
  };
  const profiles = apiProfiles ?? store.apiProfiles;
  const update = onChange ?? store.updateMemorySettings;

  const selectFollowChat = () => {
    update({ memoryProfileMode: 'follow-chat', memoryProfileId: null });
  };

  const selectCustomProfile = () => {
    update({
      memoryProfileMode: 'custom',
      memoryProfileId: current.memoryProfileId ?? profiles[0]?.id ?? null,
    });
  };

  return (
    <section className="space-y-5 rounded-2xl border border-rose-100 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#171018]/80 dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-rose-50">记忆设置</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">调整总结、抽取和上下文记忆的全局行为。</p>
        </div>
        <button
          type="button"
          onClick={() => update({ memoryEnabled: !current.memoryEnabled })}
          className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium ${
            current.memoryEnabled
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
              : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'
          }`}
        >
          {current.memoryEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          {current.memoryEnabled ? '已开启' : '已关闭'}
        </button>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">总结模型</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-label="跟随聊天模型"
              aria-pressed={current.memoryProfileMode === 'follow-chat'}
              onClick={selectFollowChat}
              className={`flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left transition ${
                current.memoryProfileMode === 'follow-chat'
                  ? 'border-rose-300 bg-rose-50 text-rose-700 ring-2 ring-rose-100 dark:border-rose-300/50 dark:bg-rose-300/10 dark:text-rose-100 dark:ring-rose-300/10'
                  : 'border-rose-100 bg-white text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              <MessageSquare size={18} className="mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">跟随聊天模型</span>
                <span className="mt-1 block text-xs opacity-75">默认使用当前对话 API Profile。</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="指定 Profile"
              aria-pressed={current.memoryProfileMode === 'custom'}
              onClick={selectCustomProfile}
              className={`flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left transition ${
                current.memoryProfileMode === 'custom'
                  ? 'border-rose-300 bg-rose-50 text-rose-700 ring-2 ring-rose-100 dark:border-rose-300/50 dark:bg-rose-300/10 dark:text-rose-100 dark:ring-rose-300/10'
                  : 'border-rose-100 bg-white text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              <Brain size={18} className="mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">指定 Profile</span>
                <span className="mt-1 block text-xs opacity-75">使用更擅长 JSON 的模型做总结。</span>
              </span>
            </button>
          </div>
        </div>

        {current.memoryProfileMode === 'custom' && (
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">记忆 API Profile</span>
            <SelectMenu
              value={current.memoryProfileId ?? profiles[0]?.id ?? ''}
              onChange={(memoryProfileId) => update({ memoryProfileId })}
              disabled={profiles.length === 0}
              options={profiles.length > 0
                ? profiles.map(profile => ({
                  value: profile.id,
                  label: profile.name,
                  description: profile.model,
                }))
                : [{ value: '', label: '暂无 API Profile', disabled: true }]}
            />
          </label>
        )}

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">总结触发消息数</span>
          <input
            aria-label="总结触发消息数"
            type="number"
            min={2}
            max={200}
            value={current.summaryTriggerMessageCount}
            onChange={(event) => update({ summaryTriggerMessageCount: clampTriggerCount(Number(event.target.value)) })}
            className="h-11 w-full rounded-xl border border-rose-100 px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:border-rose-300/60 dark:focus:ring-rose-300/10"
          />
        </label>
      </div>
    </section>
  );
}
