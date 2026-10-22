import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Mic, MicOff, Minus, PhoneOff, Radio, Send, Volume2, VolumeX } from 'lucide-react';
import type { VoiceConfig } from '../../services/interfaces';
import type { DynamicAvatarSource } from '../../services/phase3/presentation';
import { Live2DStage } from '../Avatar/Live2DStage';
import { CORE_URL_KEY } from '../../services/chatHistory';
import {
  createSpeechRecognitionController,
  createTextToSpeechController,
  type VoiceRuntime,
} from '../../services/phase3/voice';

interface CallWindowProps {
  displayName: string;
  statusLabel: string;
  elapsedLabel: string;
  imageSrc?: string;
  dynamicSource?: DynamicAvatarSource | null;
  subtitle?: string;
  latestUserMessage?: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  voiceRuntime?: VoiceRuntime;
  voiceConfig?: VoiceConfig;
  isLoading: boolean;
  onSend: (content: string) => void;
  onMinimize: () => void;
  onClose: () => void;
}

const EXPRESSION_EMOJI: Record<string, string> = {
  neutral: '🙂',
  happy: '😊',
  sad: '😢',
  angry: '😠',
  shy: '☺️',
  excited: '🤩',
  worried: '😟',
};

function normalizeEmotionLabel(emotion?: string | null) {
  return emotion?.trim().toLowerCase() || 'neutral';
}

function expressionEmojiFor(emotion?: string | null) {
  return EXPRESSION_EMOJI[normalizeEmotionLabel(emotion)] ?? EXPRESSION_EMOJI.neutral;
}

