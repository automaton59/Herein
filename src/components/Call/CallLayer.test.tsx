import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from '../../stores/call';
import type { CharacterConfig, Conversation } from '../../services/interfaces';
import type { AssetRecord, CharacterPresentationProfile } from '../../services/phase2/types';
import { DEFAULT_VOICE_CONFIG } from '../../services/phase3/voice';
import { CallLayer } from './CallLayer';

const characters: CharacterConfig[] = [
  {
    id: 'char-1',
    name: 'AL-1S',
    description: '',
    scenario: '',
    firstMessage: '',
    systemPrompt: '',
    avatarAssetId: 'avatar-1',
  },
];

const conversations: Conversation[] = [
  {
    id: 'timeline-1',
    characterId: 'char-1',
    title: 'AL-1S',
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        content: '我在这里。',
        timestamp: new Date('2026-06-20T10:00:00.000Z'),
        emotion: 'happy',
        status: 'sent',
      },
    ],
    createdAt: new Date('2026-06-20T09:00:00.000Z'),
    updatedAt: new Date('2026-06-20T10:00:00.000Z'),
  },
];

const expressionAssets: AssetRecord[] = [
  {
    id: 'expr-happy',
    characterId: 'char-1',
    kind: 'expression',
    relativePath: 'assets/char-1/expression-happy.png',
    mimeType: 'image/png',
    label: '开心',
    metadata: { emotion: 'happy', priority: 10 },
  },
];

const videoAsset: AssetRecord = {
  id: 'video-idle',
  characterId: 'char-1',
  kind: 'video',
  relativePath: 'assets/char-1/video-idle.mp4',
  mimeType: 'video/mp4',
  label: '待机循环',
  metadata: { renderer: 'video' },
};

const live2dAsset: AssetRecord = {
  id: 'live2d-main',
  characterId: 'char-1',
  kind: 'live2d',
  relativePath: 'assets/char-1/live2d-main/model.model3.json',
  mimeType: 'application/json',
  label: 'Live2D 主模型',
  metadata: { renderer: 'live2d', entry: 'model.model3.json' },
};

function renderLayer(onRestoreCharacter = vi.fn(), onSend = vi.fn()) {
  return {
    onRestoreCharacter,
    onSend,
    ...render(
      <CallLayer
        characters={characters}
        conversations={conversations}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={{ 'expr-happy': 'data:image/png;base64,happy' }}
        dynamicAssets={[]}
        dynamicAssetDataUrls={{}}
        presentationProfiles={{}}
        isLoading={false}
        onSend={onSend}
        onRestoreCharacter={onRestoreCharacter}
      />,
    ),
  };
}

function installSpeechSynthesisMock() {
  const speak = vi.fn();
  const cancel = vi.fn();
  const Utterance = vi.fn(function Utterance(this: { text: string }, text: string) {
    this.text = text;
  });

  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak, cancel, speaking: false },
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: Utterance,
  });

  return { speak, cancel, Utterance };
}

function installSpeechRecognitionMock() {
  const instances: Array<Record<string, unknown>> = [];
  const Recognition = vi.fn(function Recognition(this: Record<string, unknown>) {
    this.start = vi.fn();
    this.stop = vi.fn();
    instances.push(this);
  });

  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: Recognition,
  });

  return { Recognition, instances };
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    configurable: true,
    value: undefined,
  });
  useCallStore.getState().endCall();
});

