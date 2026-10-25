// 表情包插件：只提供「有哪些表情、哪张更合适」。
// 什么时候发、发多频繁由 Core 决定，插件不掌握节奏。
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
// Dev fallback only: <repo>/plugins/stickers → <repo>. Packaged builds pass the
// real asset roots through ctx.assetsDirs (see assetRoots()).
const REPO_ROOT = path.resolve(PLUGIN_DIR, '..', '..');
const STICKER_SUBDIR = 'stickers';
const IMAGE_EXT = new Set(['.gif', '.webp', '.png', '.jpg', '.jpeg']);
const CACHE_TTL_MS = 30_000;

// 中文情绪目录 → Core 的英文情绪枚举。
const EMOTION_ALIASES = new Map([
  ['开心', 'happy'],
  ['高兴', 'happy'],
  ['大笑', 'happy'],
  ['喜欢', 'happy'],
  ['难过', 'sad'],
  ['哭', 'sad'],
  ['生气', 'angry'],
  ['害羞', 'shy'],
  ['兴奋', 'excited'],
  ['得意', 'excited'],
  ['担心', 'worried'],
  ['焦虑', 'worried'],
  ['害怕', 'worried'],
  ['搞怪', 'playful'],
  ['卖萌', 'playful'],
  ['嘲讽', 'playful'],
  ['思考', 'serious'],
  ['无语', 'serious'],
  ['疑惑', 'serious'],
  ['赞同', 'happy'],
  ['拒绝', 'serious'],
  ['安慰', 'worried'],
  ['疲惫', 'sad'],
]);

let scanCache = null;
let lastError = null;

function nowIso(ctx) {
  return ctx.now().toISOString();
}

function assetRoots(ctx) {
  const roots = [];
  const push = dir => {
    if (typeof dir === 'string' && dir.trim()) {
      roots.push(path.resolve(dir));
    }
  };

  for (const dir of Array.isArray(ctx?.assetsDirs) ? ctx.assetsDirs : []) {
    push(dir);
  }

  if (typeof ctx?.dataDir === 'string' && ctx.dataDir.trim()) {
    push(path.join(ctx.dataDir, 'assets'));
  }

  push(path.join(REPO_ROOT, 'private', 'assets'));

  return [...new Set(roots)];
}

function hasEntries(dir) {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function configDir(ctx) {
  return typeof ctx.config?.dir === 'string' ? ctx.config.dir.trim() : '';
}

// Default: the first asset root that already contains stickers (keeps an
// existing `private/assets/stickers` working), otherwise the user data folder,
// which is writable and survives app updates.
function defaultDir(ctx) {
  for (const root of assetRoots(ctx)) {
    const candidate = path.join(root, STICKER_SUBDIR);

    if (hasEntries(candidate)) {
      return candidate;
    }
  }

  const writable = typeof ctx?.dataDir === 'string' && ctx.dataDir.trim()
    ? path.join(ctx.dataDir, 'assets', STICKER_SUBDIR)
    : path.join(assetRoots(ctx)[0] ?? REPO_ROOT, STICKER_SUBDIR);

  return writable;
}

function resolveDir(ctx) {
  const raw = configDir(ctx);

  if (!raw) {
    return defaultDir(ctx);
  }

  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  for (const root of assetRoots(ctx)) {
    const resolved = path.resolve(root, raw);

    if (resolved.startsWith(`${root}${path.sep}`) && existsSync(resolved)) {
      return resolved;
    }
  }

  // Relative paths from the repository docs (`private/assets/stickers`).
  const fromRepo = path.resolve(REPO_ROOT, raw);

  if (existsSync(fromRepo)) {
    return fromRepo;
  }

  const firstRoot = assetRoots(ctx)[0] ?? REPO_ROOT;

  return path.resolve(firstRoot, raw);
}

function assetUrlFor(ctx, filePath) {
  const absolute = path.resolve(filePath);

  for (const root of assetRoots(ctx)) {
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      continue;
    }

    const relative = path.relative(root, absolute).split(path.sep).map(encodeURIComponent).join('/');
    return `/assets/${relative}`;
  }

  return null;
}

