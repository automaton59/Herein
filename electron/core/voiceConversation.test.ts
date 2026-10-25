/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import type { createPhase2Repositories } from '../data/repositories';
import type { CoreEventBus } from './eventBus';
import type { InteractionDispatcher } from './interaction';
import { VoiceConversation, type VoiceConversationOptions } from './voiceConversation';

type Repositories = ReturnType<typeof createPhase2Repositories>;

function createHarness(fetchImpl: typeof fetch, options: Partial<VoiceConversationOptions> = {}) {
  const appended: Array<{ role: string; content: string }> = [];
  const character = {
    id: 'char-1',
    name: '小蓝',
    description: '一条蓝鱼。',
    personalityCore: '安静',
    speakingStyle: '短句',
    valuesText: '',
    boundaries: '',
  };
  const timeline = {
    id: 'timeline-1',
    characterId: 'char-1',
    title: '小蓝',
  };
  const repos = {
    characters: {
      get: vi.fn((id: string) => id === 'char-1' ? character : null),
      list: vi.fn(() => [character]),
    },
    timelines: {
      getPrimaryForCharacter: vi.fn(() => timeline),
      ensurePrimaryForCharacter: vi.fn(() => timeline),
    },
    messages: {
      listRecent: vi.fn(() => []),
      append: vi.fn((message: { role: string; content: string }) => {
        appended.push(message);
      }),
    },
    relationships: { get: vi.fn(() => null) },
    summaries: { getByTimeline: vi.fn(() => null) },
    memories: { listActive: vi.fn(() => []) },
  } as unknown as Repositories;
  const events = { publish: vi.fn() } as unknown as CoreEventBus;
  const memoryRunner = { run: vi.fn(async () => undefined) };
  const dispatcher = { speak: vi.fn(async () => ({ ok: true })) } as unknown as InteractionDispatcher;

  return {
    repos,
    events,
    memoryRunner,
    dispatcher,
    appended,
    voice: new VoiceConversation({
      repos,
      events,
      memoryRunner,
      dispatcher,
      llmConfig: {
        baseUrl: 'https://llm.test/v1',
        apiKey: 'sk-test',
        model: 'fake-model',
      },
      fetchImpl,
      waitForSpeechCompletion: false,
      ...options,
    }),
  };
}

function completion(content: string): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    model: 'fake-model',
    choices: [{ message: { role: 'assistant', content } }],
  }), { status: 200 })) as typeof fetch;
}

describe('VoiceConversation', () => {
  it('persists a transcript/reply and speaks it with the A turnId', async () => {
    const harness = createHarness(completion('在的。'));
    harness.voice.handleTranscript('你好', 'turn-1');
    await harness.voice.whenIdle();
    await harness.voice.stop();

    expect(harness.appended.map(message => [message.role, message.content])).toEqual([
      ['user', '你好'],
      ['assistant', '在的。'],
    ]);
    expect(harness.events.publish).toHaveBeenCalledWith('chat.completed', expect.objectContaining({
      source: 'voice',
    }));
    expect(harness.dispatcher.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: '在的。',
      source: 'chat',
      turnId: 'turn-1:0',
    }));
  });

  it('splits a longer spoken reply into short parts', async () => {
    const harness = createHarness(completion('在的。你先说。'));
    harness.voice.handleTranscript('你好', 'turn-3');
    await harness.voice.whenIdle();
    await harness.voice.stop();

    expect(harness.dispatcher.speak).toHaveBeenCalledTimes(2);
    expect(harness.dispatcher.speak).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: '在的。',
      turnId: 'turn-3:0',
    }));
    expect(harness.dispatcher.speak).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: '你先说。',
      turnId: 'turn-3:1',
    }));
  });

  it('sends a light backchannel while the user keeps talking', async () => {
    vi.useFakeTimers();
    const harness = createHarness(completion('在。'));

    try {
      harness.voice.handleVad('start');
      await vi.advanceTimersByTimeAsync(8_000);

      expect(harness.dispatcher.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: '嗯',
        priority: 'ambient',
      }));
    } finally {
      harness.voice.handleVad('end');
      vi.useRealTimers();
    }
  });

  it('interjects after a long uninterrupted user turn', async () => {
    vi.useFakeTimers();
    const harness = createHarness(completion('在。'));

    try {
      harness.voice.handleVad('start');
      await vi.advanceTimersByTimeAsync(25_000);

      expect(harness.dispatcher.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: '等等',
        priority: 'urgent',
      }));
    } finally {
      harness.voice.handleVad('end');
      vi.useRealTimers();
    }
  });

  it('does not interject after the user stops speaking', async () => {
    vi.useFakeTimers();
    const harness = createHarness(completion('在。'));

    try {
      harness.voice.handleVad('start');
      harness.voice.handleVad('end');
      await vi.advanceTimersByTimeAsync(25_000);

      expect(harness.dispatcher.speak).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the interrupted part into the next voice turn', async () => {
    const bodies: Array<{ messages: Array<{ content: string }> }> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> });
      return new Response(JSON.stringify({
        model: 'fake-model',
        choices: [{ message: { role: 'assistant', content: '在的。' } }],
      }), { status: 200 });
    }) as typeof fetch;
    const harness = createHarness(fetchImpl, {
      waitForSpeechCompletion: true,
      speechTimeoutMs: 10,
    });

    harness.voice.handleTranscript('你好', 'turn-4');
    await vi.waitFor(() => expect(harness.dispatcher.speak).toHaveBeenCalled());
    harness.voice.interrupt();
    harness.voice.handleTranscript('继续', 'turn-5');
    await harness.voice.whenIdle();
    await harness.voice.stop();

    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages[0].content).toContain('【刚才】');
    expect(bodies[1].messages[0].content).toContain('打断');
  });

  it('does not speak a reply that was interrupted while the LLM was running', async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => {
      resolveFetch = resolve;
    })) as typeof fetch;
    const harness = createHarness(fetchImpl);

    harness.voice.handleTranscript('你好', 'turn-2');
    await vi.waitFor(() => expect(resolveFetch).not.toBeNull());
    harness.voice.interrupt();
    resolveFetch?.(new Response(JSON.stringify({
      model: 'fake-model',
      choices: [{ message: { role: 'assistant', content: '在。' } }],
    }), { status: 200 }));
    await harness.voice.stop();

    expect(harness.dispatcher.speak).not.toHaveBeenCalled();
  });
});
