import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOICE_CONFIG,
  createSpeechRecognitionController,
  createSpeechSynthesisController,
  createTextToSpeechController,
  detectVoiceCapabilities,
  type SpeechRecognitionConstructorLike,
  type SpeechSynthesisUtteranceConstructorLike,
} from './voice';

describe('phase3 voice service', () => {
  it('detects system TTS and ASR support', () => {
    expect(detectVoiceCapabilities({
      speechSynthesis: {},
      SpeechSynthesisUtterance: vi.fn(),
      SpeechRecognition: vi.fn(),
    })).toEqual({ tts: true, asr: true });

    expect(detectVoiceCapabilities({})).toEqual({ tts: false, asr: false });
  });

  it('speaks and cancels text through speechSynthesis', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    const Utterance = vi.fn(function Utterance(this: { text: string }, text: string) {
      this.text = text;
    });
    const controller = createSpeechSynthesisController({
      speechSynthesis: { speak, cancel, speaking: false },
      SpeechSynthesisUtterance: Utterance as unknown as SpeechSynthesisUtteranceConstructorLike,
    });

    expect(controller.isSupported).toBe(true);
    controller.speak('你好');

    expect(Utterance).toHaveBeenCalledWith('你好');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);

    controller.cancel();

    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('prefers a Mandarin voice and applies gentler speech settings', () => {
    const utterances: Array<{
      text: string;
      lang?: string;
      rate?: number;
      pitch?: number;
      volume?: number;
      voice?: { name: string; lang: string };
    }> = [];
    const voices = [
      { name: 'English Default', lang: 'en-US' },
      { name: 'Microsoft Xiaoxiao Online', lang: 'zh-CN' },
    ];
    const speak = vi.fn((utterance) => utterances.push(utterance as (typeof utterances)[number]));
    const cancel = vi.fn();
    const Utterance = vi.fn(function Utterance(
      this: {
        text: string;
        lang?: string;
        rate?: number;
        pitch?: number;
        volume?: number;
        voice?: { name: string; lang: string };
      },
      text: string,
    ) {
      this.text = text;
    });
    const controller = createSpeechSynthesisController({
      speechSynthesis: { speak, cancel, speaking: false, getVoices: () => voices },
      SpeechSynthesisUtterance: Utterance as unknown as SpeechSynthesisUtteranceConstructorLike,
    });

    controller.speak('今晚月亮很圆');

    expect(utterances[0]).toMatchObject({
      text: '今晚月亮很圆',
      lang: 'zh-CN',
      rate: 0.92,
      pitch: 1.04,
      volume: 1,
      voice: voices[1],
    });
  });

  it('returns unsupported no-op controllers when browser speech APIs are absent', () => {
    const speech = createSpeechSynthesisController({});
    const recognition = createSpeechRecognitionController({});

    expect(speech.isSupported).toBe(false);
    expect(speech.isSpeaking()).toBe(false);
    expect(() => speech.speak('hello')).not.toThrow();
    expect(() => speech.cancel()).not.toThrow();

    expect(recognition.isSupported).toBe(false);
    expect(() => recognition.start(vi.fn(), vi.fn())).not.toThrow();
    expect(() => recognition.stop()).not.toThrow();
  });

  it('returns ASR transcripts from recognition results', () => {
    const instances: Array<Record<string, unknown>> = [];
    const Recognition = vi.fn(function Recognition(this: Record<string, unknown>) {
      this.lang = '';
      this.interimResults = true;
      this.continuous = false;
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    });
    const onResult = vi.fn();
    const onError = vi.fn();
    const controller = createSpeechRecognitionController({
      SpeechRecognition: Recognition as unknown as SpeechRecognitionConstructorLike,
    });

    expect(controller.isSupported).toBe(true);
    controller.start(onResult, onError);
    (instances[0].onresult as (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)({
      results: [[{ transcript: '晚上好' }]],
    });

    expect(onResult).toHaveBeenCalledWith('晚上好');
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes GPT-SoVITS speech through the selected emotion reference', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' })),
    });
    const createObjectURL = vi.fn().mockReturnValue('blob:gpt-sovits');
    const revokeObjectURL = vi.fn();
    const Audio = vi.fn(function Audio(
      this: { play: typeof play; pause: typeof pause; paused: boolean; ended: boolean },
      src: string,
    ) {
      expect(src).toBe('blob:gpt-sovits');
      this.play = play;
      this.pause = pause;
      this.paused = false;
      this.ended = false;
    });
    const controller = createTextToSpeechController(
      {
        fetch,
        Audio: Audio as unknown as typeof globalThis.Audio,
        URL: { createObjectURL, revokeObjectURL } as unknown as typeof globalThis.URL,
      },
      {
        ...DEFAULT_VOICE_CONFIG,
        provider: 'gpt-sovits',
        gptSovits: {
          ...DEFAULT_VOICE_CONFIG.gptSovits,
          endpoint: 'http://127.0.0.1:9880/tts',
        },
      },
    );

    expect(controller.isSupported).toBe(true);

    await controller.speak('晚上好。', { emotion: 'playful' });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9880/tts', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));

    const body = JSON.parse((fetch.mock.calls[0][1] as { body: string }).body);

    expect(body).toMatchObject({
      text: '晚上好。',
      text_lang: 'zh',
      ref_audio_path: 'D:\\Voices\\ref4_playful.wav',
      prompt_lang: 'zh',
      prompt_text: '这么重的脚步声，我早就听到了哦。',
      media_type: 'wav',
      text_split_method: 'cut5',
      batch_size: 1,
      speed_factor: 1,
      streaming_mode: 0,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(Audio).toHaveBeenCalledWith('blob:gpt-sovits');
    expect(play).toHaveBeenCalledTimes(1);

    controller.cancel();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:gpt-sovits');
  });

  it('uses the Electron TTS proxy before direct fetch for GPT-SoVITS', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn();
    const synthesize = vi.fn().mockResolvedValue({
      ok: true,
      contentType: 'audio/wav',
      bytes: [1, 2, 3],
    });
    const Audio = vi.fn(function Audio(this: { play: typeof play; pause: () => void; paused: boolean; ended: boolean }) {
      this.play = play;
      this.pause = vi.fn();
      this.paused = false;
      this.ended = false;
    });
    const controller = createTextToSpeechController(
      {
        fetch,
        tts: { synthesize },
        Audio: Audio as unknown as typeof globalThis.Audio,
        URL: {
          createObjectURL: vi.fn().mockReturnValue('blob:electron-proxy'),
          revokeObjectURL: vi.fn(),
        } as unknown as typeof globalThis.URL,
      },
      {
        ...DEFAULT_VOICE_CONFIG,
        provider: 'gpt-sovits',
      },
    );

    await controller.speak('你好。', { emotion: 'neutral' });

    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'http://127.0.0.1:9880/tts',
      body: expect.objectContaining({
        text: '你好。',
        ref_audio_path: 'D:\\Voices\\ref2_neutral_chat.wav',
      }),
    }));
    expect(fetch).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('routes Qwen3-TTS speech through the selected service with voice instruct metadata', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn();
    const synthesize = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      contentType: 'audio/wav',
      bytes: [1, 2, 3],
    });
    const Audio = vi.fn(function Audio(this: { play: typeof play; pause: () => void; paused: boolean; ended: boolean }) {
      this.play = play;
      this.pause = vi.fn();
      this.paused = false;
      this.ended = false;
    });
    const controller = createTextToSpeechController(
      {
        fetch,
        tts: { synthesize },
        Audio: Audio as unknown as typeof globalThis.Audio,
        URL: {
          createObjectURL: vi.fn().mockReturnValue('blob:qwen3-tts'),
          revokeObjectURL: vi.fn(),
        } as unknown as typeof globalThis.URL,
      },
      {
        ...DEFAULT_VOICE_CONFIG,
        provider: 'qwen3-tts',
        qwen3Tts: {
          ...DEFAULT_VOICE_CONFIG.qwen3Tts,
          endpoint: 'http://127.0.0.1:9881/tts',
          language: 'Chinese',
          speaker: 'Serena',
        },
      },
    );

    expect(controller.isSupported).toBe(true);

    await controller.speak('晚上好。', {
      emotion: 'happy',
      instruct: '用开心、带一点笑意的语气说',
    });

    expect(synthesize).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:9881/tts',
      body: {
        text: '晚上好。',
        emotion: 'happy',
        instruct: '用开心、带一点笑意的语气说',
        language: 'Chinese',
        speaker: 'Serena',
      },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(Audio).toHaveBeenCalledWith('blob:qwen3-tts');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('routes Qwen3-TTS clone through the selected emotion reference without instruct metadata', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const synthesize = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      contentType: 'audio/wav',
      bytes: [1, 2, 3],
    });
    const Audio = vi.fn(function Audio(this: { play: typeof play; pause: () => void; paused: boolean; ended: boolean }) {
      this.play = play;
      this.pause = vi.fn();
      this.paused = false;
      this.ended = false;
    });
    const controller = createTextToSpeechController(
      {
        tts: { synthesize },
        Audio: Audio as unknown as typeof globalThis.Audio,
        URL: {
          createObjectURL: vi.fn().mockReturnValue('blob:qwen3-clone'),
          revokeObjectURL: vi.fn(),
        } as unknown as typeof globalThis.URL,
      },
      {
        ...DEFAULT_VOICE_CONFIG,
        provider: 'qwen3-tts-clone',
      },
    );

    await controller.speak('晚上好。', { emotion: 'happy' });

    expect(synthesize).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:9882/tts',
      body: {
        mode: 'voice_clone',
        text: '晚上好。',
        emotion: 'happy',
        language: 'Chinese',
        ref_audio: 'D:\\Voices\\ref1_happy_laugh.wav',
        ref_text: '噗......前辈，我知道您的学习能力有多好，您现在一看就是故意在用错的手语逗我笑啦！',
        x_vector_only_mode: false,
      },
    });
    expect(Audio).toHaveBeenCalledWith('blob:qwen3-clone');
    expect(play).toHaveBeenCalledTimes(1);
  });
});
