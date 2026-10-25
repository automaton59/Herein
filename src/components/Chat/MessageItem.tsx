import { useEffect, useState } from 'react';
import { Edit3, ExternalLink, MonitorPlay, Music2, RefreshCcw, RotateCcw, Scissors } from 'lucide-react';
import type { Message, MessageMaterial, MessageSticker } from '../../services/interfaces';
import { CORE_URL_KEY } from '../../services/chatHistory';

function coreAssetUrl(relative: string) {
  if (!relative) {
    return '';
  }

  const base = (localStorage.getItem(CORE_URL_KEY) || window.hereinCore?.url || '')
    .trim()
    .replace(/\/+$/, '');

  return base ? `${base}${relative}` : relative;
}

interface MessageItemProps {
  message: Message;
  onEdit?: (messageId: string, content: string) => void;
  onRetract?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onDeleteAfter?: (messageId: string) => void;
}

function StickerBubble({ sticker }: { sticker: MessageSticker }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
        （表情：{sticker.name}）
      </span>
    );
  }

  return (
    <img
      src={coreAssetUrl(sticker.url)}
      alt={sticker.name}
      title={sticker.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-40 w-auto max-w-[10rem] rounded-2xl border border-white/70 object-contain shadow-sm dark:border-white/10"
    />
  );
}

const MATERIAL_SOURCE_LABEL: Record<MessageMaterial['source'], string> = {
  bilibili: 'B站',
  netease: '网易云',
};

/**
 * A shareable material card. The remote cover is deliberately not rendered:
 * fetching it from the renderer would hit the platform's CDN directly and leak
 * the user's IP (same rule that keeps sticker URLs local). The link itself only
 * opens on explicit click, through the shell's external-browser channel.
 */
function MaterialCard({ material }: { material: MessageMaterial }) {
  const Icon = material.kind === 'video' ? MonitorPlay : Music2;

  return (
    <button
      type="button"
      onClick={() => {
        if (material.url) {
          void window.hereinShell?.dialog?.openExternal(material.url);
        }
      }}
      disabled={!material.url}
      title={material.url ?? material.title}
      className={`mt-1 flex w-auto max-w-[16rem] items-center gap-2.5 rounded-2xl border border-white/70 bg-white/85 px-3 py-2 text-left shadow-sm transition-colors dark:border-white/10 dark:bg-white/5 ${
        material.url
          ? 'cursor-pointer hover:border-sky-300 hover:bg-sky-50/80 dark:hover:border-sky-400/40 dark:hover:bg-sky-400/10'
          : 'cursor-default'
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">
          {material.title}
        </span>
        <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
          {material.creator
            ? `${MATERIAL_SOURCE_LABEL[material.source]} · ${material.creator}`
            : MATERIAL_SOURCE_LABEL[material.source]}
        </span>
      </span>
      {material.url && (
        <ExternalLink size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />
      )}
    </button>
  );
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

  const bubbleClass = isUser
    ? 'rounded-br-lg bg-sky-700 text-white shadow-sky-200 dark:bg-sky-400 dark:text-[#04101a] dark:shadow-none'
    : 'rounded-bl-lg border border-white/80 bg-white/90 text-slate-900 shadow-sky-100 dark:border-white/10 dark:bg-white/10 dark:text-sky-50 dark:shadow-none';
  const failedClass = isFailed ? 'ring-2 ring-red-200 dark:ring-red-400/40' : '';
  const parts = (message.bubbles?.length
    ? message.bubbles.map(bubble => bubble.text)
    : message.content.split('\n'))
    .map(part => part.trim())
    .filter(Boolean);
  const showParts = parts.length > 0 ? parts : ['（模型没有返回正文）'];
  const firstBubbleDelay = message.bubbles?.[0]?.delayMs ?? 0;

  return (
    <div
      data-message-id={message.id}
      className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`group flex max-w-[86%] flex-col gap-1 sm:max-w-[74%] ${isUser ? 'items-end' : 'items-start'}`}>
        {isEditing ? (
          <div className={`rounded-3xl px-4 py-3 text-sm shadow-sm ${bubbleClass} ${failedClass}`}>
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
                  className="rounded-full bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : (
          showParts.map((part, index) => (
            <div
              key={`${message.id}-part-${index}`}
              className={`rounded-3xl px-4 py-3 text-sm shadow-sm ${bubbleClass} ${failedClass} ${
                message.bubbles?.length ? 'animate-bubble-in' : ''
              }`}
              style={message.bubbles?.length
                ? {
                  animationDelay: `${Math.max(
                    0,
                    Math.min(2600, (message.bubbles[index]?.delayMs ?? 0) - firstBubbleDelay),
                  )}ms`,
                }
                : undefined}
            >
              <p className="whitespace-pre-wrap leading-6">{part}</p>
            </div>
          ))
        )}

        {!isUser && message.sticker && !isEditing && (
          <StickerBubble sticker={message.sticker} />
        )}

        {!isUser && message.material && !isEditing && (
          <MaterialCard material={message.material} />
        )}

        {isUser && message.readAt && (
          <span className="pr-1 text-[10px] text-slate-400 dark:text-slate-500">已读</span>
        )}

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
