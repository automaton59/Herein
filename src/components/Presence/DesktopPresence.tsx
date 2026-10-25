import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, MessageCircle, Send } from 'lucide-react';
import { Live2DStage, type PresenceActivity } from '../Avatar/Live2DStage';
import {
  getDesktopShell,
  type DesktopPresenceState,
  type DesktopShellState,
  type PresenceEmotion,
} from '../../services/desktopPresence';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';
import { CoreClient } from '../../services/coreClient';

const EMOTION_SET = new Set<string>([
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'excited',
  'worried',
  'playful',
  'serious',
]);

function normalizeEmotion(value: unknown): PresenceEmotion {
  return typeof value === 'string' && EMOTION_SET.has(value.trim().toLowerCase())
    ? value.trim().toLowerCase() as PresenceEmotion
    : 'neutral';
}

function hostStatusLabel(_shell: DesktopShellState | null) {
  return '桌面在线';
}

interface PresenceBubble {
  id: string;
  messageId?: string;
  text: string;
  at: number;
}

export function DesktopPresence() {
  const shell = useMemo(() => getDesktopShell(), []);
  const [state, setState] = useState<DesktopPresenceState | null>(null);
  const [shellState, setShellState] = useState<DesktopShellState | null>(null);
  const [emotion, setEmotion] = useState<PresenceEmotion>('neutral');
  const [modelError, setModelError] = useState('');
  const [hovered, setHovered] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activity, setActivity] = useState<PresenceActivity>('idle');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [bubbles, setBubbles] = useState<PresenceBubble[]>([]);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const bubbleTimers = useRef<number[]>([]);
  const activityTimer = useRef<number | null>(null);
  const lastBubbleRef = useRef({ text: '', at: 0 });
  const stateRef = useRef<DesktopPresenceState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const showBubble = useCallback((text: string, messageId?: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();

    if (!clean) {
      return;
    }

    const now = Date.now();

    if (lastBubbleRef.current.text === clean && now - lastBubbleRef.current.at < 4000) {
      return;
    }

    lastBubbleRef.current = { text: clean, at: now };
    const bubble: PresenceBubble = {
      id: crypto.randomUUID(),
      messageId,
      text: clean,
      at: now,
    };
    setBubbles(previous => [...previous.slice(-1), bubble]);
    setActivity('replying');

    if (activityTimer.current !== null) {
      window.clearTimeout(activityTimer.current);
    }

    activityTimer.current = window.setTimeout(() => {
      setActivity('idle');
    }, 2400);

    const timer = window.setTimeout(() => {
      setBubbles(previous => previous.filter(item => item.id !== bubble.id));
    }, 10_000);
    bubbleTimers.current.push(timer);
  }, []);

  useEffect(() => () => {
    bubbleTimers.current.forEach(timer => window.clearTimeout(timer));
    bubbleTimers.current = [];
    if (activityTimer.current !== null) {
      window.clearTimeout(activityTimer.current);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    const characterId = stateRef.current?.character.id;

    if (!text || !characterId || sending) {
      return;
    }

    setDraft('');
    setSending(true);
    setNotice('');
    setActivity('thinking');

    try {
      const baseUrl = (window.hereinCore?.url || localStorage.getItem(CORE_URL_KEY) || '')
        .replace(/\/+$/, '');
      const token = window.hereinCore?.token || localStorage.getItem(CORE_TOKEN_KEY) || '';

      if (!baseUrl) {
        throw new Error('本地服务未就绪');
      }

      const core = new CoreClient({ baseUrl, token });
      const recent = await core.listMessages(characterId, 10);
      const history = recent.messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({ role: message.role as 'user' | 'assistant', content: message.content }));
      const result = await core.chat(characterId, [...history, { role: 'user', content: text }], {
        persist: true,
      });
      const reply = result.message?.content?.trim();

      if (result.silent) {
        setActivity('idle');
        return;
      }

      if (!reply) {
        throw new Error('没有收到回复');
      }

      setEmotion(normalizeEmotion(result.message?.emotion ?? result.presence?.emotion));
      showBubble(reply, result.message?.id);
    } catch (error) {
      setActivity('idle');
      setNotice(error instanceof Error ? error.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [draft, sending, showBubble]);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number | null;
    originY: number | null;
    deltaX: number;
    deltaY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('presence-mode');
    document.body.classList.add('presence-mode');
    document.title = '此间 · 桌面形象';

    return () => {
      document.documentElement.classList.remove('presence-mode');
      document.body.classList.remove('presence-mode');
    };
  }, []);

  const loadState = useCallback(async () => {
    if (!shell) {
      return;
    }

    try {
      const next = await shell.presence.getState();

      if (next) {
        setState(next);
        setEmotion(next.emotion);
      }

      setShellState(await shell.presence.getShellState());
    } catch (error) {
      console.warn('desktop presence state failed', error);
    }
  }, [shell]);

  useEffect(() => {
    void loadState();

    if (!shell) {
      return undefined;
    }

    const offState = shell.presence.onState(next => {
      setState(next);
      setEmotion(next.emotion);
    });
    const offShell = shell.presence.onShellState(next => setShellState(next));

    return () => {
      offState();
      offShell();
    };
  }, [loadState, shell]);

  useEffect(() => {
    const base = (window.hereinCore?.url || localStorage.getItem(CORE_URL_KEY) || '')
      .replace(/\/+$/, '');

    if (!base) {
      return undefined;
    }

    const token = window.hereinCore?.token || localStorage.getItem(CORE_TOKEN_KEY) || '';
    const source = new EventSource(`${base}/v1/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);

    const onCoreEvent = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as {
          type?: string;
          characterId?: string;
          message?: { id?: string; content?: string; emotion?: string | null } | string;
          emotion?: string | null;
        };
        const message = parsed.message;
        const content = typeof message === 'string' ? message : message?.content;
        const messageId = typeof message === 'string' ? undefined : message?.id;
        const messageEmotion = typeof message === 'string' ? parsed.emotion : message?.emotion ?? parsed.emotion;

        if (parsed.type === 'chat.completed' || parsed.type === 'assistant.proactive') {
          setEmotion(normalizeEmotion(messageEmotion));

          if (content?.trim()) {
            showBubble(content, messageId);
          }
        }
      } catch {
        // Ignore malformed events. EventSource reconnects transport failures.
      }
    };

    source.addEventListener('core', onCoreEvent as EventListener);

    return () => {
      source.removeEventListener('core', onCoreEvent as EventListener);
      source.close();
    };
  }, [showBubble]);

  useEffect(() => {
    setModelError('');
  }, [state?.avatar?.kind === 'live2d' ? state.avatar.modelUrl : '']);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !shell) {
      return;
    }

    if ((event.target as HTMLElement).closest('[data-presence-control]')) {
      return;
    }

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    // Register the drag synchronously. Asking the shell for the window origin
    // is async, and the old await-first version dropped every move made before
    // the IPC round trip answered (or left a ghost drag behind when the user
    // released quickly).
    const drag = {
      pointerId,
      startX: event.screenX,
      startY: event.screenY,
      originX: null as number | null,
      originY: null as number | null,
      deltaX: 0,
      deltaY: 0,
      moved: false,
    };

    dragRef.current = drag;

    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works while the pointer
      // stays over the window.
    }

    setDragActive(true);

    void shell.presence.getBounds().then(bounds => {
      if (!bounds || dragRef.current !== drag) {
        return;
      }

      drag.originX = bounds.x;
      drag.originY = bounds.y;

      if (drag.moved) {
        shell.presence.moveTo(bounds.x + drag.deltaX, bounds.y + drag.deltaY);
      }
    }).catch(() => undefined);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId || !shell) {
      return;
    }

    const deltaX = event.screenX - drag.startX;
    const deltaY = event.screenY - drag.startY;

    drag.deltaX = deltaX;
    drag.deltaY = deltaY;

    if (!drag.moved) {
      if (Math.abs(deltaX) <= 4 && Math.abs(deltaY) <= 4) {
        return;
      }

      drag.moved = true;
    }

    // The move is relative to the window origin captured at pointer-down, so a
    // window that is already being dragged can never feed its own displacement
    // back into the next frame.
    if (drag.originX === null || drag.originY === null) {
      return;
    }

    shell.presence.moveTo(drag.originX + deltaX, drag.originY + deltaY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDragActive(false);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (!drag.moved) {
      const relativeY = event.clientY / Math.max(1, window.innerHeight);

      setActivity('reacting');
      window.setTimeout(() => setActivity('idle'), 1200);

      if (relativeY < 0.56) {
        // Head pat / face poke: react in place instead of opening the chat.
        const previousEmotion = emotion;
        setEmotion(relativeY < 0.28 ? 'shy' : 'playful');
        window.setTimeout(() => setEmotion(previousEmotion), 1600);
      } else {
        void shell?.presence.openChat();
      }
    }
  };

  const avatar = state?.avatar ?? null;
  const displayName = state?.character.name ?? '此间';
  const hosting = shellState?.hosting ?? state?.hosting ?? false;
  const showLive2D = avatar?.kind === 'live2d' && Boolean(avatar.coreUrl) && !modelError;
  // The composer is a hover affordance: the character is the point of the
  // window, so the bar only slides in when the pointer is over it. It also
  // stays put while it holds a draft, a reply is in flight, or it has focus.
  const showInputBar = hovered
    || inputFocused
    || Boolean(draft.trim())
    || sending
    || Boolean(notice);

  return (
    <div
      className="relative h-[100dvh] w-full select-none overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={event => {
        event.preventDefault();
        void shell?.presence.showContextMenu();
      }}
    >
      <div
        className={`absolute inset-0 z-10 touch-none ${dragActive ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-2">
          {showLive2D && avatar?.kind === 'live2d' && avatar.coreUrl ? (
            <div className="presence-avatar-shadow h-full w-full">
              <Live2DStage
                modelUrl={avatar.modelUrl}
                coreUrl={avatar.coreUrl}
                emotion={emotion}
                activity={activity}
                expressionMap={avatar.expressionMap}
                scale={avatar.scale}
                offsetX={avatar.offsetX}
                offsetY={avatar.offsetY}
                onError={setModelError}
              />
            </div>
          ) : avatar?.kind === 'video' ? (
            <video
              src={avatar.src}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          ) : avatar?.kind === 'image' ? (
            <img src={avatar.src} alt={displayName} className="h-full w-full object-contain" />
          ) : (
            <div className="mx-4 mb-10 w-full max-w-[320px] rounded-3xl border border-white/20 bg-[#0B1020]/90 p-5 text-sky-50 shadow-2xl shadow-black/30 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#7C8FD0]/25 text-lg font-semibold text-[#C9D4F2]">
                  {displayName.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{displayName}</div>
                  <div className="mt-0.5 text-[11px] text-sky-100/60">{hostStatusLabel(shellState)}</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-sky-100/70">
                {modelError || state?.notice || '形象还没有准备好。'}
              </p>
              <button
                type="button"
                data-presence-control
                onClick={() => void shell?.presence.openChat()}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[#7C8FD0] text-[12px] font-semibold text-[#0B1020] hover:bg-[#9CA3D4]"
              >
                <MessageCircle size={14} />
                打开聊天
              </button>
            </div>
          )}
        </div>
      </div>

      {bubbles.length > 0 ? (
        <div
          data-presence-control
          className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-start gap-2"
        >
          {bubbles.map(bubble => (
            <button
              key={bubble.id}
              type="button"
              onClick={() => void shell?.presence.openChat(bubble.messageId)}
              className="pointer-events-auto max-w-[86%] rounded-2xl rounded-bl-md border border-white/10 bg-[#0B1020]/85 px-3 py-2 text-left text-[12px] leading-5 text-sky-50 shadow-xl shadow-black/30 backdrop-blur-md transition hover:bg-[#0B1020]/95"
            >
              <span className="line-clamp-3 whitespace-pre-wrap">{bubble.text}</span>
              <span className="mt-1 block text-[9px] text-sky-100/35">点击进入聊天</span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        data-presence-control
        className={`absolute inset-x-3 bottom-3 z-30 rounded-2xl border border-white/10 bg-[#0B1020]/80 p-2 shadow-xl shadow-black/30 backdrop-blur-md transition-all duration-200 ease-out ${
          showInputBar
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        <div className="flex items-end gap-2">
          <div
            className="flex shrink-0 select-none items-center gap-1.5 self-center pl-1 text-[10px] font-medium leading-none text-sky-100/45"
            title={`${hostStatusLabel(shellState)}${hosting ? ' · 托管中' : ''}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-aqua-400 shadow-[0_0_0_3px_rgba(124,200,234,0.14)]" />
            <span className="whitespace-nowrap">{hostStatusLabel(shellState)}</span>
            {hosting ? (
              <span className="rounded-full bg-[#7C8FD0]/20 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#C9D4F2]">
                托管
              </span>
            ) : null}
          </div>
          <span className="h-3.5 w-px shrink-0 self-center bg-white/10" />
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={500}
            placeholder={sending ? '正在想…' : '和她说点什么…'}
            aria-label="输入消息"
            onChange={event => setDraft(event.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            className="max-h-20 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[12px] leading-5 text-sky-50 outline-none placeholder:text-sky-100/35"
          />
          <button
            type="button"
            aria-label="发送"
            title="发送"
            disabled={sending || !draft.trim()}
            onClick={() => void sendMessage()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#7C8FD0] text-[#0B1020] transition hover:bg-[#9CA3D4] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-sky-100/30"
          >
            <Send size={14} />
          </button>
          <button
            type="button"
            aria-label="打开聊天"
            title="打开聊天"
            onClick={() => void shell?.presence.openChat()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-sky-100/60 hover:bg-white/10 hover:text-sky-50"
          >
            <Maximize2 size={13} />
          </button>
        </div>
        {notice ? (
          <div className="mt-1 truncate rounded-lg bg-black/20 px-2 py-1 text-[9px] text-rose-200/80">
            {notice}
          </div>
        ) : null}
      </div>
    </div>
  );
}
