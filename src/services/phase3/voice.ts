import type {
  GptSovitsVoiceReference,
  LocalTtsSynthesisRequest,
  LocalTtsSynthesisResult,
  VoiceConfig,
  VoiceProvider,
} from '../interfaces';

export interface SpeechSynthesisLike {
  speaking?: boolean;
  getVoices?: () => SpeechSynthesisVoiceLike[];
  speak: (utterance: unknown) => void;
  cancel: () => void;
}

export interface SpeechSynthesisVoiceLike {
  name: string;
  lang: string;
  default?: boolean;
}

export type SpeechSynthesisUtteranceConstructorLike = new (text: string) => {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: SpeechSynthesisVoiceLike;
  onend?: (() => void) | null;
  onerror?: (() => void) | null;
};

type RecognitionResult = ArrayLike<ArrayLike<{ transcript?: string }>>;

export interface SpeechRecognitionLike {
  lang?: string;
  interimResults?: boolean;
  continuous?: boolean;
  onresult?: (event: { results: RecognitionResult }) => void;
  onerror?: () => void;
  onend?: () => void;
  start: () => void;
  stop: () => void;
}

export type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

type VoiceFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'blob' | 'text'>>;
type LocalTtsProxy = {
  synthesize: (request: LocalTtsSynthesisRequest) => Promise<LocalTtsSynthesisResult>;
};

export interface VoiceRuntime {
  speechSynthesis?: Partial<SpeechSynthesisLike> | null;
  SpeechSynthesisUtterance?: SpeechSynthesisUtteranceConstructorLike | null;
  SpeechRecognition?: SpeechRecognitionConstructorLike | null;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike | null;
  fetch?: VoiceFetch | null;
  tts?: LocalTtsProxy | null;
  Audio?: typeof globalThis.Audio | null;
  URL?: Pick<typeof globalThis.URL, 'createObjectURL' | 'revokeObjectURL'> | null;
}

export interface SpeakOptions {
  emotion?: string | null;
  instruct?: string | null;
}

export interface SpeechSynthesisController {
  isSupported: boolean;
  speak: (text: string, options?: SpeakOptions) => void | Promise<void>;
  cancel: () => void;
  isSpeaking: () => boolean;
}

export interface SpeechRecognitionController {
  isSupported: boolean;
  start: (onResult: (transcript: string) => void, onError?: () => void) => void;
  stop: () => void;
}

export function detectVoiceCapabilities(runtime: VoiceRuntime) {
  return {
    tts: Boolean(runtime.speechSynthesis && runtime.SpeechSynthesisUtterance),
    asr: Boolean(runtime.SpeechRecognition || runtime.webkitSpeechRecognition),
  };
}

const DEFAULT_GPT_SOVITS_REFERENCES: Record<string, GptSovitsVoiceReference> = {
  neutral: {
    refAudioPath: 'D:\\Voices\\ref2_neutral_chat.wav',
    promptText: '前辈，我把上次说好要给您的资料也拿来啦。',
  },
  happy: {
    refAudioPath: 'D:\\Voices\\ref1_happy_laugh.wav',
    promptText: '噗......前辈，我知道您的学习能力有多好，您现在一看就是故意在用错的手语逗我笑啦！',
  },
  excited: {
    refAudioPath: 'D:\\Voices\\ref1_happy_laugh.wav',
    promptText: '噗......前辈，我知道您的学习能力有多好，您现在一看就是故意在用错的手语逗我笑啦！',
  },
  playful: {
    refAudioPath: 'D:\\Voices\\ref4_playful.wav',
    promptText: '这么重的脚步声，我早就听到了哦。',
  },
  serious: {
    refAudioPath: 'D:\\Voices\\ref3_serious.wav',
    promptText: '那些晶尘不该停留，我来送它们离开。',
  },
  sad: {
    refAudioPath: 'D:\\Voices\\ref7_sad_soft.wav',
    promptText: '我的父母......已经去世了',
  },
  worried: {
    refAudioPath: 'D:\\Voices\\ref6_sad_wronged.wav',
    promptText: '呜......没、没事的......',
  },
  angry: {
    refAudioPath: 'D:\\Voices\\ref5_serious_stern.wav',
    promptText: '火山的每一次变化活动都转瞬即逝，只有用摄像机记录下来，我们才能不遗漏任何一个细节。',
  },
  shy: {
    refAudioPath: 'D:\\Voices\\ref4_playful.wav',
    promptText: '这么重的脚步声，我早就听到了哦。',
  },
};

