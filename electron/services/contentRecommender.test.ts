/** @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendContent } from './contentRecommender';

const tempDirs: string[] = [];

function promptFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'herein-rec-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'prompt.md');
  writeFileSync(file, [
    '你是{{character_name}}。',
    '上下文：{{context}}',
    '候选：{{candidates_json}}',
    '品味：{{taste}}',
  ].join('\n'));
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const llmConfig = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'sk-test',
  model: 'test-model',
};

describe('content recommender', () => {
  it('renders the private prompt and parses an LLM decision', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[0].content).toContain('候选：[{"id":"song-1"}]');
      expect(body.messages[0].content).toContain('品味：{"night":true}');
      expect(body.messages[0].content).toContain('你是角色');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '```json\n{"shouldRecommend":true,"type":"song","itemId":"song-1","reason":"适合现在","confidence":0.8}\n```',
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await recommendContent({
      llmConfig,
      context: '用户说想听点安静的',
      candidates: [{ id: 'song-1' }],
      taste: { night: true },
      gate: {
        now: new Date('2026-10-21T12:00:00.000Z'),
        itemId: 'song-1',
        turnsSinceLast: 20,
      },
      promptPath: promptFile(),
      fetchImpl,
    });

    expect(result.decision).toEqual({
      shouldRecommend: true,
      type: 'song',
      itemId: 'song-1',
      reason: '适合现在',
      confidence: 0.8,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not call the LLM when the gate blocks', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await recommendContent({
      llmConfig,
      context: '用户很难过',
      candidates: [{ id: 'song-1' }],
      gate: {
        now: new Date('2026-10-21T12:00:00.000Z'),
        itemId: 'song-1',
        userMood: 'sad',
      },
      promptPath: promptFile(),
      fetchImpl,
    });

    expect(result.decision).toEqual({ shouldRecommend: false });
    expect(result.blockedByGate).toContain('upset');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
