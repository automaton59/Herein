import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from './openai';
import { llmFetchJSON } from './http';

vi.mock('./http', () => ({
  llmFetchJSON: vi.fn(),
}));

const config = {
  provider: 'openai' as const,
  apiKey: 'test-key',
  model: 'test-model',
};

function mockChatContent(content: string) {
  vi.mocked(llmFetchJSON).mockResolvedValue({
    choices: [
      {
        message: { content },
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    },
  });
}

describe('OpenAIAdapter emotion parsing', () => {
  beforeEach(() => {
    vi.mocked(llmFetchJSON).mockReset();
  });

  it('extracts playful emotion tags from assistant replies', async () => {
    mockChatContent('今晚走慢一点，风刚好。[emotion: playful]');

    const response = await new OpenAIAdapter(config).chat({
      messages: [],
      systemPrompt: 'test',
    });

    expect(response).toMatchObject({
      content: '今晚走慢一点，风刚好。',
      emotion: 'playful',
    });
  });

  it('extracts serious as a trailing bare emotion label', async () => {
    mockChatContent('这件事我们需要认真处理。\nserious');

    const response = await new OpenAIAdapter(config).chat({
      messages: [],
      systemPrompt: 'test',
    });

    expect(response).toMatchObject({
      content: '这件事我们需要认真处理。',
      emotion: 'serious',
    });
  });

  it('extracts voice instruct tags from assistant replies', async () => {
    mockChatContent('今晚走慢一点，风刚好。[emotion: playful]\n[voice: 用轻快、带笑意的语气说]');

    const response = await new OpenAIAdapter(config).chat({
      messages: [],
      systemPrompt: 'test',
    });

    expect(response).toMatchObject({
      content: '今晚走慢一点，风刚好。',
      emotion: 'playful',
      voiceInstruct: '用轻快、带笑意的语气说',
    });
  });
});
