const DEFAULT_CACHE_MINUTES = 15;
const MAX_CACHE_MINUTES = 180;

const WEATHER_TEXT = new Map([
  [0, '晴'],
  [1, '大部晴朗'],
  [2, '多云'],
  [3, '阴'],
  [45, '雾'],
  [48, '雾凇'],
  [51, '小毛毛雨'],
  [53, '毛毛雨'],
  [55, '大毛毛雨'],
  [56, '冻毛毛雨'],
  [57, '强冻毛毛雨'],
  [61, '小雨'],
  [63, '中雨'],
  [65, '大雨'],
  [66, '冻雨'],
  [67, '强冻雨'],
  [71, '小雪'],
  [73, '中雪'],
  [75, '大雪'],
  [77, '米雪'],
  [80, '小阵雨'],
  [81, '阵雨'],
  [82, '强阵雨'],
  [85, '小阵雪'],
  [86, '强阵雪'],
  [95, '雷暴'],
  [96, '雷暴伴小冰雹'],
  [99, '雷暴伴大冰雹'],
]);

let cache = null;
let locationCache = null;
let lastError = null;
let lastSuccessAt = null;

function nowIso(ctx) {
  return ctx.now().toISOString();
}

function cacheMinutes(config) {
  const value = Number(config.refreshMinutes);
  if (!Number.isFinite(value)) {
    return DEFAULT_CACHE_MINUTES;
  }

  return Math.min(MAX_CACHE_MINUTES, Math.max(1, value));
}

function hasCoordinates(config) {
  return Number.isFinite(Number(config.latitude)) && Number.isFinite(Number(config.longitude));
}

function cityOf(config) {
  return typeof config.city === 'string' ? config.city.trim() : '';
}

function isConfigured(config) {
  return hasCoordinates(config) || Boolean(cityOf(config));
}

function weatherText(code) {
  return WEATHER_TEXT.get(Number(code)) ?? `天气代码 ${code}`;
}

async function fetchJson(ctx, url) {
  const response = await ctx.fetch(url, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  return response.json();
}

async function resolveLocation(ctx, config) {
  if (hasCoordinates(config)) {
    return {
      name: config.locationName || '当前位置',
      country: '',
      latitude: Number(config.latitude),
      longitude: Number(config.longitude),
    };
  }

  const city = cityOf(config);
  const cachedLocation = locationCache && locationCache.city === city ? locationCache.location : null;

  if (cachedLocation) {
    return cachedLocation;
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');

  const data = await fetchJson(ctx, url.toString());
  const first = Array.isArray(data.results) ? data.results[0] : null;

  if (!first) {
    throw new Error(`找不到城市：${city}`);
  }

  const location = {
    name: config.locationName || first.name || city,
    country: first.country || '',
    latitude: Number(first.latitude),
    longitude: Number(first.longitude),
  };

  locationCache = { city, location };
  return location;
}

async function fetchCurrent(ctx, config, location) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
  );
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('wind_speed_unit', 'kmh');

  const data = await fetchJson(ctx, url.toString());
  const current = data.current ?? {};

  if (current.temperature_2m === undefined) {
    throw new Error('Open-Meteo 返回里没有当前温度');
  }

  return {
    ok: true,
    location,
    current: {
      temperatureC: Number(current.temperature_2m),
      apparentC: Number(current.apparent_temperature),
      humidity: Number(current.relative_humidity_2m),
      windKph: Number(current.wind_speed_10m),
      weatherCode: Number(current.weather_code),
      weather: weatherText(current.weather_code),
      observedAt: current.time ?? nowIso(ctx),
    },
    source: 'open-meteo',
    fetchedAt: nowIso(ctx),
  };
}

export function createPlugin() {
  return {
    async start(ctx) {
      cache = null;
      locationCache = null;
      lastError = null;

      if (!isConfigured(ctx.config)) {
        ctx.log('warn', 'weather is installed but not configured yet');
      }
    },

    async stop() {
      cache = null;
      locationCache = null;
    },

    async health(ctx) {
      if (!isConfigured(ctx.config)) {
        return {
          status: 'degraded',
          message: '配置城市或经纬度后可用',
          checkedAt: nowIso(ctx),
        };
      }

      if (lastError) {
        return {
          status: 'degraded',
          message: lastError,
          checkedAt: nowIso(ctx),
          ...(lastSuccessAt ? { lastSuccessAt } : {}),
        };
      }

      return {
        status: 'ok',
        message: lastSuccessAt ? '最近查询成功' : '待首次查询',
        checkedAt: nowIso(ctx),
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
      };
    },

    async invoke(action, _input, ctx) {
      if (action !== 'current') {
        throw new Error(`不支持的天气动作：${action}`);
      }

      if (!isConfigured(ctx.config)) {
        throw new Error('天气未配置：请设置城市或经纬度');
      }

      try {
        const location = await resolveLocation(ctx, ctx.config);
        const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
        const ttlMs = cacheMinutes(ctx.config) * 60 * 1000;

        if (cache && cache.key === key && Date.now() - cache.at < ttlMs) {
          return { ...cache.value, cached: true };
        }

        const value = await fetchCurrent(ctx, ctx.config, location);
        cache = { key, at: Date.now(), value };
        lastError = null;
        lastSuccessAt = nowIso(ctx);
        return { ...value, cached: false };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
}
