import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { createPhase2Repositories } from '../data/repositories';
import { assetUrl, findExistingAsset, resolveAssetRoots } from '../assets/paths';
import type { PersonaRuntime } from '../persona/runtime';
import type {
  DesktopPresenceState,
  PresenceAvatar,
  PresenceEmotion,
  PresenceLive2DAvatar,
} from './types';

type Repositories = ReturnType<typeof createPhase2Repositories>;

const EMOTIONS: PresenceEmotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'excited',
  'worried',
  'playful',
  'serious',
];
const EMOTION_SET = new Set<string>(EMOTIONS);

export interface ResolvePresenceInput {
  repos: Repositories;
  dataDir: string;
  characterId: string;
  persona: PersonaRuntime | null;
  coreUrl: string | null;
  hosting: boolean;
  mainWindowVisible: boolean;
}

function normalizeEmotion(value: unknown): PresenceEmotion {
  return typeof value === 'string' && EMOTION_SET.has(value.trim().toLowerCase())
    ? value.trim().toLowerCase() as PresenceEmotion
    : 'neutral';
}

function lastAssistantEmotion(repos: Repositories, characterId: string): PresenceEmotion {
  const timeline = repos.timelines.getPrimaryForCharacter(characterId);

  if (!timeline) {
    return 'neutral';
  }

  const messages = repos.messages.listRecent(timeline.id, 30);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === 'assistant' && message.emotion) {
      return normalizeEmotion(message.emotion);
    }
  }

  return 'neutral';
}

function isLive2DModel(fileName: string) {
  return /\.model(3)?\.json$/i.test(fileName);
}

function isCubism4Model(fileName: string) {
  return /\.model3\.json$/i.test(fileName);
}

async function readExpressionNames(absolutePath: string, cubism: 2 | 4): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(absolutePath, 'utf8')) as Record<string, unknown>;

    if (cubism === 4) {
      const references = parsed.FileReferences;

      if (typeof references === 'object' && references !== null) {
        const expressions = (references as Record<string, unknown>).Expressions;

        if (Array.isArray(expressions)) {
          return expressions
            .map(item => (
              typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).Name === 'string'
                ? (item as Record<string, unknown>).Name as string
                : null
            ))
            .filter((name): name is string => Boolean(name));
        }
      }

      return [];
    }

    const expressions = parsed.expressions;

    if (!Array.isArray(expressions)) {
      return [];
    }

    return expressions
      .map(item => (
        typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string'
          ? (item as Record<string, unknown>).name as string
          : null
      ))
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

function pickExpression(names: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = names.find(name => pattern.test(name));

    if (match) {
      return match;
    }
  }

  return null;
}

function inferExpressionMap(names: string[]): Partial<Record<PresenceEmotion, string | null>> {
  const happy = pickExpression(names, [/^happy$/i, /happy(?!2)/i, /smile/i, /^f0?1$/i]);
  const shy = pickExpression(names, [/^happy2$/i, /shy/i, /blush/i, /embarrass/i]);
  const sad = pickExpression(names, [/^unhappy$/i, /sad/i, /sorrow/i, /^f0?3$/i]);
  const angry = pickExpression(names, [/angry/i, /^unhappy$/i, /^f0?4$/i]);
  const worried = pickExpression(names, [/puzzled/i, /worried/i, /anxious/i, /^unhappy$/i, /^f0?3$/i]);

  return {
    neutral: null,
    happy: happy ?? shy,
    excited: happy ?? shy,
    playful: shy ?? happy,
    shy: shy ?? happy,
    sad: sad ?? worried,
    angry: angry ?? sad,
    worried: worried ?? sad,
    serious: null,
  };
}

