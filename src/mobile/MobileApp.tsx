import React from 'react';
import { Live2DStage } from '../components/Avatar/Live2DStage';
import {
  canShowRecommendation,
  shouldProactivelyShare,
  wantsRecommendation,
  type RecentRecommendation,
} from './recommendation';

const STORAGE_KEY = 'herein-mobile-core';
const CHARACTER_ID = 'herein-default';
const LAST_RECOMMEND_KEY = 'herein-last-recommend-at';
const RECENT_RECOMMEND_KEY = 'herein-recent-recommendations';

interface CoreConfig {
  url: string;
  token: string;
}

interface SongCandidate {
  itemId: string;
  title: string;
  creator?: string;
  coverUrl?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  status?: 'pending' | 'sent' | 'failed';
  clientMessageId?: string;
  recommendation?: {
    itemId: string;
    title: string;
    creator?: string;
    coverUrl?: string;
  };
}

interface PendingOutboxItem {
  id: string;
  content: string;
  createdAt: string;
}

const OUTBOX_KEY = 'herein-mobile-outbox';

function readOutbox(): PendingOutboxItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is PendingOutboxItem => (
      typeof item === 'object'
      && item !== null
      && typeof (item as PendingOutboxItem).id === 'string'
      && typeof (item as PendingOutboxItem).content === 'string'
    )).slice(-20);
  } catch {
    return [];
  }
}

function writeOutbox(items: PendingOutboxItem[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-20)));
  } catch {
    // Storage may be unavailable; the in-memory pending message still exists.
  }
}

function enqueueOutbox(item: PendingOutboxItem) {
  const items = readOutbox().filter(existing => existing.id !== item.id);
  writeOutbox([...items, item]);
}

interface SystemStatusComponent {
  status: string;
  message?: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

interface SystemStatus {
  ok: boolean;
  degraded: boolean;
  version: string;
  uptimeMs: number;
  now: string;
  components: {
    core: SystemStatusComponent;
    db: SystemStatusComponent;
    llm: SystemStatusComponent;
    tts: SystemStatusComponent;
    plugins: SystemStatusComponent;
    agents: SystemStatusComponent;
    relay: SystemStatusComponent;
  };
}

function loadConfig(): CoreConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CoreConfig>;
    if (!parsed.url) {
      return null;
    }

    return { url: parsed.url.replace(/\/+$/, ''), token: parsed.token ?? '' };
  } catch {
    return null;
  }
}

function saveConfig(config: CoreConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function readRecentRecommendations(): RecentRecommendation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_RECOMMEND_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is RecentRecommendation => (
      typeof item === 'object'
      && item !== null
      && typeof (item as RecentRecommendation).itemId === 'string'
      && typeof (item as RecentRecommendation).at === 'string'
    ));
  } catch {
    return [];
  }
}

function rememberRecommendation(itemId: string, at: string, previous: RecentRecommendation[]) {
  localStorage.setItem(LAST_RECOMMEND_KEY, at);
  localStorage.setItem(
    RECENT_RECOMMEND_KEY,
    JSON.stringify([{ itemId, at }, ...previous].slice(0, 30)),
  );
}

function authHeaders(config: CoreConfig): Record<string, string> {
  return config.token ? { authorization: `Bearer ${config.token}` } : {};
}

async function coreRequest<T>(config: CoreConfig, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.url}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(config),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
  }

  return JSON.parse(text) as T;
}

function componentLabel(component: SystemStatusComponent | undefined) {
  switch (component?.status) {
    case 'ok':
      return '正常';
    case 'degraded':
      return '降级';
    case 'unavailable':
      return '不可用';
    case 'unconfigured':
      return '未配置';
    default:
      return '未知';
  }
}

function componentTone(component: SystemStatusComponent | undefined) {
  switch (component?.status) {
    case 'ok':
      return 'text-emerald-300';
    case 'degraded':
      return 'text-amber-300';
    case 'unavailable':
      return 'text-sky-300';
    default:
      return 'text-sky-200/50';
  }
}