describe('CallLayer', () => {
  it('renders nothing without an active call session', () => {
    renderLayer();

    expect(screen.queryByRole('dialog', { name: /视频通话/ })).not.toBeInTheDocument();
  });

  it('renders the windowed call with subtitle and selected expression image', () => {
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });
    renderLayer();

    expect(screen.getByRole('dialog', { name: 'AL-1S 视频通话' })).toBeInTheDocument();
    expect(screen.getByText('我在这里。')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AL-1S 当前形象' })).toHaveAttribute('src', 'data:image/png;base64,happy');
  });

  it('updates the call elapsed timer every second while the window is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T10:00:00.000Z'));
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });
    renderLayer();

    expect(screen.getByText('通话中 · 00:00')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('通话中 · 00:01')).toBeInTheDocument();
  });

  it('shows the latest user message alongside the assistant subtitle', () => {
    const conversationWithRecentUser: Conversation = {
      ...conversations[0],
      messages: [
        ...conversations[0].messages,
        {
          id: 'msg-user-latest',
          role: 'user',
          content: '我刚把家里收拾好了',
          timestamp: new Date('2026-06-20T10:01:00.000Z'),
          status: 'sent',
        },
      ],
    };
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });

    render(
      <CallLayer
        characters={characters}
        conversations={[conversationWithRecentUser]}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={{ 'expr-happy': 'data:image/png;base64,happy' }}
        dynamicAssets={[]}
        dynamicAssetDataUrls={{}}
        presentationProfiles={{}}
        isLoading={false}
        onSend={vi.fn()}
        onRestoreCharacter={vi.fn()}
      />,
    );

    expect(screen.getByText('我：我刚把家里收拾好了')).toBeInTheDocument();
    expect(screen.getByText('我在这里。')).toBeInTheDocument();
  });

  it('shows an emoji expression placeholder for the assistant emotion', () => {
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });
    renderLayer();

    expect(screen.getByLabelText('当前表情：happy')).toHaveTextContent('😊');
  });

  it('uses presentation profile mappings before automatic expression priority', () => {
    const profile: CharacterPresentationProfile = {
      characterId: 'char-1',
      defaultAssetId: null,
      emotionAssetMap: { happy: 'expr-manual' },
      fallbackEmotion: 'neutral',
    };
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });

    render(
      <CallLayer
        characters={characters}
        conversations={conversations}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={[
          {
            id: 'expr-auto',
            characterId: 'char-1',
            kind: 'expression',
            relativePath: 'assets/char-1/expression-auto.png',
            mimeType: 'image/png',
            label: '自动开心',
            metadata: { emotion: 'happy', priority: 100 },
          },
          {
            id: 'expr-manual',
            characterId: 'char-1',
            kind: 'expression',
            relativePath: 'assets/char-1/expression-manual.png',
            mimeType: 'image/png',
            label: '手动开心',
            metadata: { emotion: 'happy', priority: 1 },
          },
        ]}
        expressionAssetDataUrls={{
          'expr-auto': 'data:image/png;base64,auto',
          'expr-manual': 'data:image/png;base64,manual',
        }}
        dynamicAssets={[]}
        dynamicAssetDataUrls={{}}
        presentationProfiles={{ 'char-1': profile }}
        isLoading={false}
        onSend={vi.fn()}
        onRestoreCharacter={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'AL-1S 当前形象' })).toHaveAttribute('src', 'data:image/png;base64,manual');
  });

  it('renders a selected video loop as the dynamic call avatar', () => {
    const profile: CharacterPresentationProfile = {
      characterId: 'char-1',
      defaultAssetId: null,
      dynamicAssetId: 'video-idle',
      emotionAssetMap: {},
      fallbackEmotion: 'neutral',
      preferredRenderer: 'video',
    };
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });

    render(
      <CallLayer
        characters={characters}
        conversations={conversations}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={{ 'expr-happy': 'data:image/png;base64,happy' }}
        dynamicAssets={[videoAsset]}
        dynamicAssetDataUrls={{ 'video-idle': 'data:video/mp4;base64,loop' }}
        presentationProfiles={{ 'char-1': profile }}
        isLoading={false}
        onSend={vi.fn()}
        onRestoreCharacter={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('AL-1S 动态形象')).toHaveAttribute('src', 'data:video/mp4;base64,loop');
  });

  it('shows the Live2D adapter placeholder while keeping the static fallback image', () => {
    const profile: CharacterPresentationProfile = {
      characterId: 'char-1',
      defaultAssetId: null,
      dynamicAssetId: 'live2d-main',
      emotionAssetMap: {},
      fallbackEmotion: 'neutral',
      preferredRenderer: 'live2d',
    };
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });

    render(
      <CallLayer
        characters={characters}
        conversations={conversations}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={{ 'expr-happy': 'data:image/png;base64,happy' }}
        dynamicAssets={[live2dAsset]}
        dynamicAssetDataUrls={{}}
        presentationProfiles={{ 'char-1': profile }}
        isLoading={false}
        onSend={vi.fn()}
        onRestoreCharacter={vi.fn()}
      />,
    );

    expect(screen.getByText('Live2D 动态形象')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AL-1S 当前形象' })).toHaveAttribute('src', 'data:image/png;base64,happy');
  });

  it('plays the current subtitle through system speech synthesis', () => {
    const { speak, Utterance } = installSpeechSynthesisMock();
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });
    renderLayer();

    fireEvent.click(screen.getByRole('button', { name: '播放当前字幕' }));

    expect(Utterance).toHaveBeenCalledWith('我在这里。');
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('plays the current subtitle through GPT-SoVITS with the assistant emotion', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' })),
    });
    const Audio = vi.fn(function Audio(this: { play: typeof play; pause: () => void; paused: boolean; ended: boolean }) {
      this.play = play;
      this.pause = vi.fn();
      this.paused = false;
      this.ended = false;
    });
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });

    render(
      <CallLayer
        characters={characters}
        conversations={conversations}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={{ 'expr-happy': 'data:image/png;base64,happy' }}
        dynamicAssets={[]}
        dynamicAssetDataUrls={{}}
        presentationProfiles={{}}
        voiceRuntime={{
          fetch,
          Audio: Audio as unknown as typeof window.Audio,
          URL: {
            createObjectURL: vi.fn().mockReturnValue('blob:gpt-sovits'),
            revokeObjectURL: vi.fn(),
          } as unknown as typeof window.URL,
        }}
        voiceConfig={{
          ...DEFAULT_VOICE_CONFIG,
          provider: 'gpt-sovits',
        }}
        isLoading={false}
        onSend={vi.fn()}
        onRestoreCharacter={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '播放当前字幕' }));

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));

    const body = JSON.parse((fetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({
      ref_audio_path: 'D:\\Voices\\ref1_happy_laugh.wav',
      prompt_text: '噗......前辈，我知道您的学习能力有多好，您现在一看就是故意在用错的手语逗我笑啦！',
    });
  });

  it('passes assistant voice instruct metadata to Qwen3-TTS playback', async () => {
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
    const conversationWithInstruct: Conversation = {
      ...conversations[0],
      messages: [
        {
          ...conversations[0].messages[0],
          voiceInstruct: '用更高兴、带笑意的语气说',
        },
      ],
    };
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });

    render(
      <CallLayer
        characters={characters}
        conversations={[conversationWithInstruct]}
        avatarDataUrls={{ 'avatar-1': 'data:image/png;base64,avatar' }}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={{ 'expr-happy': 'data:image/png;base64,happy' }}
        dynamicAssets={[]}
        dynamicAssetDataUrls={{}}
        presentationProfiles={{}}
        voiceRuntime={{
          tts: { synthesize },
          Audio: Audio as unknown as typeof window.Audio,
          URL: {
            createObjectURL: vi.fn().mockReturnValue('blob:qwen3-tts'),
            revokeObjectURL: vi.fn(),
          } as unknown as typeof window.URL,
        }}
        voiceConfig={{
          ...DEFAULT_VOICE_CONFIG,
          provider: 'qwen3-tts',
        }}
        isLoading={false}
        onSend={vi.fn()}
        onRestoreCharacter={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '播放当前字幕' }));

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'http://127.0.0.1:9881/tts',
      body: expect.objectContaining({
        text: '我在这里。',
        emotion: 'happy',
        instruct: '用更高兴、带笑意的语气说',
      }),
    }));
  });

  it('fills the call draft from speech recognition and sends through the existing call input', () => {
    const { instances } = installSpeechRecognitionMock();
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });
    const { onSend } = renderLayer();

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));

    expect(instances).toHaveLength(1);
    expect(instances[0].start).toHaveBeenCalledTimes(1);

    act(() => {
      (instances[0].onresult as (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)({
        results: [[{ transcript: '我在听' }]],
      });
    });

    expect(screen.getByPlaceholderText('输入文字...')).toHaveValue('我在听');

    fireEvent.click(screen.getByRole('button', { name: '发送通话消息' }));

    expect(onSend).toHaveBeenCalledWith('我在听');
  });

  it('minimizes and restores a call through the mini window', () => {
    const onRestoreCharacter = vi.fn();
    useCallStore.getState().startCall({ characterId: 'char-1', timelineId: 'timeline-1' });
    renderLayer(onRestoreCharacter);

    fireEvent.click(screen.getByRole('button', { name: '最小化通话' }));

    expect(screen.getByRole('button', { name: '恢复 AL-1S 通话' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复 AL-1S 通话' }));

    expect(onRestoreCharacter).toHaveBeenCalledWith('char-1');
    expect(useCallStore.getState().session?.mode).toBe('windowed');
  });
});
