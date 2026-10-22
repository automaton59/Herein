/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, chatCompletionsUrl, loadLlmConfig } from './llm';

const tempDirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-llm-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('core llm gateway', () => {
  it('builds a chat/completions URL from common base URLs', () => {
    expect(chatCompletionsUrl('https://example.test/v1')).toBe('https://example.test/v1/chat/completions');
    expect(chatCompletionsUrl('https://example.test/v1/chat/completions')).toBe('https://example.test/v1/chat/completions');
    expect(chatCompletionsUrl('https://example.test/')).toBe('https://example.test/v1/chat/completions');
  });

  it('loads and validates the private llm.json shape', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'llm.json');
    writeFileSync(file, JSON.stringify({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      temperature: 0.3,
      maxTokens: 64,
    }));

    await expect(loadLlmConfig(file)).resolves.toEqual({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      temperature: 0.3,
      maxTokens: 64,
    });
  });

  it('posts OpenAI-compatible chat and parses usage', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: 'Bearer sk-test',
      }));
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: '在吗' },
      ]);

      return new Response(JSON.stringify({
        model: 'test-model',
        choices: [{ message: { role: 'assistant', content: '在。' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await chatCompletion(
      { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test-model' },
      [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: '在吗' },
      ],
      { fetchImpl, timeoutMs: 1000 },
    );

    expect(result.content).toBe('在。');
    expect(result.model).toBe('test-model');
    expect(result.usage).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    });
  });

  it('throws a useful error on non-2xx responses', async () => {
    const fetchImpl = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;

    await expect(chatCompletion(
      { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'test-model' },
      [{ role: 'user', content: 'hi' }],
      { fetchImpl },
    )).rejects.toThrow('LLM HTTP 502');
  });
});
