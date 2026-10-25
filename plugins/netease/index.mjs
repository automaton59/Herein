/**
 * NetEase Cloud Music — read-only source plugin.
 *
 * This plugin only fetches and shapes data. It never touches the database: the
 * Core decides what to do with the candidates it returns.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

function resolveLimit(input, config) {
  const body = input && typeof input === 'object' ? input : {};
  const fromInput = typeof body.limit === 'number' ? body.limit : undefined;
  const fromConfig = Number(config.limit);
  const raw = fromInput ?? (Number.isFinite(fromConfig) ? fromConfig : DEFAULT_LIMIT);

  return Math.max(1, Math.min(MAX_LIMIT, Math.round(raw)));
}

export function createPlugin() {
  let lastError = null;
  let lastSuccessAt;
  let sourcePromise = null;

  /**
   * The client is created once and reused: it keeps a request interval so we do
   * not hammer a public endpoint that has no API key to rate-limit us.
   */
  async function getSource(ctx) {
    if (!sourcePromise) {
      sourcePromise = ctx.loadModule('adapters/netease/dist/index.js').then(module => {
        if (typeof module.NeteaseClient !== 'function') {
          throw new Error('netease adapter does not export NeteaseClient');
        }

        return new module.NeteaseClient({ minIntervalMs: 1200 });
      });
    }

    return sourcePromise;
  }

  return {
    async start() {
      lastError = null;
    },

    async stop() {
      lastError = null;
      sourcePromise = null;
    },

    async health(ctx) {
      const checkedAt = ctx.now().toISOString();

      if (lastError) {
        return {
          status: 'degraded',
          message: lastError,
          checkedAt,
          ...(lastSuccessAt ? { lastSuccessAt } : {}),
        };
      }

      return {
        status: 'ok',
        message: lastSuccessAt ? '最近取候选成功' : '待首次取候选',
        checkedAt,
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
      };
    },

    async invoke(action, input, ctx) {
      if (action !== 'candidates') {
        throw new Error(`不支持的网易云动作：${action}`);
      }

      const body = input && typeof input === 'object' ? input : {};
      const query = typeof body.query === 'string' ? body.query : undefined;
      const limit = resolveLimit(input, ctx.config);

      try {
        const source = await getSource(ctx);
        const core = await ctx.loadModule('packages/core/dist/index.js');

        let songs = [];

        if (query && query.trim()) {
          const result = await source.search(query.trim(), limit);
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

        lastSuccessAt = ctx.now().toISOString();
        lastError = null;

        return { candidates: core.uniqueProfiles(profiles) };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
}
