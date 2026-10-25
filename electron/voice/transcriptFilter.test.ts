/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { VoiceTranscriptFilter, normalizeVoiceText } from './transcriptFilter';

describe('VoiceTranscriptFilter', () => {
  it('drops short fragments and silence', () => {
    const filter = new VoiceTranscriptFilter();

    expect(filter.inspect({ duration: 1 }, '嗯')).toBe('empty');
    expect(filter.inspect({ duration: 0.2 }, '你好')).toBe('too-short');
    expect(filter.inspect({ noSpeechProb: 0.9 }, '今天天气不错')).toBe('no-speech');
  });

  it('drops low-confidence and repetitive ASR output', () => {
    const filter = new VoiceTranscriptFilter();

    expect(filter.inspect({ avgLogprob: -1.2 }, '你好呀')).toBe('low-confidence');
    expect(filter.inspect({ compressionRatio: 3 }, '你好呀')).toBe('repetition');
  });

  it('drops known media subtitles and hallucinations', () => {
    const filter = new VoiceTranscriptFilter();

    expect(filter.inspect({}, '字幕by索兰娅')).toBe('media-hallucination');
    expect(filter.inspect({}, '请不吝点赞 订阅 转发')).toBe('media-hallucination');
  });

  it('accepts a real sentence and suppresses an immediate duplicate', () => {
    const filter = new VoiceTranscriptFilter();

    expect(filter.inspect({ duration: 1.2, noSpeechProb: 0.1 }, '今天有点累')).toBeNull();
    expect(filter.inspect({ duration: 1.2, noSpeechProb: 0.1 }, '今天有点累。')).toBe('repeated');
  });

  it('normalizes punctuation and case', () => {
    expect(normalizeVoiceText(' 你好，世界！ ')).toBe('你好世界');
  });
});