function normalizeEmotionMap(input: unknown): Partial<Record<PresenceEmotion, string | null>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {};
  }

  const result: Partial<Record<PresenceEmotion, string | null>> = {};

  for (const emotion of EMOTIONS) {
    const raw = (input as Record<string, unknown>)[emotion];

    if (raw === null) {
      result[emotion] = null;
      continue;
    }

    if (typeof raw === 'string' && raw.trim()) {
      result[emotion] = raw.trim();
      continue;
    }

    if (typeof raw === 'object' && raw !== null) {
      const expression = (raw as Record<string, unknown>).expression;

      if (typeof expression === 'string' && expression.trim()) {
        result[emotion] = expression.trim();
      }
    }
  }

  return result;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function resolveLive2DAvatar(input: {
  modelAbsolutePath: string;
  modelUrl: string;
  persona: PersonaRuntime | null;
  explicitMap?: unknown;
}): Promise<PresenceLive2DAvatar> {
  const cubism = isCubism4Model(input.modelAbsolutePath) ? 4 : 2;
  const expressionNames = await readExpressionNames(input.modelAbsolutePath, cubism);
  const personaMap = normalizeEmotionMap(input.persona?.pack.character.avatar?.expressions);
  const explicitMap = normalizeEmotionMap(input.explicitMap);
  const inferred = inferExpressionMap(expressionNames);
  const expressionMap: Partial<Record<PresenceEmotion, string | null>> = {};

  for (const emotion of EMOTIONS) {
    const value = explicitMap[emotion] ?? personaMap[emotion] ?? inferred[emotion] ?? null;

    if (value && expressionNames.length > 0 && !expressionNames.includes(value)) {
      // A stale mapping must never break the face. Fall back to the model's
      // own inferred expression, and finally to no expression.
      expressionMap[emotion] = inferred[emotion] ?? null;
    } else {
      expressionMap[emotion] = value;
    }
  }

  return {
    kind: 'live2d',
    modelUrl: input.modelUrl,
    coreUrl: null,
    cubism,
    expressionMap,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

function personaEntryCandidates(entry: string) {
  const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '');
  const withoutAssets = normalized.replace(/^assets\//, '');

  return [...new Set([
    normalized,
    withoutAssets,
    `avatars/${path.posix.basename(path.posix.dirname(normalized))}/${path.posix.basename(normalized)}`,
  ])];
}

export async function resolveDesktopPresence(input: ResolvePresenceInput): Promise<DesktopPresenceState> {
  const character = input.repos.characters.get(input.characterId);
  const personaCharacter = input.persona?.pack.character;
  const characterName = character?.name ?? personaCharacter?.name ?? '此间';
  const nickname = character?.nickname ?? personaCharacter?.nickname ?? null;
  const assetRoots = resolveAssetRoots(input.dataDir);
  const coreUrl = input.coreUrl?.replace(/\/+$/, '') || null;
  const profile = input.repos.presentationProfiles.get(input.characterId);
  const charactersAssets = input.repos.assets.list({ characterId: input.characterId });
  let avatar: PresenceAvatar | null = null;
  let notice: string | null = coreUrl ? null : '本地服务未启动，桌面形象暂不可用。';

  const explicitDynamic = profile?.dynamicAssetId
    ? input.repos.assets.get(profile.dynamicAssetId)
    : null;
  const explicitSource = explicitDynamic?.metadata?.source;
  // Assets imported through the new single-character flow are explicit user
  // overrides. Older assets (for example the Shizuku test model from the
  // video-call architecture) do not carry this marker and must not hide the
  // persona's own Live2D model.
  const isUserOverride = explicitSource === 'user';

  const resolveDynamicAsset = async (asset: typeof charactersAssets[number]): Promise<PresenceAvatar | null> => {
    if (asset.kind !== 'live2d' && asset.kind !== 'video') {
      return null;
    }

    const url = assetUrl(coreUrl, asset.relativePath);

    if (!url) {
      return null;
    }

    if (asset.kind === 'video') {
      return { kind: 'video', src: url, label: asset.label ?? undefined };
    }

    const absolutePath = path.join(input.dataDir, asset.relativePath);

    try {
      const live2d = await resolveLive2DAvatar({
        modelAbsolutePath: absolutePath,
        modelUrl: url,
        persona: input.persona,
        explicitMap: asset.metadata?.emotionMap,
      });

      return {
        ...live2d,
        coreUrl: `${coreUrl}/assets/live2d/core${live2d.cubism === 4 ? '4' : ''}/live2d${live2d.cubism === 4 ? 'cubismcore' : ''}.min.js`,
        scale: numberOr(asset.metadata?.scale, live2d.scale),
        offsetX: numberOr(asset.metadata?.offsetX, live2d.offsetX),
        offsetY: numberOr(asset.metadata?.offsetY, live2d.offsetY),
        label: asset.label ?? undefined,
      };
    } catch {
      return null;
    }
  };

  if (isUserOverride && explicitDynamic) {
    avatar = await resolveDynamicAsset(explicitDynamic);
  }

  if (!avatar && personaCharacter?.avatar?.type === 'live2d' && input.persona) {
    const entry = personaCharacter.avatar.entry;
    const found = findExistingAsset(assetRoots, personaEntryCandidates(entry));

    if (found && isLive2DModel(found.absolutePath) && coreUrl) {
      const live2d = await resolveLive2DAvatar({
        modelAbsolutePath: found.absolutePath,
        modelUrl: assetUrl(coreUrl, found.relativePath) as string,
        persona: input.persona,
      });
      avatar = {
        ...live2d,
        coreUrl: `${coreUrl}/assets/live2d/core${live2d.cubism === 4 ? '4' : ''}/live2d${live2d.cubism === 4 ? 'cubismcore' : ''}.min.js`,
      };
    } else {
      notice = `未找到角色形象文件：${path.basename(entry)}`;
    }
  }

  if (!avatar && personaCharacter?.avatar?.type === 'video' && input.persona) {
    const found = findExistingAsset(assetRoots, personaEntryCandidates(personaCharacter.avatar.entry));

    if (found && coreUrl) {
      avatar = {
        kind: 'video',
        src: assetUrl(coreUrl, found.relativePath) as string,
      };
    }
  }

  if (!avatar) {
    const candidates = [
      explicitDynamic,
      ...charactersAssets.filter(asset => asset.kind === 'live2d' || asset.kind === 'video'),
    ].filter((asset): asset is typeof charactersAssets[number] => Boolean(asset));

    for (const asset of candidates) {
      avatar = await resolveDynamicAsset(asset);

      if (avatar) {
        break;
      }
    }
  }

  const avatarAsset = character?.avatarAssetId
    ? input.repos.assets.get(character.avatarAssetId)
    : null;
  const avatarSrc = avatarAsset ? assetUrl(coreUrl, avatarAsset.relativePath) : null;

  if (!avatar && avatarSrc) {
    avatar = { kind: 'image', src: avatarSrc, label: avatarAsset?.label ?? undefined };
  }

  if (!avatar && !notice) {
    notice = input.persona
      ? '角色形象尚未就绪，可在角色资料里导入 Live2D。'
      : '没有找到人格设定，暂时无法启动桌面形象。';
  }

  return {
    character: {
      id: input.characterId,
      name: characterName,
      nickname,
      relation: personaCharacter?.relationshipFrame ?? null,
      avatarSrc,
    },
    avatar,
    emotion: lastAssistantEmotion(input.repos, input.characterId),
    online: true,
    hosting: input.hosting,
    mainWindowVisible: input.mainWindowVisible,
    updatedAt: new Date().toISOString(),
    notice,
  };
}
