import { useEffect, useState } from 'react';
import { LockKeyhole, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings';
import { PersonaEditor } from './PersonaEditor';

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

/**
 * The companion identity is fixed by the persona pack. This page deliberately
 * has no role picker, no "new role", no duplicate and no delete: those belonged
 * to the earlier multi-contact architecture and would let the visible identity
 * drift away from the persona that drives chat, memory and desktop presence.
 */
export function CharacterSettings() {
  const { characterConfig, updateCharacterConfig } = useSettingsStore();
  const [openingLine, setOpeningLine] = useState(characterConfig.firstMessage);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setOpeningLine(characterConfig.firstMessage);
  }, [characterConfig.firstMessage]);

  const handleSave = () => {
    const firstMessage = openingLine.trim();

    // An empty opening line is a valid choice: the chat stays empty instead of
    // inventing a canned greeting. The companion can still start a real
    // conversation through the initiative scheduler.
    updateCharacterConfig({ firstMessage });
    setFeedback({
      type: 'success',
      message: firstMessage ? '开场白已保存' : '已清空，聊天页不会显示开场白',
    });
  };

  return (
    <section className="settings-card space-y-5">
      <div>
        <h2 className="settings-title">角色</h2>
        <p className="settings-sub">当前角色由人格设定固定，聊天、记忆和桌面形象共用同一个身份。</p>
      </div>

      {feedback && (
        <div
          className={`border-l-4 px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-500 bg-green-50 text-green-800 dark:bg-emerald-500/10 dark:text-emerald-100'
              : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-100'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#3B4474] text-lg font-semibold text-white dark:bg-[#7C8FD0] dark:text-[#0B1020]">
            {characterConfig.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-base font-semibold text-[#1C2333] dark:text-sky-50">{characterConfig.name}</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#E6E5F0] px-2 py-0.5 text-[10px] font-medium text-[#5F6780] dark:bg-white/10 dark:text-slate-300">
                <LockKeyhole size={10} />
                固定人格
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-5 text-[#7A819A] dark:text-slate-400">
              ID：{characterConfig.id} · 聊天、记忆和桌面形象只使用当前人格。
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-[#EEEDF5] pt-4 dark:border-white/10">
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-[#5F6780] dark:text-slate-300">本地开场白</span>
            <textarea
              value={openingLine}
              placeholder="可选，留空则不显示"
              onChange={(event) => {
                setOpeningLine(event.target.value);
                setFeedback(null);
              }}
              rows={3}
              className="min-h-20 w-full resize-y rounded-xl border border-[#E6E5F0] bg-white px-3 py-2 text-[13px] text-[#1C2333] outline-none focus:border-[#9CA3D4] focus:ring-2 focus:ring-[#9CA3D4]/20 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:border-[#7C8FD0] dark:focus:ring-[#7C8FD0]/15"
            />
          </label>
          <p className="text-[11px] leading-5 text-[#7A819A] dark:text-slate-400">
            留空时聊天页不显示开场白；她会通过主动性机制在合适的时候自己开口。
          </p>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg bg-[#3B4474] px-4 text-[13px] font-semibold text-[#FFFFFF] hover:bg-[#323962] dark:bg-[#7C8FD0] dark:text-[#0B1020] dark:hover:bg-[#9CA3D4]"
          >
            <Sparkles size={14} />
            保存开场白
          </button>
        </div>
      </div>

      <div>
        <h2 className="settings-title">人设与提示词</h2>
        <p className="settings-sub mb-4">
          直接编辑人格内容，保存后立即生效。persona pack 文件仍是出厂默认，界面修改保存在本地数据库。
        </p>
        <PersonaEditor />
      </div>

      <div className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-4 text-[12px] leading-6 text-[#5F6780] dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300">
        <p className="font-semibold text-[#1C2333] dark:text-sky-50">形象与表情</p>
        <p className="mt-1">
          在聊天页点击角色头像打开资料抽屉，可以导入或替换头像、表情和 Live2D 模型。桌面形象会自动跟随当前角色的形象配置。
        </p>
      </div>
    </section>
  );
}