const DEFAULT_QWEN3_EMOTION_INSTRUCTS: Record<string, string> = {
  neutral: '用自然、平稳、像日常聊天一样的语气说',
  happy: '用高兴、带一点笑意的语气说',
  sad: '用低落、轻柔、克制的语气说',
  angry: '用克制但明显不满的语气说',
  shy: '用有些害羞、柔和的语气说',
  excited: '用更高兴、更明亮、有活力的语气说',
  worried: '用担心、放轻声音的语气说',
  playful: '用轻快、俏皮、带笑意的语气说',
  serious: '用认真、沉稳的语气说',
};

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  provider: 'system',
  fallbackToSystem: true,
  gptSovits: {
    endpoint: 'http://127.0.0.1:9880/tts',
    textLang: 'zh',
    promptLang: 'zh',
    textSplitMethod: 'cut5',
    batchSize: 1,
    speedFactor: 1,
    streamingMode: false,
    references: DEFAULT_GPT_SOVITS_REFERENCES,
  },
  qwen3Tts: {
    endpoint: 'http://127.0.0.1:9881/tts',
    language: 'Chinese',
    speaker: 'Serena',
    defaultInstruct: DEFAULT_QWEN3_EMOTION_INSTRUCTS.neutral,
    emotionInstructs: DEFAULT_QWEN3_EMOTION_INSTRUCTS,
  },
  qwen3VoiceClone: {
    endpoint: 'http://127.0.0.1:9882/tts',
    language: 'Chinese',
    xVectorOnlyMode: false,
    references: DEFAULT_GPT_SOVITS_REFERENCES,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalPositiveNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeVoiceProvider(value: unknown): VoiceProvider {
  return value === 'gpt-sovits'
    || value === 'qwen3-tts'
    || value === 'qwen3-tts-clone'
    || value === 'system'
    ? value
    : 'system';
}

function normalizeGptSovitsReferences(value: unknown) {
  const references: Record<string, GptSovitsVoiceReference> = { ...DEFAULT_GPT_SOVITS_REFERENCES };

  if (!isRecord(value)) {
    return references;
  }

  Object.entries(value).forEach(([emotion, rawReference]) => {
    if (!isRecord(rawReference)) {
      return;
    }

    const fallback = references[emotion] ?? references.neutral;
    const refAudioPath = optionalString(rawReference.refAudioPath, fallback.refAudioPath);
    const promptText = optionalString(rawReference.promptText, fallback.promptText);

    references[emotion.trim().toLowerCase()] = {
      refAudioPath,
      promptText,
      textLang: typeof rawReference.textLang === 'string' ? rawReference.textLang : fallback.textLang,
      promptLang: typeof rawReference.promptLang === 'string' ? rawReference.promptLang : fallback.promptLang,
    };
  });

  return references;
}

function normalizeQwen3EmotionInstructs(value: unknown) {
  const instructs: Record<string, string> = { ...DEFAULT_QWEN3_EMOTION_INSTRUCTS };

  if (!isRecord(value)) {
    return instructs;
  }

  Object.entries(value).forEach(([emotion, rawInstruct]) => {
    if (typeof rawInstruct !== 'string' || !rawInstruct.trim()) {
      return;
    }

    instructs[emotion.trim().toLowerCase()] = rawInstruct.trim();
  });

  return instructs;
}

export function normalizeVoiceConfig(value: unknown): VoiceConfig {
  if (!isRecord(value)) {
    return DEFAULT_VOICE_CONFIG;
  }

  const gptSovits = isRecord(value.gptSovits) ? value.gptSovits : {};
  const qwen3Tts = isRecord(value.qwen3Tts) ? value.qwen3Tts : {};
  const qwen3VoiceClone = isRecord(value.qwen3VoiceClone) ? value.qwen3VoiceClone : {};

  return {
    provider: normalizeVoiceProvider(value.provider),
    fallbackToSystem: typeof value.fallbackToSystem === 'boolean'
      ? value.fallbackToSystem
      : DEFAULT_VOICE_CONFIG.fallbackToSystem,
    gptSovits: {
      endpoint: optionalString(gptSovits.endpoint, DEFAULT_VOICE_CONFIG.gptSovits.endpoint),
      textLang: optionalString(gptSovits.textLang, DEFAULT_VOICE_CONFIG.gptSovits.textLang),
      promptLang: optionalString(gptSovits.promptLang, DEFAULT_VOICE_CONFIG.gptSovits.promptLang),
      textSplitMethod: optionalString(gptSovits.textSplitMethod, DEFAULT_VOICE_CONFIG.gptSovits.textSplitMethod),
      batchSize: optionalPositiveNumber(gptSovits.batchSize, DEFAULT_VOICE_CONFIG.gptSovits.batchSize),
      speedFactor: optionalPositiveNumber(gptSovits.speedFactor, DEFAULT_VOICE_CONFIG.gptSovits.speedFactor),
      streamingMode: typeof gptSovits.streamingMode === 'boolean'
        ? gptSovits.streamingMode
        : DEFAULT_VOICE_CONFIG.gptSovits.streamingMode,
      references: normalizeGptSovitsReferences(gptSovits.references),
    },
    qwen3Tts: {
      endpoint: optionalString(qwen3Tts.endpoint, DEFAULT_VOICE_CONFIG.qwen3Tts.endpoint),
      language: optionalString(qwen3Tts.language, DEFAULT_VOICE_CONFIG.qwen3Tts.language),
      speaker: optionalString(qwen3Tts.speaker, DEFAULT_VOICE_CONFIG.qwen3Tts.speaker),
      defaultInstruct: optionalString(qwen3Tts.defaultInstruct, DEFAULT_VOICE_CONFIG.qwen3Tts.defaultInstruct),
      emotionInstructs: normalizeQwen3EmotionInstructs(qwen3Tts.emotionInstructs),
    },
    qwen3VoiceClone: {
      endpoint: optionalString(qwen3VoiceClone.endpoint, DEFAULT_VOICE_CONFIG.qwen3VoiceClone.endpoint),
      language: optionalString(qwen3VoiceClone.language, DEFAULT_VOICE_CONFIG.qwen3VoiceClone.language),
      xVectorOnlyMode: typeof qwen3VoiceClone.xVectorOnlyMode === 'boolean'
        ? qwen3VoiceClone.xVectorOnlyMode
        : DEFAULT_VOICE_CONFIG.qwen3VoiceClone.xVectorOnlyMode,
      references: normalizeGptSovitsReferences(qwen3VoiceClone.references),
    },
  };
}

function scoreMandarinVoice(voice: SpeechSynthesisVoiceLike) {
  const lang = voice.lang.toLowerCase();
  const name = voice.name.toLowerCase();
  let score = 0;

  if (lang === 'zh-cn' || lang === 'cmn-cn') {
    score += 100;
  } else if (lang.startsWith('zh') || lang.startsWith('cmn')) {
    score += 70;
  }

  if (name.includes('xiaoxiao') || name.includes('xiaoyi') || name.includes('yunxi')) {
    score += 20;
  }

  if (name.includes('natural') || name.includes('online')) {
    score += 10;
  }

  if (voice.default) {
    score += 1;
  }

  return score;
}

function selectMandarinVoice(synthesis: Partial<SpeechSynthesisLike>) {
  const voices = synthesis.getVoices?.() ?? [];
  let selected: SpeechSynthesisVoiceLike | undefined;
  let selectedScore = 0;

  for (const voice of voices) {
    const score = scoreMandarinVoice(voice);

    if (score > selectedScore) {
      selected = voice;
      selectedScore = score;
    }
  }

  return selectedScore > 0 ? selected : undefined;
}

export function createSpeechSynthesisController(runtime: VoiceRuntime): SpeechSynthesisController {
  const synthesis = runtime.speechSynthesis;
  const Utterance = runtime.SpeechSynthesisUtterance;

  if (!synthesis || !Utterance || typeof synthesis.speak !== 'function' || typeof synthesis.cancel !== 'function') {
    return {
      isSupported: false,
      speak: () => undefined,
      cancel: () => undefined,
      isSpeaking: () => false,
    };
  }

  return {
    isSupported: true,
    speak: (text: string) => {
      const content = text.trim();

      if (!content) {
        return;
      }

      synthesis.cancel?.();
      const utterance = new Utterance(content);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.92;
      utterance.pitch = 1.04;
      utterance.volume = 1;
      utterance.voice = selectMandarinVoice(synthesis);
      synthesis.speak?.(utterance);
    },
    cancel: () => {
      synthesis.cancel?.();
    },
    isSpeaking: () => Boolean(synthesis.speaking),
  };
}

function selectedReferenceFrom(references: Record<string, GptSovitsVoiceReference>, emotion?: string | null) {
  const normalizedEmotion = emotion?.trim().toLowerCase() || 'neutral';

  return references[normalizedEmotion]
    ?? references.neutral
    ?? DEFAULT_GPT_SOVITS_REFERENCES.neutral;
}

function selectedReference(config: VoiceConfig, emotion?: string | null) {
  return selectedReferenceFrom(config.gptSovits.references, emotion);
}

function selectedQwen3VoiceCloneReference(config: VoiceConfig, emotion?: string | null) {
  return selectedReferenceFrom(config.qwen3VoiceClone.references, emotion);
}

function normalizedEmotion(emotion?: string | null) {
  return emotion?.trim().toLowerCase() || 'neutral';
}

function selectedQwen3Instruct(config: VoiceConfig, emotion?: string | null, instruct?: string | null) {
  const explicit = instruct?.trim();

  if (explicit) {
    return explicit;
  }

  return config.qwen3Tts.emotionInstructs[normalizedEmotion(emotion)]
    ?? config.qwen3Tts.defaultInstruct
    ?? DEFAULT_QWEN3_EMOTION_INSTRUCTS.neutral;
}

function createGptSovitsController(
  runtime: VoiceRuntime,
  config: VoiceConfig,
  fallback?: SpeechSynthesisController,
): SpeechSynthesisController {
  const request = runtime.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as VoiceFetch : null);
  const proxy = runtime.tts ?? (typeof window !== 'undefined' ? window.electron?.tts : null);
  const AudioConstructor = runtime.Audio ?? (typeof Audio === 'function' ? Audio : null);
  const urlApi = runtime.URL ?? (typeof URL !== 'undefined' ? URL : null);
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const cleanup = () => {
    currentAudio?.pause();

    if (currentUrl) {
      urlApi?.revokeObjectURL(currentUrl);
    }

    currentAudio = null;
    currentUrl = null;
  };

  const isSupported = Boolean(
    (proxy || request)
    && AudioConstructor
    && urlApi?.createObjectURL
    && config.gptSovits.endpoint.trim()
  );

  if (!isSupported) {
    return fallback ?? {
      isSupported: false,
      speak: () => undefined,
      cancel: () => undefined,
      isSpeaking: () => false,
    };
  }

  return {
    isSupported: true,
    speak: async (text, options = {}) => {
      const content = text.trim();

      if (!content || (!proxy && !request) || !AudioConstructor || !urlApi?.createObjectURL) {
        return;
      }

      cleanup();
      const reference = selectedReference(config, options.emotion);
      const body = {
        text: content,
        text_lang: reference.textLang ?? config.gptSovits.textLang,
        ref_audio_path: reference.refAudioPath,
        prompt_lang: reference.promptLang ?? config.gptSovits.promptLang,
        prompt_text: reference.promptText,
        media_type: 'wav',
        text_split_method: config.gptSovits.textSplitMethod,
        batch_size: config.gptSovits.batchSize,
        speed_factor: config.gptSovits.speedFactor,
        streaming_mode: config.gptSovits.streamingMode ? 1 : 0,
      };
      let blob: Blob;

      if (proxy) {
        const response = await proxy.synthesize({
          endpoint: config.gptSovits.endpoint,
          body,
        });

        if (!response.ok) {
          console.warn(`GPT-SoVITS TTS failed: ${response.status} ${response.statusText} ${response.body ?? ''}`.trim());
          await fallback?.speak(content, options);
          return;
        }

        blob = new Blob([new Uint8Array(response.bytes ?? [])], {
          type: response.contentType ?? 'audio/wav',
        });
      } else if (request) {
        const response = await request(config.gptSovits.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          console.warn(`GPT-SoVITS TTS failed: ${response.status} ${response.statusText} ${errorBody}`.trim());
          await fallback?.speak(content, options);
          return;
        }

        blob = await response.blob();
      } else {
        return;
      }
      const audioUrl = urlApi.createObjectURL(blob);
      const audio = new AudioConstructor(audioUrl);

      currentUrl = audioUrl;
      currentAudio = audio;
      await audio.play();
    },
    cancel: () => {
      cleanup();
      fallback?.cancel();
    },
    isSpeaking: () => Boolean(
      (currentAudio && !currentAudio.paused && !currentAudio.ended)
      || fallback?.isSpeaking()
    ),
  };
}