function nameOf(file) {
  return path.basename(file, path.extname(file)).replace(/^[0-9A-Za-z]+[_\-.\s]+/, '').trim()
    || path.basename(file, path.extname(file));
}

function tagsOf(name) {
  return name
    .split(/[\s_\-.,，、+/]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 1 && part.length <= 12);
}

async function readAnnotations(packDir) {
  try {
    const raw = JSON.parse(await readFile(path.join(packDir, 'stickers.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.stickers) ? raw.stickers : [];

    return new Map(list.map(item => [String(item.file ?? item.name ?? ''), item]));
  } catch {
    return new Map();
  }
}

async function walkPack(packName, packDir, ctx) {
  const annotations = await readAnnotations(packDir);
  const entries = await readdir(packDir, { withFileTypes: true });
  const stickers = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const absolute = path.join(packDir, entry.name);

    if (entry.isDirectory()) {
      const emotionFolder = entry.name;
      const nested = await readdir(absolute, { withFileTypes: true });

      for (const file of nested) {
        if (!file.isFile() || !IMAGE_EXT.has(path.extname(file.name).toLowerCase())) {
          continue;
        }

        stickers.push(buildSticker({
          ctx,
          packName,
          absolute: path.join(absolute, file.name),
          emotion: EMOTION_ALIASES.get(emotionFolder) ?? emotionFolder,
          annotation: annotations.get(file.name),
        }));
      }

      continue;
    }

    if (!entry.isFile() || !IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    stickers.push(buildSticker({
      ctx,
      packName,
      absolute,
      emotion: null,
      annotation: annotations.get(entry.name),
    }));
  }

  return stickers.filter(Boolean);
}

function buildSticker({ ctx, packName, absolute, emotion, annotation }) {
  const url = assetUrlFor(ctx, absolute);

  if (!url) {
    return null;
  }

  const name = typeof annotation?.name === 'string' && annotation.name.trim()
    ? annotation.name.trim()
    : nameOf(absolute);
  const tags = Array.isArray(annotation?.tags)
    ? annotation.tags.map(String).filter(Boolean)
    : tagsOf(name);

  return {
    id: `${packName}/${path.basename(absolute)}`,
    name,
    pack: packName,
    emotion: typeof annotation?.emotion === 'string' && annotation.emotion
      ? annotation.emotion
      : emotion,
    tags,
    use: typeof annotation?.use === 'string' ? annotation.use : '',
    url,
  };
}

async function scan(ctx, options = {}) {
  const dir = resolveDir(ctx);
  const key = `${dir}|${String(ctx.config.pack ?? '')}`;

  if (options.fresh !== true && scanCache && scanCache.key === key && Date.now() - scanCache.at < CACHE_TTL_MS) {
    return scanCache.value;
  }

  const packFilter = typeof ctx.config?.pack === 'string' ? ctx.config.pack.trim() : '';
  let packs = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    packs = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .filter(name => !packFilter || name === packFilter);
  } catch (error) {
    // A missing directory means "nothing configured yet", not a broken plugin.
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      lastError = null;
      const empty = { dir, packs: [], stickers: [], missing: true };
      scanCache = { key, at: Date.now(), value: empty };
      return empty;
    }

    lastError = `表情目录不可读：${dir}（${error?.code ?? 'unknown'}）`;
    throw error;
  }

  const stickers = [];

  for (const pack of packs) {
    try {
      stickers.push(...await walkPack(pack, path.join(dir, pack), ctx));
    } catch (error) {
      ctx.log('warn', `cannot read sticker pack: ${pack}`, error instanceof Error ? error.message : error);
    }
  }

  const value = { dir, packs, stickers, missing: false };
  scanCache = { key, at: Date.now(), value };
  lastError = null;
  return value;
}

function bigrams(text) {
  const clean = String(text ?? '').replace(/[\s\p{P}\p{S}]+/gu, '');

  if (clean.length <= 2) {
    return clean ? [clean] : [];
  }

  const grams = new Set();

  for (let index = 0; index < clean.length - 1; index += 1) {
    grams.add(clean.slice(index, index + 2));
  }

  return [...grams];
}

function scoreSticker(sticker, input, allowEmotion) {
  let score = 0;

  if (allowEmotion && input.emotion && sticker.emotion) {
    score += sticker.emotion === input.emotion ? 8 : 0;
  }

  const haystack = `${sticker.name} ${sticker.tags.join(' ')} ${sticker.use}`;
  const grams = input.grams ?? [];

  for (const gram of grams) {
    if (haystack.includes(gram)) {
      score += 2;
    }
  }

  if (input.text && input.text.includes(sticker.name)) {
    score += 6;
  }

  return score;
}

export function createPlugin() {
  return {
    async start(ctx) {
      scanCache = null;
      lastError = null;

      // Only the default directory is auto-created; an explicit `dir` is left
      // alone so a typo surfaces instead of silently creating an empty folder.
      if (!configDir(ctx)) {
        try {
          await mkdir(resolveDir(ctx), { recursive: true });
        } catch (error) {
          ctx.log('warn', 'stickers: cannot create sticker directory', error instanceof Error ? error.message : error);
        }
      }

      try {
        const value = await scan(ctx);
        ctx.log('info', `stickers: ${value.packs.length} packs / ${value.stickers.length} stickers`, value.dir);
      } catch (error) {
        ctx.log('warn', 'stickers: directory not ready', error instanceof Error ? error.message : error);
      }
    },

    async stop() {
      scanCache = null;
    },

    async health(ctx) {
      try {
        // Health is a user-triggered check: always look at the disk so dropping
        // a new pack in is visible immediately.
        const value = await scan(ctx, { fresh: true });

        if (value.stickers.length === 0) {
          return {
            status: 'degraded',
            message: value.missing
              ? `还没放表情：${value.dir}`
              : `目录里还没有图片：${value.dir}`,
            checkedAt: nowIso(ctx),
          };
        }

        return {
          status: 'ok',
          message: `${value.packs.length} 套 / ${value.stickers.length} 张`,
          checkedAt: nowIso(ctx),
        };
      } catch (error) {
        return {
          status: 'failed',
          message: lastError ?? (error instanceof Error ? error.message : '读取表情目录失败'),
          checkedAt: nowIso(ctx),
        };
      }
    },

    async invoke(action, input, ctx) {
      const body = input && typeof input === 'object' ? input : {};

      if (action === 'index') {
        const value = await scan(ctx);
        return {
          dir: value.dir,
          packs: value.packs,
          count: value.stickers.length,
          missing: value.missing === true,
        };
      }

      if (action === 'list') {
        const value = await scan(ctx);
        const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
        return { stickers: value.stickers.slice(0, limit) };
      }

      if (action !== 'pick') {
        throw new Error(`不支持的表情动作：${action}`);
      }

      const value = await scan(ctx);

      if (value.stickers.length === 0) {
        return null;
      }

      const excluded = new Set(Array.isArray(body.exclude) ? body.exclude.map(String) : []);
      const pool = value.stickers.filter(sticker => !excluded.has(sticker.id));

      if (pool.length === 0) {
        return null;
      }

      const input2 = {
        emotion: typeof body.emotion === 'string' ? body.emotion : '',
        text: typeof body.text === 'string' ? body.text : '',
        grams: bigrams(body.text),
      };
      const allowEmotion = ctx.config.emotions !== false;
      const ranked = pool
        .map(sticker => ({ sticker, score: scoreSticker(sticker, input2, allowEmotion) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.score ?? 0;
      const shortlist = ranked.filter(item => item.score >= Math.max(1, best)).slice(0, 8);

      if (shortlist.length === 0) {
        return null;
      }

      return shortlist[Math.floor(Math.random() * shortlist.length)].sticker;
    },
  };
}
