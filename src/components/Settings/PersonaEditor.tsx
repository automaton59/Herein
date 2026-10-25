import { useCallback, useEffect, useState } from 'react';
import { FileWarning, Loader2, PenLine, RotateCcw, Save } from 'lucide-react';
import {
  CoreClient,
  CoreHttpError,
  type CorePersonaEditInput,
  type CorePersonaView,
} from '../../services/coreClient';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';

const LAYER_LABELS: Record<string, string> = {
  L0_safety_identity: 'L0 安全与身份',
  L1_character_core: 'L1 角色核心',
  L2_relationship: 'L2 关系',
  L3_user_model: 'L3 用户模型',
  L4_scene: 'L4 场景',
  L5_task: 'L5 行为策略',
  L6_output_contract: 'L6 输出契约',
};

interface FormState {
  name: string;
  nickname: string;
  relationshipFrame: string;
  personalityCore: string;
  values: string;
  boundaries: string;
  defaultAddress: string;
  occasionalAddress: string;
  examples: string;
  templates: Record<string, string>;
}

type Feedback = { type: 'success' | 'error'; message: string };

function createClient(): CoreClient | null {
  const baseUrl = (localStorage.getItem(CORE_URL_KEY) || window.hereinCore?.url || '').trim();

  if (!baseUrl) {
    return null;
  }

  return new CoreClient({
    baseUrl,
    token: (localStorage.getItem(CORE_TOKEN_KEY) || window.hereinCore?.token || '').trim() || undefined,
  });
}

function formFromView(view: CorePersonaView): FormState | null {
  if (!view.available || !view.character) {
    return null;
  }

  const character = view.character;

  return {
    name: character.name,
    nickname: character.nickname,
    relationshipFrame: character.relationshipFrame,
    personalityCore: character.personality.core.join('\n'),
    values: character.personality.values.join('\n'),
    boundaries: character.personality.boundaries.join('\n'),
    defaultAddress: character.speakingStyle.defaultAddress,
    occasionalAddress: character.speakingStyle.occasionalAddress,
    examples: character.speakingStyle.examples.join('\n'),
    templates: Object.fromEntries((view.templates ?? []).map(template => [template.id, template.text])),
  };
}

function toInput(form: FormState): CorePersonaEditInput {
  const lines = (value: string) =>
    value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  return {
    name: form.name.trim(),
    nickname: form.nickname.trim(),
    relationshipFrame: form.relationshipFrame.trim() || '朋友',
    personalityCore: lines(form.personalityCore),
    values: lines(form.values),
    boundaries: lines(form.boundaries),
    speakingStyle: {
      defaultAddress: form.defaultAddress.trim(),
      occasionalAddress: form.occasionalAddress.trim(),
      examples: lines(form.examples),
    },
    templates: form.templates,
  };
}

const inputClass =
  'w-full rounded-xl border border-[#E6E5F0] bg-white px-3 py-2 text-[13px] text-[#1C2333] outline-none focus:border-[#9CA3D4] focus:ring-2 focus:ring-[#9CA3D4]/20 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:border-[#7C8FD0] dark:focus:ring-[#7C8FD0]/15';

const labelClass = 'text-[12px] font-medium text-[#5F6780] dark:text-slate-300';

