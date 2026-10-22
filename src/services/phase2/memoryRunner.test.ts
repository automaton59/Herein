import { describe, expect, it } from 'vitest';
import {
  buildMemoryUpdatePrompt,
  parseMemoryUpdateOutput,
} from './memoryRunner';

describe('memoryRunner', () => {
  it('builds a JSON-only prompt for summary and structured memory extraction', () => {
    const prompt = buildMemoryUpdatePrompt({
      previousSummary: 'They talked about moving.',
      messages: [
        { id: 'msg-1', role: 'user', content: 'I am moving from Hangzhou to Shanghai next week.' },
        { id: 'msg-2', role: 'assistant', content: 'I will remember the timing.' },
      ],
    });

    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('You are not the chat character');
    expect(prompt).toContain('Do not write the next assistant message');
    expect(prompt).toContain('natural development');
    expect(prompt).toContain('not a conflict');
    expect(prompt).toContain('exactly one JSON object');
    expect(prompt).toContain('conversationSummary');
    expect(prompt).toContain('memoryItems');
    expect(prompt).toContain('state | event | preference | relationship | profile');
    expect(prompt).toContain('historicalNote');
    expect(prompt).toContain('sourceMessageIds');
    expect(prompt).toContain('[msg-1] user: I am moving from Hangzhou to Shanghai next week.');
    expect(prompt).toContain('[msg-2] assistant: I will remember the timing.');
    expect(prompt).toContain('I am moving from Hangzhou to Shanghai next week.');
  });

  it('parses valid structured memory output', () => {
    const parsed = parseMemoryUpdateOutput(
      JSON.stringify({
        conversationSummary: 'User is preparing to move from Hangzhou to Shanghai.',
        memoryItems: [
          {
            kind: 'state',
            scope: 'character',
            content: 'User will move from Hangzhou to Shanghai next week.',
            currentValue: 'Moving to Shanghai next week.',
            previousValue: 'Recently in Hangzhou.',
            confidence: 0.91,
          },
        ],
      }),
      { timelineId: 'timeline-1', characterId: 'char-1' },
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.summary.content).toBe('User is preparing to move from Hangzhou to Shanghai.');
    expect(parsed.ok && parsed.memories[0]).toEqual(expect.objectContaining({
      timelineId: 'timeline-1',
      characterId: 'char-1',
      kind: 'state',
      currentValue: 'Moving to Shanghai next week.',
      previousValue: 'Recently in Hangzhou.',
      origin: 'summary',
      includeInContext: true,
    }));
  });

  it('rejects invalid or chat-like output', () => {
    expect(parseMemoryUpdateOutput('好的，我会记住。', {
      timelineId: 'timeline-1',
      characterId: 'char-1',
    })).toEqual({
      ok: false,
      error: 'Memory output was not valid JSON.',
    });

    expect(parseMemoryUpdateOutput(JSON.stringify({ reply: '下一段对话' }), {
      timelineId: 'timeline-1',
      characterId: 'char-1',
    })).toEqual({
      ok: false,
      error: 'Memory output did not include a valid conversationSummary.',
    });
  });
});