export function CallWindow({
  displayName,
  statusLabel,
  elapsedLabel,
  imageSrc,
  dynamicSource,
  subtitle,
  latestUserMessage,
  emotion,
  voiceInstruct,
  voiceRuntime,
  voiceConfig,
  isLoading,
  onSend,
  onMinimize,
  onClose,
}: CallWindowProps) {
  const [draft, setDraft] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const runtime = voiceRuntime ?? (typeof window === 'undefined' ? {} : window as unknown as VoiceRuntime);
  const speechController = useMemo(() => createTextToSpeechController(runtime, voiceConfig), [runtime, voiceConfig]);
  const recognitionController = useMemo(() => createSpeechRecognitionController(runtime), [runtime]);
  const subtitleText = subtitle?.trim() ?? '';
  const userMessageText = latestUserMessage?.trim() ?? '';
  const canSpeakSubtitle = speechController.isSupported && Boolean(subtitleText);
  const expressionEmoji = expressionEmojiFor(emotion);
  const live2d = useMemo(() => {
    if (dynamicSource?.kind !== 'live2d') {
      return null;
    }

    try {
      const base = (localStorage.getItem(CORE_URL_KEY) ?? '').replace(/\/+$/, '');
      const entry = dynamicSource.entry.replace(/^assets[\\/]/, '');

      if (!base || !entry) {
        return null;
      }

      return {
        modelUrl: `${base}/assets/${entry}`,
        coreUrl: `${base}/assets/live2d/core/live2d.min.js?v=2`,
      };
    } catch {
      return null;
    }
  }, [dynamicSource]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();

    if (!content || isLoading) {
      return;
    }

    onSend(content);
    setDraft('');
  };

  const playSubtitle = () => {
    if (!subtitleText) {
      return;
    }

    void speechController.speak(subtitleText, { emotion, instruct: voiceInstruct });
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionController.stop();
      setIsListening(false);
      return;
    }

    setIsListening(true);
    recognitionController.start(
      (transcript) => {
        setDraft(transcript.trim());
        setIsListening(false);
      },
      () => setIsListening(false),
    );
  };

  useEffect(() => {
    if (autoSpeak && subtitleText) {
      void speechController.speak(subtitleText, { emotion, instruct: voiceInstruct });
    }
  }, [autoSpeak, emotion, speechController, subtitleText, voiceInstruct]);

  useEffect(() => {
    return () => {
      speechController.cancel();
      recognitionController.stop();
    };
  }, [recognitionController, speechController]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <section
        role="dialog"
        aria-label={`${displayName} 视频通话`}
        className="flex h-[min(760px,calc(100vh-3rem))] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-[#fff8f7] shadow-2xl shadow-slate-950/20 dark:border-white/10 dark:bg-[#140f16] dark:shadow-black/40"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/70 px-4 dark:border-white/10">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-950 dark:text-rose-50">{displayName}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{statusLabel} · {elapsedLabel}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="最小化通话"
              onClick={onMinimize}
              className="grid h-9 w-9 place-items-center rounded-full border border-rose-100 bg-white text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              aria-label="结束通话"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full bg-red-500 text-white hover:bg-red-600 dark:bg-red-400 dark:text-[#1b1018] dark:hover:bg-red-300"
            >
              <PhoneOff size={16} />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,#ffe4e6_0,#fff8f7_46%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_center,#3a1728_0,#1b1018_46%,#0d1118_100%)]">
          <div className="absolute inset-x-0 bottom-0 top-0 grid place-items-center px-6 pb-36 pt-6">
            {dynamicSource?.kind === 'video' ? (
              <video
                aria-label={`${displayName} 动态形象`}
                src={dynamicSource.src}
                autoPlay
                loop
                muted
                playsInline
                className="h-full max-h-full w-full object-contain"
              />
            ) : dynamicSource?.kind === 'live2d' ? (
              <div className="relative grid h-full max-h-full w-full place-items-center">
                {live2d ? (
                  <Live2DStage
                    coreUrl={live2d.coreUrl}
                    modelUrl={live2d.modelUrl}
                    emotion={emotion}
                  />
                ) : imageSrc ? (
                  <img src={imageSrc} alt={`${displayName} 当前形象`} className="h-full max-h-full w-full object-contain" />
                ) : (
                  <div className="grid h-52 w-52 place-items-center rounded-full bg-white/75 text-5xl font-semibold text-rose-400 shadow-sm dark:bg-white/10 dark:text-rose-200">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {!live2d && (
                  <div className="absolute right-4 top-4 rounded-2xl border border-white/75 bg-white/85 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#211821]/85 dark:text-rose-100">
                    Live2D 动态形象
                  </div>
                )}
              </div>
            ) : imageSrc ? (
              <img src={imageSrc} alt={`${displayName} 当前形象`} className="h-full max-h-full w-full object-contain" />
            ) : (
              <div className="grid h-52 w-52 place-items-center rounded-full bg-white/75 text-5xl font-semibold text-rose-400 shadow-sm dark:bg-white/10 dark:text-rose-200">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div
              aria-label={`当前表情：${normalizeEmotionLabel(emotion)}`}
              className="absolute right-[18%] top-[18%] grid h-16 w-16 place-items-center rounded-full border border-white/75 bg-white/85 text-4xl shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#211821]/85"
            >
              {expressionEmoji}
            </div>
          </div>

          <div className="absolute inset-x-4 bottom-4 grid gap-3">
            <div className="grid max-h-44 gap-2 overflow-y-auto rounded-2xl border border-white/75 bg-white/85 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#211821]/85 dark:text-rose-50">
              {userMessageText ? (
                <div className="text-xs leading-5 text-slate-500 dark:text-rose-100/65">我：{userMessageText}</div>
              ) : null}
              <div>{subtitle || (isLoading ? '正在输入...' : '通话已接通。')}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                aria-label="播放当前字幕"
                title="播放当前字幕"
                onClick={playSubtitle}
                disabled={!canSpeakSubtitle}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white text-slate-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 dark:border-white/10 dark:bg-[#211821] dark:text-rose-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
              >
                <Volume2 size={16} />
              </button>
              <button
                type="button"
                aria-label="停止朗读"
                title="停止朗读"
                onClick={speechController.cancel}
                disabled={!speechController.isSupported}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white text-slate-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 dark:border-white/10 dark:bg-[#211821] dark:text-rose-100 dark:hover:bg-white/10 dark:disabled:text-slate-600"
              >
                <VolumeX size={16} />
              </button>
              <button
                type="button"
                aria-label="自动朗读字幕"
                title="自动朗读字幕"
                aria-pressed={autoSpeak}
                onClick={() => setAutoSpeak(value => !value)}
                disabled={!speechController.isSupported}
                className={`grid h-9 w-9 place-items-center rounded-full border text-slate-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-rose-100 dark:hover:bg-white/10 dark:disabled:text-slate-600 ${
                  autoSpeak
                    ? 'border-rose-300 bg-rose-50 dark:border-rose-300/40 dark:bg-rose-300/15'
                    : 'border-white/80 bg-white dark:border-white/10 dark:bg-[#211821]'
                }`}
              >
                <Radio size={16} />
              </button>
            </div>
            <form onSubmit={submit} className="flex items-end gap-2">
              <button
                type="button"
                aria-label={isListening ? '停止语音输入' : '开始语音输入'}
                title={isListening ? '停止语音输入' : '开始语音输入'}
                onClick={toggleListening}
                disabled={!recognitionController.isSupported}
                className={`grid h-11 w-11 place-items-center rounded-full border text-slate-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-rose-100 dark:hover:bg-white/10 dark:disabled:text-slate-600 ${
                  isListening
                    ? 'border-rose-300 bg-rose-50 dark:border-rose-300/40 dark:bg-rose-300/15'
                    : 'border-white/80 bg-white dark:border-white/10 dark:bg-[#211821]'
                }`}
              >
                {isListening ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="输入文字..."
                rows={1}
                className="min-h-11 flex-1 resize-none rounded-2xl border border-white/80 bg-white px-4 py-3 text-sm text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-[#211821] dark:text-rose-50 dark:focus:ring-rose-300/10"
              />
              <button
                type="submit"
                aria-label="发送通话消息"
                disabled={isLoading || !draft.trim()}
                className="grid h-11 w-11 place-items-center rounded-full bg-rose-500 text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-rose-400 dark:text-[#1b1018] dark:hover:bg-rose-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
              >
                <Send size={17} />
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