export function PersonaEditor() {
  const [view, setView] = useState<CorePersonaView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<'loading' | 'saving' | 'restoring' | 'ready'>('loading');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const applyView = useCallback((next: CorePersonaView) => {
    setView(next);
    setForm(formFromView(next));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const client = createClient();

      if (!client) {
        if (!cancelled) {
          setStatus('ready');
          setFeedback({ type: 'error', message: 'Core 未连接，无法读取人设' });
        }

        return;
      }

      try {
        const next = await client.getPersona();

        if (!cancelled) {
          applyView(next);
          setStatus('ready');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('ready');
          setFeedback({
            type: 'error',
            message: error instanceof Error ? error.message : '读取人设失败',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyView]);

  const handleSave = async () => {
    if (!form) {
      return;
    }

    setStatus('saving');
    setFeedback(null);

    const client = createClient();

    if (!client) {
      setStatus('ready');
      setFeedback({ type: 'error', message: 'Core 未连接' });
      return;
    }

    try {
      const next = await client.putPersona(toInput(form));

      applyView(next);
      setFeedback({ type: 'success', message: '已保存，下一轮对话立即生效（未写回文件）' });
    } catch (error) {
      const message = error instanceof CoreHttpError
        ? error.message
        : error instanceof Error
          ? error.message
          : '保存失败';

      setFeedback({ type: 'error', message });
    }

    setStatus('ready');
  };

  const handleRestore = async () => {
    setStatus('restoring');
    setFeedback(null);

    const client = createClient();

    if (!client) {
      setStatus('ready');
      setFeedback({ type: 'error', message: 'Core 未连接' });
      return;
    }

    try {
      const next = await client.refreshPersona();

      applyView(next);
      setFeedback({ type: 'success', message: '已同步为 private/persona 文件内容' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复失败';

      setFeedback({ type: 'error', message });
    }

    setStatus('ready');
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-4 text-[13px] text-[#5F6780] dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300">
        <Loader2 className="animate-spin" size={14} />
        正在读取人设…
      </div>
    );
  }

  if (!view?.available || !form) {
    return (
      <div className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-4 text-[12px] leading-6 text-[#5F6780] dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300">
        <p className="font-semibold text-[#1C2333] dark:text-sky-50">人设编辑不可用</p>
        <p className="mt-1">
          当前没有加载任何 persona pack（private/persona 为空时使用本地默认角色）。
          在 <code className="rounded bg-black/5 px-1 dark:bg-white/10">private/persona/&lt;pack-id&gt;/</code> 放入人格包后重启即可。
        </p>
      </div>
    );
  }

  const busy = status === 'saving' || status === 'restoring';

  return (
    <div className="space-y-4">
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

      {view.fileChanged && (
        <div className="flex flex-wrap items-center gap-3 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
          <FileWarning size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">
            private/persona 文件在磁盘上已被修改。可以先「从文件同步」应用新内容（会覆盖界面修改），或继续用下方内容保存。
          </span>
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <RotateCcw size={12} />
            从文件同步
          </button>
        </div>
      )}

      <div className="rounded-xl border border-[#E6E5F0] bg-[#F8F9FC] p-4 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[#1C2333] dark:text-sky-50">身份与说话方式</h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#7A819A] dark:text-slate-400">
            <PenLine size={11} />
            pack：{view.packId} · v{view.packVersion}
            {view.hasEdits ? ' · 有界面修改' : ''}
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={labelClass}>名字</span>
            <input
              value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>昵称</span>
            <input
              value={form.nickname}
              onChange={event => setForm({ ...form, nickname: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>关系框架</span>
            <input
              value={form.relationshipFrame}
              onChange={event => setForm({ ...form, relationshipFrame: event.target.value })}
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className={labelClass}>默认称呼</span>
              <input
                value={form.defaultAddress}
                onChange={event => setForm({ ...form, defaultAddress: event.target.value })}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1.5">
              <span className={labelClass}>偶尔称呼</span>
              <input
                value={form.occasionalAddress}
                onChange={event => setForm({ ...form, occasionalAddress: event.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className={labelClass}>性格核心（每行一条）</span>
            <textarea
              value={form.personalityCore}
              onChange={event => setForm({ ...form, personalityCore: event.target.value })}
              rows={4}
              className={`${inputClass} min-h-20 resize-y`}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>语气示例（每行一条）</span>
            <textarea
              value={form.examples}
              onChange={event => setForm({ ...form, examples: event.target.value })}
              rows={4}
              className={`${inputClass} min-h-20 resize-y`}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>价值观（每行一条，可空）</span>
            <textarea
              value={form.values}
              onChange={event => setForm({ ...form, values: event.target.value })}
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={labelClass}>边界（每行一条，可空）</span>
            <textarea
              value={form.boundaries}
              onChange={event => setForm({ ...form, boundaries: event.target.value })}
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </label>
        </div>
      </div>

      <div className="space-y-3">
        {(view.templates ?? [])
          .slice()
          .sort((left, right) => left.layer.localeCompare(right.layer) || left.id.localeCompare(right.id))
          .map(template => (
            <label key={template.id} className="grid gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>
                {LAYER_LABELS[template.layer] ?? template.layer} · {template.id}
              </span>
              {template.required && (
                <span className="rounded-full bg-[#E6E5F0] px-1.5 py-0.5 text-[10px] text-[#5F6780] dark:bg-white/10 dark:text-slate-300">
                  必填
                </span>
              )}
              {template.edited && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
                  已修改
                </span>
              )}
            </span>
              <textarea
                value={form.templates[template.id] ?? ''}
                onChange={event =>
                  setForm({
                    ...form,
                    templates: { ...form.templates, [template.id]: event.target.value },
                  })
                }
                rows={template.id === 'character_core' || template.id === 'chat_behavior' ? 12 : 7}
                className={`${inputClass} resize-y font-mono text-[12px] leading-5`}
                spellCheck={false}
              />
            </label>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy}
          className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg bg-[#3B4474] px-4 text-[13px] font-semibold text-[#FFFFFF] hover:bg-[#323962] disabled:opacity-50 dark:bg-[#7C8FD0] dark:text-[#0B1020] dark:hover:bg-[#9CA3D4]"
        >
          {status === 'saving' ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          保存并生效
        </button>
        <button
          type="button"
          onClick={() => void handleRestore()}
          disabled={busy}
          className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg border border-[#E6E5F0] px-4 text-[13px] font-semibold text-[#3B4474] hover:bg-[#F1F2F9] disabled:opacity-50 dark:border-white/10 dark:text-sky-100 dark:hover:bg-white/10"
        >
          {status === 'restoring' ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
          从文件同步
        </button>
        <p className="text-[11px] leading-5 text-[#7A819A] dark:text-slate-400">
          保存只写入本地数据库并立即生效；「从文件同步」会丢弃界面修改并重新读取 private/persona。
        </p>
      </div>
    </div>
  );
}
