# Phase 3D Local Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-first Phase 3D voice layer to the call window: system TTS for assistant subtitles and optional ASR-to-draft when the runtime supports it.

**Architecture:** Keep browser voice API differences in `src/services/phase3/voice.ts`. `CallWindow` owns only runtime UI state and uses injected or default voice adapters, while `CallLayer` keeps the existing subtitle/send pipeline unchanged.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library, Web Speech API (`speechSynthesis`, optional `SpeechRecognition`).

---

## File Structure

- Create: `src/services/phase3/voice.ts`
- Create: `src/services/phase3/voice.test.ts`
- Modify: `src/components/Call/CallWindow.tsx`
- Modify: `src/components/Call/CallLayer.test.tsx`
- Modify: `docs/TESTING.md`
- Modify: `docs/HANDOVER.md`
- Modify: `docs/PHASE3-HANDOVER.md`

## Task 1: Voice Service

- [x] Write failing tests in `src/services/phase3/voice.test.ts` for capability detection, TTS speak/cancel, and ASR transcript handling.

Test shape:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechRecognitionController,
  createSpeechSynthesisController,
  detectVoiceCapabilities,
} from './voice';

describe('phase3 voice service', () => {
  it('detects system TTS and ASR support', () => {
    expect(detectVoiceCapabilities({
      speechSynthesis: {},
      SpeechSynthesisUtterance: vi.fn(),
      SpeechRecognition: vi.fn(),
    })).toEqual({ tts: true, asr: true });
  });

  it('speaks and cancels text through speechSynthesis', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    const Utterance = vi.fn(function Utterance(this: { text: string }, text: string) {
      this.text = text;
    });

    const controller = createSpeechSynthesisController({
      speechSynthesis: { speak, cancel, speaking: false },
      SpeechSynthesisUtterance: Utterance,
    });

    expect(controller.isSupported).toBe(true);
    controller.speak('你好');
    expect(Utterance).toHaveBeenCalledWith('你好');
    expect(speak).toHaveBeenCalledTimes(1);
    controller.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('returns ASR transcripts from final recognition results', () => {
    const instances: Array<Record<string, unknown>> = [];
    const Recognition = vi.fn(function Recognition(this: Record<string, unknown>) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    });
    const onResult = vi.fn();

    const controller = createSpeechRecognitionController({ SpeechRecognition: Recognition });
    controller.start(onResult);
    instances[0].onresult({
      results: [[{ transcript: '晚上好' }]],
    });

    expect(onResult).toHaveBeenCalledWith('晚上好');
  });
});
```

- [x] Run the voice service test and verify it fails because `voice.ts` does not exist:

```bash
npm run test:run -- src/services/phase3/voice.test.ts
```

- [x] Implement `src/services/phase3/voice.ts`.

Implementation outline:

```ts
export interface VoiceRuntime {
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: SpeechSynthesisUtteranceConstructorLike;
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

export function detectVoiceCapabilities(runtime: VoiceRuntime) {
  return {
    tts: Boolean(runtime.speechSynthesis && runtime.SpeechSynthesisUtterance),
    asr: Boolean(runtime.SpeechRecognition || runtime.webkitSpeechRecognition),
  };
}
```

Then add `createSpeechSynthesisController()` and `createSpeechRecognitionController()` with no-op unsupported controllers.

- [x] Run the voice service test and verify it passes:

```bash
npm run test:run -- src/services/phase3/voice.test.ts
```

## Task 2: CallWindow TTS Controls

- [x] Extend `src/components/Call/CallLayer.test.tsx` with a failing test that injects a mock voice runtime, opens a call, clicks `播放当前字幕`, and expects `speechSynthesis.speak()` to be called.

Expected test pattern:

```tsx
expect(screen.getByRole('button', { name: '播放当前字幕' })).toBeEnabled();
fireEvent.click(screen.getByRole('button', { name: '播放当前字幕' }));
expect(speak).toHaveBeenCalledTimes(1);
```

- [x] Run the call layer test and verify it fails because the button does not exist:

```bash
npm run test:run -- src/components/Call/CallLayer.test.tsx
```

- [x] Add optional `voiceRuntime` prop to `CallWindow` and `CallLayer`, defaulting to `window`.

Key prop shape:

```ts
import type { VoiceRuntime } from '../../services/phase3/voice';

interface CallWindowProps {
  voiceRuntime?: VoiceRuntime;
}
```

- [x] Add TTS buttons to `CallWindow`: play current subtitle, stop speech, and auto-speak toggle.

Controls:

```tsx
<button type="button" aria-label="播放当前字幕" onClick={playSubtitle} disabled={!canSpeak || !subtitle?.trim()}>
  <Volume2 size={16} />
</button>
<button type="button" aria-label="停止朗读" onClick={stopSpeech} disabled={!canSpeak}>
  <VolumeX size={16} />
</button>
<button type="button" aria-label="自动朗读字幕" aria-pressed={autoSpeak} onClick={() => setAutoSpeak(value => !value)} disabled={!canSpeak}>
  <Radio size={16} />
</button>
```

- [x] Add an effect that auto-speaks when `autoSpeak` is true and `subtitle` changes to a non-empty string.

Effect:

```ts
useEffect(() => {
  if (autoSpeak && subtitle?.trim()) {
    speechController.speak(subtitle);
  }
}, [autoSpeak, speechController, subtitle]);
```

- [x] Run the call layer test and verify it passes:

```bash
npm run test:run -- src/components/Call/CallLayer.test.tsx
```

## Task 3: CallWindow ASR To Draft

- [x] Extend `src/components/Call/CallLayer.test.tsx` with a failing test that injects a mock `SpeechRecognition`, clicks `开始语音输入`, emits a transcript, and confirms the call textarea contains that transcript.

Expected test pattern:

```tsx
fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
recognitionInstance.onresult({ results: [[{ transcript: '我在听' }]] });
expect(screen.getByPlaceholderText('输入文字...')).toHaveValue('我在听');
```

- [x] Run the call layer test and verify it fails because the mic button does not exist:

```bash
npm run test:run -- src/components/Call/CallLayer.test.tsx
```

- [x] Add ASR state and controls to `CallWindow`.

Behavior:

```ts
const [isListening, setIsListening] = useState(false);
const recognitionController = useMemo(() => createSpeechRecognitionController(voiceRuntime ?? window), [voiceRuntime]);

const toggleListening = () => {
  if (isListening) {
    recognitionController.stop();
    setIsListening(false);
    return;
  }

  setIsListening(true);
  recognitionController.start(
    transcript => {
      setDraft(transcript.trim());
      setIsListening(false);
    },
    () => setIsListening(false),
  );
};
```

Button:

```tsx
<button
  type="button"
  aria-label={isListening ? '停止语音输入' : '开始语音输入'}
  onClick={toggleListening}
  disabled={!recognitionController.isSupported}
>
  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
</button>
```

- [x] Cancel speech and recognition when `CallWindow` unmounts or the call closes.

Cleanup:

```ts
useEffect(() => {
  return () => {
    speechController.cancel();
    recognitionController.stop();
  };
}, [recognitionController, speechController]);
```

- [x] Run the call layer test and verify it passes:

```bash
npm run test:run -- src/components/Call/CallLayer.test.tsx
```

## Task 4: Docs And Verification

- [x] Update `docs/TESTING.md` with Phase 3D automated and manual checks.
- [x] Update `docs/HANDOVER.md` and `docs/PHASE3-HANDOVER.md` to mark Phase 3D local voice as implemented and to leave cloud voice providers / true Live2D renderer as future enhancements.
- [x] Run focused verification:

```bash
npm run test:run -- src/services/phase3/voice.test.ts src/components/Call/CallLayer.test.tsx
```

- [x] Run full verification:

```bash
npm run test:run
npm run build
npm run electron:compile
git diff --check
```

- [x] Run Electron startup smoke, then restore Node ABI:

```bash
npm start
npm run test:run
```

Expected evidence:

- Vite reports ready.
- Electron process starts.
- Final `npm run test:run` passes after `npm start`.
