import type { AssetRecord, CallViewMode, CharacterPresentationProfile, PresentationEmotion } from '../phase2/types';

export const PRESENTATION_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'shy', 'excited', 'worried', 'playful', 'serious'] as const;

const PRESENTATION_EMOTION_SET = new Set<string>(PRESENTATION_EMOTIONS);
const SUPPORTED_STANDING_ART_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export type DynamicAvatarSource =
  | { kind: 'video'; assetId: string; src: string; label?: string }
  | { kind: 'live2d'; assetId: string; entry: string; label?: string };

export function normalizePresentationEmotion(value: unknown): PresentationEmotion {
  if (typeof value !== 'string') {
    return 'neutral';
  }

  const normalized = value.trim().toLowerCase();
  return PRESENTATION_EMOTION_SET.has(normalized) ? normalized as PresentationEmotion : 'neutral';
}

export function resolveCallViewMode(mode: CallViewMode): 'windowed' | 'mini' {
  if (mode === 'pip') {
    return 'mini';
  }

  return mode === 'mini' ? 'mini' : 'windowed';
}

export function isSupportedStandingArtMime(mimeType: string) {
  return SUPPORTED_STANDING_ART_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

function assetEmotion(asset: AssetRecord) {
  return normalizePresentationEmotion(asset.metadata?.emotion);
}

function assetPriority(asset: AssetRecord) {
  const priority = asset.metadata?.priority;
  return typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;
}

function highestPriority(assets: AssetRecord[]) {
  return assets.reduce<AssetRecord | null>((best, asset) => {
    if (!best || assetPriority(asset) > assetPriority(best)) {
      return asset;
    }

    return best;
  }, null);
}

function findExpressionById(assets: AssetRecord[], assetId?: string | null) {
  if (!assetId) {
    return null;
  }

  return assets.find(asset => asset.id === assetId && asset.kind === 'expression') ?? null;
}

function mappedProfileAsset(
  assets: AssetRecord[],
  profile: CharacterPresentationProfile | undefined,
  emotion: PresentationEmotion,
) {
  return findExpressionById(assets, profile?.emotionAssetMap?.[emotion]);
}

export function selectExpressionAsset(input: {
  emotion?: string | null;
  assets: AssetRecord[];
  fallbackAssetId?: string | null;
  profile?: CharacterPresentationProfile;
}): AssetRecord | null {
  const expressionAssets = input.assets.filter(asset => asset.kind === 'expression');
  const emotion = normalizePresentationEmotion(input.emotion);
  const mappedExact = mappedProfileAsset(expressionAssets, input.profile, emotion);

  if (mappedExact) {
    return mappedExact;
  }

  const exact = highestPriority(expressionAssets.filter(asset => assetEmotion(asset) === emotion));

  if (exact) {
    return exact;
  }

  if (input.profile) {
    const fallbackEmotion = normalizePresentationEmotion(input.profile.fallbackEmotion);
    const mappedFallback = mappedProfileAsset(expressionAssets, input.profile, fallbackEmotion);

    if (mappedFallback) {
      return mappedFallback;
    }

    const fallbackByEmotion = highestPriority(expressionAssets.filter(asset => assetEmotion(asset) === fallbackEmotion));

    if (fallbackByEmotion) {
      return fallbackByEmotion;
    }

    const defaultAsset = findExpressionById(expressionAssets, input.profile.defaultAssetId);

    if (defaultAsset) {
      return defaultAsset;
    }
  }

  const neutral = highestPriority(expressionAssets.filter(asset => assetEmotion(asset) === 'neutral'));

  if (neutral) {
    return neutral;
  }

  if (input.fallbackAssetId) {
    const fallback = expressionAssets.find(asset => asset.id === input.fallbackAssetId);

    if (fallback) {
      return fallback;
    }
  }

  return expressionAssets[0] ?? null;
}

function dynamicKind(asset: AssetRecord): 'video' | 'live2d' | null {
  if (asset.kind === 'video' || asset.metadata?.renderer === 'video') {
    return 'video';
  }

  if (asset.kind === 'live2d' || asset.metadata?.renderer === 'live2d') {
    return 'live2d';
  }

  return null;
}

function toDynamicSource(asset: AssetRecord, assetDataUrls: Record<string, string>): DynamicAvatarSource | null {
  const kind = dynamicKind(asset);
  const label = asset.label ?? undefined;

  if (kind === 'video') {
    const src = assetDataUrls[asset.id];
    return src ? { kind: 'video', assetId: asset.id, src, label } : null;
  }

  if (kind === 'live2d') {
    return { kind: 'live2d', assetId: asset.id, entry: asset.relativePath, label };
  }

  return null;
}

export function selectDynamicAvatarSource(input: {
  assets: AssetRecord[];
  assetDataUrls: Record<string, string>;
  profile?: CharacterPresentationProfile;
}): DynamicAvatarSource | null {
  const renderer = input.profile?.preferredRenderer ?? 'auto';

  if (renderer === 'static') {
    return null;
  }

  const dynamicAssets = input.assets.filter(asset => asset.kind === 'video' || asset.kind === 'live2d');
  const explicitAsset = input.profile?.dynamicAssetId
    ? dynamicAssets.find(asset => asset.id === input.profile?.dynamicAssetId)
    : undefined;

  if (explicitAsset) {
    const source = toDynamicSource(explicitAsset, input.assetDataUrls);

    if (source && (renderer === 'auto' || renderer === source.kind)) {
      return source;
    }
  }

  if (renderer === 'video' || renderer === 'live2d') {
    for (const asset of dynamicAssets) {
      if (dynamicKind(asset) !== renderer) {
        continue;
      }

      const source = toDynamicSource(asset, input.assetDataUrls);

      if (source) {
        return source;
      }
    }

    return null;
  }

  for (const asset of dynamicAssets) {
    const source = toDynamicSource(asset, input.assetDataUrls);

    if (source) {
      return source;
    }
  }

  return null;
}