function createQwen3TtsController(
  runtime: VoiceRuntime,
  config: VoiceConfig,
  fallback?: SpeechSynthesisController,
): SpeechSynthesisController {
  const request = runtime.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as VoiceFetch : null);
  const proxy = runtime.tts ?? (typeof window !== 'undefined' ? window.electron?.tts : null);
  const AudioConstructor = runtime.Audio ?? (typeof Audio === 'function' ? Audio : null);
  const urlApi = runtime.URL ?? (typeof URL !== 'undefined' ? URL : null);
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const cleanup = () => {
    currentAudio?.pause();

    if (currentUrl) {
      urlApi?.revokeObjectURL(currentUrl);
    }

    currentAudio = null;
    currentUrl = null;
  };

  const isSupported = Boolean(
    (proxy || request)
    && AudioConstructor
    && urlApi?.createObjectURL
    && config.qwen3Tts.endpoint.trim()
  );

  if (!isSupported) {
    return fallback ?? {
      isSupported: false,
      speak: () => undefined,
      cancel: () => undefined,
      isSpeaking: () => false,
    };
  }

  return {
    isSupported: true,
    speak: async (text, options = {}) => {
      const content = text.trim();

      if (!content || (!proxy && !request) || !AudioConstructor || !urlApi?.createObjectURL) {
        return;
      }

      cleanup();
      const body = {
        text: content,
        emotion: normalizedEmotion(options.emotion),
        instruct: selectedQwen3Instruct(config, options.emotion, options.instruct),
        language: config.qwen3Tts.language,
        speaker: config.qwen3Tts.speaker,
      };
      let blob: Blob;

      if (proxy) {
        const response = await proxy.synthesize({
          endpoint: config.qwen3Tts.endpoint,
          body,
        });

        if (!response.ok) {
          console.warn(`Qwen3-TTS failed: ${response.status} ${response.statusText} ${response.body ?? ''}`.trim());
          await fallback?.speak(content, options);
          return;
        }

        blob = new Blob([new Uint8Array(response.bytes ?? [])], {
          type: response.contentType ?? 'audio/wav',
        });
      } else if (request) {
        const response = await request(config.qwen3Tts.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          console.warn(`Qwen3-TTS failed: ${response.status} ${response.statusText} ${errorBody}`.trim());
          await fallback?.speak(content, options);
          return;
        }

        blob = await response.blob();
      } else {
        return;
      }

      const audioUrl = urlApi.createObjectURL(blob);
      const audio = new AudioConstructor(audioUrl);

      currentUrl = audioUrl;
      currentAudio = audio;
      await audio.play();
    },
    cancel: () => {
      cleanup();
      fallback?.cancel();
    },
    isSpeaking: () => Boolean(
      (currentAudio && !currentAudio.paused && !currentAudio.ended)
      || fallback?.isSpeaking()
    ),
  };
}