function ConnectionScreen({ onConnect }: { onConnect: (config: CoreConfig) => void }) {
  const stored = loadConfig();
  const [url, setUrl] = React.useState(stored?.url ?? 'http://192.168.1.3:8787');
  const [token, setToken] = React.useState(stored?.token ?? '');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showToken, setShowToken] = React.useState(false);

  const pasteToken = async () => {
    try {
      const text = await navigator.clipboard?.readText();

      if (text?.trim()) {
        setToken(text.trim());
        setError('');
      }
    } catch {
      setError('剪贴板不可用，请长按输入框手动粘贴');
    }
  };

  const clearSaved = () => {
    if (!window.confirm('清除本机保存的地址和 Token？')) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setUrl('http://192.168.1.3:8787');
    setToken('');
    setError('已清除本机记录');
  };

  const connect = async () => {
    const config = { url: url.trim().replace(/\/+$/, ''), token: token.trim() };
    if (!config.url) {
      setError('先填 Core 地址');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await coreRequest<{ ok: boolean }>(config, '/health');
      saveConfig(config);
      onConnect(config);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : '连接失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-[#04101a] px-6 text-sky-50">
      <div className="mx-auto w-full max-w-sm">
        <p className="text-sm tracking-[0.3em] text-sky-300/70">HEREIN</p>
        <h1 className="mt-3 text-3xl font-semibold">蓝蓝在等你</h1>
        <p className="mt-2 text-sm leading-6 text-sky-100/60">
          手机和电脑连同一个 Wi-Fi，填电脑的局域网地址。默认端口 8787。
        </p>

        <label className="mt-8 block text-xs text-sky-200/60">Core 地址</label>
        <input
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="http://192.168.1.3:8787"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-sky-100/30 focus:border-sky-300/50"
        />

        <label className="mt-4 block text-xs text-sky-200/60">Token（Core 开了 token 就必填）</label>
        <input
          value={token}
          onChange={event => setToken(event.target.value)}
          placeholder="HEREIN_CORE_TOKEN"
          type={showToken ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-sky-100/30 focus:border-sky-300/50"
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void pasteToken()}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-sky-100"
          >
            粘贴 Token
          </button>
          <button
            type="button"
            onClick={() => setShowToken(value => !value)}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-sky-100"
          >
            {showToken ? '隐藏' : '显示'}
          </button>
          <button
            type="button"
            onClick={clearSaved}
            className="ml-auto text-[11px] text-sky-200/40"
          >
            清除记录
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-sky-200/35">
          点聊天页的“换地址”只返回这里，不会清除已保存的 Token。
        </p>

        {error && <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

        <button
          onClick={() => void connect()}
          disabled={busy}
          className="mt-6 w-full rounded-2xl bg-sky-300 py-3 text-sm font-semibold text-[#04101a] disabled:opacity-50"
        >
          {busy ? '连接中…' : '连接'}
        </button>
      </div>
    </div>
  );
}

function ChatScreen({ config, onDisconnect }: { config: CoreConfig; onDisconnect: () => void }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [status, setStatus] = React.useState('连接中…');
  const [systemStatus, setSystemStatus] = React.useState<SystemStatus | null>(null);
  const [systemStatusError, setSystemStatusError] = React.useState('');
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [outboxCount, setOutboxCount] = React.useState(() => readOutbox().length);
  const [proactiveToast, setProactiveToast] = React.useState('');
  const [isAppVisible, setIsAppVisible] = React.useState(() => document.visibilityState !== 'hidden');
  const [isOnline, setIsOnline] = React.useState(() => navigator.onLine !== false);
  const [speakingId, setSpeakingId] = React.useState<string | null>(null);
  const [showAvatar, setShowAvatar] = React.useState(false);
  const [mouthOpen, setMouthOpen] = React.useState(0);
  const messagesRef = React.useRef<ChatMessage[]>([]);
  const flushingRef = React.useRef(false);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const mouthRafRef = React.useRef<number | null>(null);

  const stopMouthSync = () => {
    if (mouthRafRef.current !== null) {
      cancelAnimationFrame(mouthRafRef.current);
      mouthRafRef.current = null;
    }

    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    analyserRef.current = null;
    setMouthOpen(0);
  };

  const startMouthSync = (audio: HTMLAudioElement) => {
    stopMouthSync();
    const AudioContextCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    const context = new AudioContextCtor();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(context.destination);
    audioContextRef.current = context;
    analyserRef.current = analyser;
    void context.resume().catch(() => undefined);

    const samples = new Uint8Array(analyser.fftSize);
    let lastUpdate = 0;
    const tick = (time: number) => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;

      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }

      if (time - lastUpdate > 33) {
        lastUpdate = time;
        setMouthOpen(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      }

      mouthRafRef.current = requestAnimationFrame(tick);
    };

    mouthRafRef.current = requestAnimationFrame(tick);
  };

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    stopMouthSync();
    setSpeakingId(null);

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  React.useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
    }
  }, []);

  React.useEffect(() => {
    messagesRef.current = messages;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  React.useEffect(() => {
    if (!proactiveToast) {
      return;
    }

    const timer = setTimeout(() => setProactiveToast(''), 8000);
    return () => clearTimeout(timer);
  }, [proactiveToast]);

  const toggleSpeak = async (message: ChatMessage) => {
    if (speakingId === message.id) {
      stopAudio();
      return;
    }

    stopAudio();

    try {
      setStatus('在生成语音…');
      const response = await fetch(`${config.url}/v1/tts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders(config),
        },
        body: JSON.stringify({
          text: message.content,
          emotion: 'neutral',
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail.slice(0, 160) || `TTS HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioUrlRef.current = url;
      audioRef.current = audio;
      startMouthSync(audio);
      setSpeakingId(message.id);
      audio.onended = () => {
        stopAudio();
        setStatus('已连接');
      };
      audio.onerror = () => {
        stopAudio();
        setStatus('语音播放失败');
      };
      await audio.play();
      setStatus('正在说话…');
    } catch (error) {
      stopAudio();
      setStatus(error instanceof Error ? `语音失败：${error.message}` : '语音失败');
    }
  };

  const refreshMessages = React.useCallback(async () => {
    try {
      const data = await coreRequest<{ messages: ChatMessage[] }>(
        config,
        `/v1/timeline/${CHARACTER_ID}/messages?limit=50`,
      );
      setMessages(current => {
        const pending = current.filter(message => (
          message.status === 'pending' && Boolean(message.clientMessageId)
        ));

        return [...data.messages, ...pending];
      });
      setOutboxCount(readOutbox().length);
      setStatus('已连接');

      const lastMessage = data.messages[data.messages.length - 1];
      if (lastMessage) {
        void coreRequest(config, `/v1/read-state/${CHARACTER_ID}`, {
          method: 'POST',
          body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
        }).catch(() => undefined);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '连接失败');
    }
  }, [config]);

  React.useEffect(() => {
    if (!isAppVisible || !isOnline) {
      return;
    }

    const tokenQuery = config.token ? `?token=${encodeURIComponent(config.token)}` : '';
    const source = new EventSource(`${config.url}/v1/events${tokenQuery}`);

    const onShared = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: {
            itemId?: string;
            title?: string;
            creator?: string;
            coverUrl?: string;
            shareLine?: string;
          };
        };

        if (parsed.type !== 'song.shared' || !parsed.payload?.itemId || !parsed.payload.title) {
          return;
        }

        const song = parsed.payload;
        const itemId = song.itemId;
        const title = song.title;

        if (!itemId || !title) {
          return;
        }

        setMessages(current => {
          if (current.some(message => message.recommendation?.itemId === itemId)) {
            return current;
          }

          return [...current, {
            id: `share-${itemId}-${Date.now()}`,
            role: 'assistant',
            content: song.shareLine ?? '这个好听。',
            recommendation: {
              itemId,
              title,
              creator: song.creator,
              coverUrl: song.coverUrl,
            },
          }];
        });
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    source.addEventListener('song.shared', onShared as EventListener);

    const onCore = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: { message?: { content?: string } };
        };

        if (parsed.type === 'assistant.proactive' && parsed.payload?.message?.content) {
          setProactiveToast(parsed.payload.message.content);
        }

        if (
          parsed.type === 'chat.completed'
          || parsed.type === 'timeline.synced'
          || parsed.type === 'assistant.proactive'
        ) {
          void refreshMessages();
        }
      } catch {
        // Ignore malformed core events.
      }
    };

    source.addEventListener('core', onCore as EventListener);
    return () => {
      source.removeEventListener('song.shared', onShared as EventListener);
      source.removeEventListener('core', onCore as EventListener);
      source.close();
    };
  }, [config, refreshMessages, isAppVisible, isOnline]);

  React.useEffect(() => {
    if (isAppVisible && isOnline) {
      void refreshMessages();
    }
  }, [isAppVisible, isOnline, refreshMessages]);

  React.useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const data = await coreRequest<SystemStatus>(config, '/v1/status');
        if (!cancelled) {
          setSystemStatus(data);
          setSystemStatusError('');
        }
      } catch (error) {
        if (!cancelled) {
          setSystemStatus(null);
          setSystemStatusError(error instanceof Error ? error.message : '状态不可用');
        }
      }
    };

    void loadStatus();
    const timer = setInterval(() => {
      void loadStatus();
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [config]);

  const maybeRecommend = async (text: string) => {
    const explicit = wantsRecommendation(text);
    const now = new Date();
    const lastRecommendedAt = localStorage.getItem(LAST_RECOMMEND_KEY);

    if (!explicit && !shouldProactivelyShare({
      now,
      text,
      lastRecommendedAt,
    })) {
      return;
    }

    try {
      const recent = readRecentRecommendations();
      const candidates = await coreRequest<{ candidates: SongCandidate[] }>(
        config,
        '/v1/netease/candidates',
        {
          method: 'POST',
          // Prefer the Chinese toplist over a mood keyword. Keyword search for
          // "夜晚" can return Russian songs; the LLM can still use the chat
          // context to pick a suitable track.
          body: JSON.stringify({ limit: 3 }),
        },
      );
      const first = candidates.candidates[0];

      if (!first || !canShowRecommendation({
        now,
        itemId: first.itemId,
        lastRecommendedAt,
        recent,
      })) {
        return;
      }

      setStatus('在找歌…');
      const result = await coreRequest<{
        decision: { shouldRecommend: boolean; itemId?: string; reason?: string };
        latencyMs: number;
      }>(config, '/v1/recommend', {
        method: 'POST',
        body: JSON.stringify({
          context: text,
          candidates: candidates.candidates,
          characterName: '蓝蓝',
          // Explicit requests bypass the server cooldown; proactive shares do not.
          ...(explicit ? {
            gate: {
              now: now.toISOString(),
              itemId: first.itemId,
              turnsSinceLast: 99,
            },
          } : {}),
        }),
      });

      if (!result.decision.shouldRecommend || !result.decision.itemId) {
        return;
      }

      const chosen = candidates.candidates.find(item => item.itemId === result.decision.itemId) ?? first;
      const shareLine = (result.decision.reason?.trim() || (explicit ? '喏。' : '这个好听。')).slice(0, 40);

      setMessages(current => [...current, {
        id: `rec-${Date.now()}`,
        role: 'assistant',
        content: shareLine,
        recommendation: {
          itemId: chosen.itemId,
          title: chosen.title,
          creator: chosen.creator,
          coverUrl: chosen.coverUrl,
        },
      }]);
      rememberRecommendation(chosen.itemId, now.toISOString(), recent);
      setStatus(`已连接 · ${result.latencyMs}ms`);
    } catch {
      // Recommendation is best-effort; chat still succeeds if it fails.
    }
  };

  const postChat = React.useCallback(async (text: string, clientMessageId: string) => {
    const history = [
      ...messagesRef.current.filter(message => message.status !== 'pending'),
      { role: 'user' as const, content: text },
    ].slice(-20);

    return coreRequest<{ message: ChatMessage; latencyMs: number }>(config, '/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        characterId: CHARACTER_ID,
        clientMessageId,
        messages: history.map(message => ({ role: message.role, content: message.content })),
        maxTokens: 120,
        persist: true,
      }),
    });
  }, [config]);

  const flushOutbox = React.useCallback(async () => {
    if (flushingRef.current) {
      return;
    }

    const items = readOutbox();

    if (items.length === 0) {
      setOutboxCount(0);
      return;
    }

    flushingRef.current = true;
    let remaining = items;

    try {
      for (const item of items) {
        try {
          const data = await postChat(item.content, item.id);
          remaining = remaining.filter(candidate => candidate.id !== item.id);
          writeOutbox(remaining);
          setOutboxCount(remaining.length);
          setMessages(current => current.filter(message => message.clientMessageId !== item.id));
          setStatus(`已补发 · ${data.latencyMs}ms`);
        } catch (error) {
          setStatus(error instanceof Error ? `还有 ${remaining.length} 条待发送：${error.message}` : '还有消息待发送');
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }

    if (remaining.length === 0) {
      await refreshMessages();
    }
  }, [postChat, refreshMessages]);

  React.useEffect(() => {
    const onVisibility = () => {
      setIsAppVisible(document.visibilityState !== 'hidden');
    };
    const onOnline = () => {
      setIsOnline(true);
      void flushOutbox();
    };
    const onOffline = () => {
      setIsOnline(false);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
      void flushOutbox();
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushOutbox]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) {
      return;
    }

    const clientMessageId = `mobile-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const userMessage: ChatMessage = {
      id: `local-${clientMessageId}`,
      role: 'user',
      content: text,
      status: 'pending',
      clientMessageId,
    };
    setMessages(current => [...current, userMessage]);
    setInput('');
    setSending(true);
    setStatus('她在想…');

    try {
      const data = await postChat(text, clientMessageId);
      setStatus(`已连接 · ${data.latencyMs}ms`);
      void maybeRecommend(text);
      setMessages(current => current.filter(message => message.clientMessageId !== clientMessageId));
      await refreshMessages();
    } catch (error) {
      enqueueOutbox({
        id: clientMessageId,
        content: text,
        createdAt: new Date().toISOString(),
      });
      setOutboxCount(readOutbox().length);
      setMessages(current => current.map(message => (
        message.clientMessageId === clientMessageId
          ? { ...message, status: 'pending' as const }
          : message
      )));
      setStatus(error instanceof Error ? `网络不稳，已排队：${error.message}` : '网络不稳，已排队');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-[#04101a] text-sky-50">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-base font-semibold">海拾香</div>
          <div className="mt-0.5 text-[11px] text-sky-200/50">
            {!isOnline ? '离线，消息会排队' : !isAppVisible ? '后台暂停同步' : status}
          </div>
          {outboxCount > 0 && (
            <div className="mt-0.5 text-[11px] text-amber-300/80">待发送 {outboxCount}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStatusOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-white/5 px-2.5 py-2 text-[11px] text-sky-100/75"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${
              systemStatusError || !systemStatus
                ? 'bg-sky-400'
                : systemStatus.degraded
                  ? 'bg-amber-300'
                  : 'bg-emerald-400'
            }`} />
            {systemStatusError || !systemStatus ? '系统离线' : systemStatus.degraded ? '系统降级' : '系统正常'}
          </button>
          <button onClick={() => setShowAvatar(true)} className="rounded-xl px-3 py-2 text-xs text-sky-200/70">
            形象
          </button>
          <button onClick={onDisconnect} className="rounded-xl px-3 py-2 text-xs text-sky-200/60">
            换地址
          </button>
        </div>
      </header>

      {proactiveToast && (
        <button
          type="button"
          onClick={() => {
            setProactiveToast('');
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="mx-4 mt-3 rounded-2xl border border-sky-400/30 bg-sky-500/15 px-3 py-2 text-left text-xs leading-5 text-sky-100"
        >
          <span className="font-semibold text-sky-200">蓝蓝</span>
          <span className="text-sky-100/80">：{proactiveToast}</span>
        </button>
      )}

      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-16 max-w-xs text-center text-sm leading-6 text-sky-100/40">
            这里还是空的。说句“在吗”试试。
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                message.role === 'user'
                  ? 'rounded-br-md bg-sky-300 text-[#04101a]'
                  : 'rounded-bl-md border border-white/10 bg-white/[0.06] text-sky-50'
              }`}
            >
              {message.recommendation ? (
                <div>
                  {message.content && <div className="mb-2">{message.content}</div>}
                  <div className="flex items-center gap-3 rounded-xl bg-black/20 p-2">
                    {message.recommendation.coverUrl ? (
                      <img
                        src={message.recommendation.coverUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sky-200/70">
                        ♪
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{message.recommendation.title}</div>
                      {message.recommendation.creator && (
                        <div className="truncate text-xs text-sky-100/50">
                          {message.recommendation.creator}
                        </div>
                      )}
                    </div>
                    <div className="ml-auto pr-1 text-sky-200/40">♪</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div>{message.content}</div>
                  {message.status === 'pending' && (
                    <div className="mt-1 text-[10px] text-amber-300/80">待发送</div>
                  )}
                  {message.role === 'assistant' && message.content && (
                    <button
                      type="button"
                      onClick={() => void toggleSpeak(message)}
                      className="mt-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] text-sky-100/80"
                    >
                      {speakingId === message.id ? '■ 停止' : '▶ 朗读'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      {statusOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 p-3"
          onClick={() => setStatusOpen(false)}
        >
          <div
            className="w-full rounded-3xl border border-white/10 bg-[#07131f] p-4 text-sky-50 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">系统状态</div>
                <div className="mt-1 text-[11px] text-sky-200/45">
                  {systemStatus
                    ? `v${systemStatus.version} · 更新于 ${new Date(systemStatus.now).toLocaleTimeString('zh-CN')}`
                    : systemStatusError || '还没有状态'}
                </div>
              </div>
              <button
                onClick={() => setStatusOpen(false)}
                className="rounded-xl bg-white/10 px-3 py-1.5 text-xs text-sky-100"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {systemStatus ? (
                [
                  ['Core', systemStatus.components.core],
                  ['数据库', systemStatus.components.db],
                  ['模型', systemStatus.components.llm],
                  ['声音', systemStatus.components.tts],
                  ['插件', systemStatus.components.plugins],
                  ['Agent', systemStatus.components.agents],
                  ['隧道', systemStatus.components.relay],
                ].map(([label, component]) => {
                  const value = component as SystemStatusComponent;
                  return (
                    <div key={label as string} className="flex items-start justify-between gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-sky-50">{label as string}</div>
                        <div className="mt-0.5 truncate text-[11px] text-sky-200/40">
                          {value.message || '—'}
                        </div>
                      </div>
                      <div className={`shrink-0 text-xs font-medium ${componentTone(value)}`}>
                        {componentLabel(value)}
                        {value.latencyMs ? ` · ${value.latencyMs}ms` : ''}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl bg-sky-600/10 px-3 py-4 text-xs leading-5 text-sky-200/70">
                  {systemStatusError || 'Core 状态不可用。检查地址、Token，或 Core 是否在运行。'}
                </div>
              )}
            </div>

            <div className="mt-3 text-center text-[10px] text-sky-200/30">
              每 20 秒自动刷新
            </div>
          </div>
        </div>
      )}

      {showAvatar && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#04101a]">
          <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <div className="text-sm font-semibold">形象演示</div>
              <div className="mt-0.5 text-[11px] text-sky-200/40">Shizuku · 技术验证</div>
            </div>
            <button
              onClick={() => setShowAvatar(false)}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs text-sky-100"
            >
              关闭
            </button>
          </header>
          <main className="min-h-0 flex-1">
            <Live2DStage
              coreUrl={`${config.url}/assets/live2d/core/live2d.min.js?v=2`}
              modelUrl={`${config.url}/assets/live2d/shizuku/shizuku.model.json?v=1`}
              emotion="neutral"
              mouthOpen={mouthOpen}
            />
          </main>
        </div>
      )}

      <footer className="shrink-0 border-t border-white/10 bg-[#07131f] px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="说点什么…"
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-sky-100/30 focus:border-sky-300/50"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="h-11 shrink-0 rounded-2xl bg-sky-300 px-4 text-sm font-semibold text-[#04101a] disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </footer>
    </div>
  );
}

export function MobileApp() {
  const [config, setConfig] = React.useState<CoreConfig | null>(() => loadConfig());

  if (!config) {
    return <ConnectionScreen onConnect={setConfig} />;
  }

  return (
    <ChatScreen
      config={config}
      onDisconnect={() => {
        // Keep the saved address/token. "换地址" must never log the user out
        // by accident; clearing is an explicit action on the connection screen.
        setConfig(null);
      }}
    />
  );
}
