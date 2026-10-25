import { describe, expect, it } from 'vitest';
import { parseAssistantMetadata, stripAssistantMetadata } from './assistantMeta';

describe('assistant metadata', () => {
  it('extracts emotion and voice tags and keeps the body clean', () => {
    const parsed = parseAssistantMetadata('在的。 [emotion: happy] [voice: 轻一点说]');
    expect(parsed.text).toBe('在的。');
    expect(parsed.emotion).toBe('happy');
    expect(parsed.voiceInstruct).toBe('轻一点说');
  });

  it('keeps plain text unchanged', () => {
    expect(stripAssistantMetadata('在的。')).toBe('在的。');
  });

  it('handles a trailing bare emotion line', () => {
    const parsed = parseAssistantMetadata('好。\nhappy');
    expect(parsed.text).toBe('好。');
    expect(parsed.emotion).toBe('happy');
  });
});
