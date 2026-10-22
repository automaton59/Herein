export interface NeteaseArtist {
  id: number;
  name: string;
}

export interface NeteaseAlbum {
  id: number;
  name: string;
  picUrl?: string;
}

export interface NeteaseSong {
  id: number;
  name: string;
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
  al?: NeteaseAlbum;
  album?: NeteaseAlbum;
  dt?: number;
  duration?: number;
  fee?: number;
  privilege?: Record<string, unknown>;
}

export interface NeteaseSearchResult {
  songs?: NeteaseSong[];
  songCount?: number;
}

export interface NeteaseLyrics {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  romalrc?: { lyric?: string };
  [key: string]: unknown;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  description?: string;
  coverImgUrl?: string;
  playCount?: number;
  trackCount?: number;
  creator?: { userId: number; nickname: string };
  tracks?: NeteaseSong[];
}

export interface NeteaseToplist {
  id: number;
  name: string;
  coverImgUrl?: string;
  updateFrequency?: string;
  trackCount?: number;
}

export interface NeteaseClientOptions {
  fetchImpl?: typeof fetch;
  cookie?: string;
  userAgent?: string;
  minIntervalMs?: number;
}
