/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import type { createPhase2Repositories } from '../data/repositories';
import type { CoreEventBus } from './eventBus';
import type { InteractionDispatcher } from './interaction';
import type { CoreMemoryRunner } from './memory';
import { VoiceConversation } from './voiceConversation';

type Repositories = ReturnType<typeof createPhase2Repositories>;

function createHarness(fetchImpl: typeof fetch) {
  const appended: Array<{ role: string; content: string }> = [];
  const character = {
    id: 'char-1',
    name: '蓝蓝',
    description: '一条蓝鱼。',
    personalityCore: '安静',
    speakingStyle: '短句',
    valuesText: '',
    boundaries: '',
  };
  const timeline = {
    id: 'timeline-1',
    characterId: 'char-1',
    title: '蓝蓝',
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
  const memoryRunner = { run: vi.fn(async () => undefined) } as unknown as CoreMemoryRunner;
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
      turnId: 'turn-1',
    }));
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
