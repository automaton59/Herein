const HALLUCINATION = /字幕\s*(?:by|由|制作)|索兰娅|请不吝点赞|点赞.*订阅|订阅.*频道|明镜与点点|谢谢观看|感谢观看|中文字幕|字幕组|www\.|https?:\/\//i;

export interface TranscriptMetadata {
  duration?: number;
  noSpeechProb?: number;
  avgLogprob?: number;
  compressionRatio?: number;
}

export function normalizeVoiceText(text: string) {
  return text
    .replace(/[\s，。！？、,.!?~…—\-"'“”‘’]/g, '')
    .toLowerCase();
}

/**
 * Rejects silence, Whisper hallucinations, media subtitles and repeated loops
 * before they can become a voice turn.
 */
export class VoiceTranscriptFilter {
  private lastText = '';
  private lastAt = 0;

  inspect(result: TranscriptMetadata, text: string): string | null {
    const normalized = normalizeVoiceText(text);

    if (!normalized || normalized.length < 2) {
      return 'empty';
    }

    if (typeof result.duration === 'number' && result.duration < 0.35) {
      return 'too-short';
    }

    if ((result.noSpeechProb ?? 0) > 0.6) {
      return 'no-speech';
    }

    if ((result.avgLogprob ?? 0) < -1.0) {
      return 'low-confidence';
    }

    if ((result.compressionRatio ?? 0) > 2.4) {
      return 'repetition';
    }

    if (HALLUCINATION.test(normalized)) {
      return 'media-hallucination';
    }

    if (normalized === this.lastText && Date.now() - this.lastAt < 8000) {
      return 'repeated';
    }

    this.lastText = normalized;
    this.lastAt = Date.now();
    return null;
  }
}