function createQwen3VoiceCloneController(
  runtime: VoiceRuntime,
  config: VoiceConfig,
  fallback?: SpeechSynthesisController,
): SpeechSynthesisController {
  const request = runtime.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as VoiceFetch : null);
  const proxy = runtime.tts ?? (typeof window !== 'undefined' ? window.electron?.tts : null);
  const AudioConstructor = runtime.Audio ?? (typeof Audio === 'function' ? Audio : null);
  const urlApi = runtime.URL ?? (typeof URL !== 'undefined' ? URL : null);
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const cleanup = () => {
    currentAudio?.pause();

    if (currentUrl) {
      urlApi?.revokeObjectURL(currentUrl);
    }

    currentAudio = null;
    currentUrl = null;
  };

  const isSupported = Boolean(
    (proxy || request)
    && AudioConstructor
    && urlApi?.createObjectURL
    && config.qwen3VoiceClone.endpoint.trim()
  );

  if (!isSupported) {
    return fallback ?? {
      isSupported: false,
      speak: () => undefined,
      cancel: () => undefined,
      isSpeaking: () => false,
    };
  }

  return {
    isSupported: true,
    speak: async (text, options = {}) => {
      const content = text.trim();

      if (!content || (!proxy && !request) || !AudioConstructor || !urlApi?.createObjectURL) {
        return;
      }

      cleanup();
      const reference = selectedQwen3VoiceCloneReference(config, options.emotion);
      const body = {
        mode: 'voice_clone',
        text: content,
        emotion: normalizedEmotion(options.emotion),
        language: config.qwen3VoiceClone.language,
        ref_audio: reference.refAudioPath,
        ref_text: reference.promptText,
        x_vector_only_mode: config.qwen3VoiceClone.xVectorOnlyMode,
      };
      let blob: Blob;

      if (proxy) {
        const response = await proxy.synthesize({
          endpoint: config.qwen3VoiceClone.endpoint,
          body,
        });

        if (!response.ok) {
          console.warn(`Qwen3-TTS clone failed: ${response.status} ${response.statusText} ${response.body ?? ''}`.trim());
          await fallback?.speak(content, options);
          return;
        }

        blob = new Blob([new Uint8Array(response.bytes ?? [])], {
          type: response.contentType ?? 'audio/wav',
        });
      } else if (request) {
        const response = await request(config.qwen3VoiceClone.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          console.warn(`Qwen3-TTS clone failed: ${response.status} ${response.statusText} ${errorBody}`.trim());
          await fallback?.speak(content, options);
          return;
        }

        blob = await response.blob();
      } else {
        return;
      }

      const audioUrl = urlApi.createObjectURL(blob);
      const audio = new AudioConstructor(audioUrl);

      currentUrl = audioUrl;
      currentAudio = audio;
      await audio.play();
    },
    cancel: () => {
      cleanup();
      fallback?.cancel();
    },
    isSpeaking: () => Boolean(
      (currentAudio && !currentAudio.paused && !currentAudio.ended)
      || fallback?.isSpeaking()
    ),
  };
}

