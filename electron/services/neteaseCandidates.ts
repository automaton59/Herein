export interface NeteaseSongLike {
  id: number;
  name: string;
  ar?: Array<{ name: string }>;
  artists?: Array<{ name: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
}

export interface NeteaseCandidateSource {
  search(keyword: string, limit?: number): Promise<{ songs?: NeteaseSongLike[] }>;
  toplists(): Promise<Array<{ id: number; name: string }>>;
  playlist(id: number, limit?: number): Promise<{ tracks?: NeteaseSongLike[] } | null>;
}

interface CoreContentModule {
  buildSongProfile: (
    song: {
      id: number | string;
      name: string;
      artists?: Array<{ name: string }>;
      album?: { name?: string; picUrl?: string };
      durationMs?: number;
    },
    lyrics?: string,
    source?: string,
  ) => unknown;
  uniqueProfiles: (profiles: unknown[]) => unknown[];
}

let coreModule: Promise<CoreContentModule> | null = null;

function loadCoreContent(): Promise<CoreContentModule> {
  coreModule ??= import('../../packages/core/dist/index.js' as string) as Promise<CoreContentModule>;
  return coreModule;
}

async function defaultSource(): Promise<NeteaseCandidateSource> {
  const adapter = await import('../../adapters/netease/dist/index.js' as string) as {
    NeteaseClient: new (options?: { minIntervalMs?: number }) => NeteaseCandidateSource;
  };
  return new adapter.NeteaseClient({ minIntervalMs: 1200 });
}

export interface NeteaseCandidatesOptions {
  query?: string;
  limit?: number;
  source?: NeteaseCandidateSource;
}

export async function getNeteaseCandidates(options: NeteaseCandidatesOptions = {}): Promise<unknown[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 30));
  const source = options.source ?? await defaultSource();
  const core = await loadCoreContent();
  let songs: NeteaseSongLike[] = [];

  if (options.query?.trim()) {
    const result = await source.search(options.query.trim(), limit);
    songs = result.songs ?? [];
  } else {
    const tops = await source.toplists();

    if (tops[0]) {
      const playlist = await source.playlist(tops[0].id, limit);
      songs = playlist?.tracks ?? [];
    }

    if (songs.length === 0) {
      const result = await source.search('夜晚', limit);
      songs = result.songs ?? [];
    }
  }

  const profiles = songs.slice(0, limit).map(song => core.buildSongProfile({
    id: song.id,
    name: song.name,
    artists: song.ar ?? song.artists,
    album: song.al ?? song.album,
    durationMs: song.dt ?? song.duration,
  }, undefined, 'netease'));

  return core.uniqueProfiles(profiles);
}
