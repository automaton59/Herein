import type { ContentProfile } from './index.js';

export interface SongMetadata {
  id: number | string;
  name: string;
  artists?: Array<{ name: string }>;
  album?: { name?: string; picUrl?: string };
  durationMs?: number;
}

const CREDIT_PATTERN = /^(作词|作曲|编曲|制作人|混音|母带|录音|吉他|贝斯|鼓|键盘|和声|监制|出品|发行|OP|SP)\s*[:：]/i;

export function extractLyricHook(lyric: string | undefined): string {
  if (!lyric) {
    return '';
  }

  const lines = lyric
    .split(/\r?\n/)
    .map(line => line.replace(/^\[[^\]]*\]/, '').trim())
    .filter(Boolean);

  for (const line of lines) {
    if (CREDIT_PATTERN.test(line)) {
      continue;
    }

    if (line.length >= 4 && line.length <= 40) {
      return line;
    }
  }

  return lines.find(line => !CREDIT_PATTERN.test(line)) ?? '';
}

export function buildSongProfile(
  song: SongMetadata,
  lyrics?: string,
  source = 'netease',
): ContentProfile {
  const creators = (song.artists ?? []).map(artist => artist.name).filter(Boolean);
  const hook = extractLyricHook(lyrics);

  return {
    type: 'song',
    itemId: String(song.id),
    title: song.name,
    creator: creators.length ? creators.join(' / ') : undefined,
    coverUrl: song.album?.picUrl,
    durationMs: song.durationMs,
    genre: song.album?.name,
    themes: hook ? [hook] : [],
    mood: undefined,
    hook: hook || undefined,
    source,
  };
}

export function uniqueProfiles(profiles: ContentProfile[]): ContentProfile[] {
  const seen = new Set<string>();
  const result: ContentProfile[] = [];

  for (const profile of profiles) {
    const key = `${profile.type}:${profile.itemId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(profile);
  }

  return result;
}
