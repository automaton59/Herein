import { useEffect, useState } from 'react';
import { Edit3, RefreshCcw, RotateCcw, Scissors } from 'lucide-react';
import type { Message } from '../../services/interfaces';

interface MessageItemProps {
  message: Message;
  onEdit?: (messageId: string, content: string) => void;
  onRetract?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onDeleteAfter?: (messageId: string) => void;
}

export function MessageItem({
  message,
  onEdit,
  onRetract,
  onRegenerate,
  onDeleteAfter,
}: MessageItemProps) {
  const isUser = message.role === 'user';
  const isPending = message.status === 'pending';
  const isFailed = message.status === 'failed';
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  useEffect(() => {
    if (!isEditing) {
      setDraft(message.content);
    }
  }, [isEditing, message.content]);

  const handleSave = () => {
    const nextContent = draft.trim();

    if (!nextContent) {
      return;
    }

    onEdit?.(message.id, nextContent);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraft(message.content);
    setIsEditing(false);
  };

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`group flex max-w-[86%] flex-col gap-1 sm:max-w-[74%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-3xl px-4 py-3 text-sm shadow-sm ${
            isUser
              ? 'rounded-br-lg bg-sky-600 text-white shadow-sky-200 dark:bg-sky-400 dark:text-[#04101a] dark:shadow-none'
              : 'rounded-bl-lg border border-white/80 bg-white/90 text-slate-900 shadow-sky-100 dark:border-white/10 dark:bg-white/10 dark:text-sky-50 dark:shadow-none'
          } ${isFailed ? 'ring-2 ring-red-200 dark:ring-red-400/40' : ''}`}
        >
          {isEditing ? (
            <div className="grid min-w-72 gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                className="min-h-24 w-full resize-y rounded-2xl border border-sky-100 px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-[#07131f] dark:text-sky-50 dark:focus:border-sky-300/60 dark:focus:ring-sky-300/10"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-full border border-sky-100 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!draft.trim()}
                  className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap leading-6">
                {message.content || '（模型没有返回正文）'}
              </p>
            </>
          )}
        </div>

        {!isEditing && (
          <div className={`flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {isPending && onRetract && (
              <button
                type="button"
                onClick={() => onRetract(message.id)}
                className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-sky-700 shadow-sm hover:bg-sky-50 dark:bg-white/10 dark:text-sky-200 dark:shadow-none dark:hover:bg-white/20"
              >
                <RotateCcw size={13} />
                撤回
              </button>
            )}
            {onEdit && !isPending && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-slate-500 shadow-sm hover:bg-sky-50 hover:text-sky-700 dark:bg-white/10 dark:text-slate-300 dark:shadow-none dark:hover:bg-white/20 dark:hover:text-sky-200"
              >
                <Edit3 size={13} />
                编辑
              </button>
            )}
            {onRegenerate && !isPending && (
              <button
                type="button"
                onClick={() => onRegenerate(message.id)}
                className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-slate-500 shadow-sm hover:bg-sky-50 hover:text-sky-700 dark:bg-white/10 dark:text-slate-300 dark:shadow-none dark:hover:bg-white/20 dark:hover:text-sky-200"
              >
                <RefreshCcw size={13} />
                重新生成
              </button>
            )}
            {onDeleteAfter && !isPending && (
              <button
                type="button"
                onClick={() => onDeleteAfter(message.id)}
                className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-slate-500 shadow-sm hover:bg-sky-50 hover:text-sky-700 dark:bg-white/10 dark:text-slate-300 dark:shadow-none dark:hover:bg-white/20 dark:hover:text-sky-200"
              >
                <Scissors size={13} />
                删除后续
              </button>
            )}
            {isFailed && (
              <span className="rounded-full bg-red-50 px-2 py-1 text-red-500 dark:bg-red-500/10 dark:text-red-200">发送失败</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