export function createTextToSpeechController(
  runtime: VoiceRuntime,
  config: VoiceConfig = DEFAULT_VOICE_CONFIG,
): SpeechSynthesisController {
  const normalizedConfig = normalizeVoiceConfig(config);
  const systemController = createSpeechSynthesisController(runtime);
  const fallback = normalizedConfig.fallbackToSystem && systemController.isSupported ? systemController : undefined;

  if (normalizedConfig.provider === 'gpt-sovits') {
    return createGptSovitsController(runtime, normalizedConfig, fallback);
  }

  if (normalizedConfig.provider === 'qwen3-tts') {
    return createQwen3TtsController(runtime, normalizedConfig, fallback);
  }

  if (normalizedConfig.provider === 'qwen3-tts-clone') {
    return createQwen3VoiceCloneController(runtime, normalizedConfig, fallback);
  }

  return systemController;
}

export function createSpeechRecognitionController(runtime: VoiceRuntime): SpeechRecognitionController {
  const Recognition = runtime.SpeechRecognition ?? runtime.webkitSpeechRecognition;

  if (!Recognition) {
    return {
      isSupported: false,
      start: () => undefined,
      stop: () => undefined,
    };
  }

  let recognition: SpeechRecognitionLike | null = null;

  return {
    isSupported: true,
    start: (onResult, onError) => {
      recognition?.stop();
      recognition = new Recognition();
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onerror = () => {
        onError?.();
      };
      recognition.onresult = (event) => {
        const firstResult = event.results[0]?.[0]?.transcript?.trim();

        if (firstResult) {
          onResult(firstResult);
        }
      };
      recognition.start();
    },
    stop: () => {
      recognition?.stop();
      recognition = null;
    },
  };
}
