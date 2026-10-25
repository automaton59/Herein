import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { createPhase2Repositories } from './data/repositories';

type Repositories = ReturnType<typeof createPhase2Repositories>;

const ASSET_KINDS = new Set(['avatar', 'expression', 'live2d', 'video', 'other']);
const RENDERERS = new Set(['auto', 'static', 'video', 'live2d']);

export interface LocalAsset {
  id: string;
  characterId?: string | null;
  kind: 'avatar' | 'expression' | 'live2d' | 'video' | 'other';
  relativePath: string;
  mimeType?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LocalPresentation {
  preferredRenderer?: 'auto' | 'static' | 'video' | 'live2d';
  dynamicAssetId?: string | null;
  defaultAssetId?: string | null;
  fallbackEmotion?: string;
  emotionAssetMap?: Record<string, string>;
}

export interface LocalContentManifest {
  schemaVersion?: number;
  assets?: LocalAsset[];
  presentation?: Record<string, LocalPresentation>;
}

export function resolveLocalContentPath() {
  return path.resolve(
    process.env.HEREIN_LOCAL_CONTENT
      ?? path.join(process.cwd(), 'private', 'local-content.json'),
  );
}

function isSafeRelativePath(value: string) {
  if (!value || path.isAbsolute(value)) {
    return false;
  }

  const normalized = value.replace(/\\/g, '/');

  return normalized.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateAsset(raw: unknown): LocalAsset | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const relativePath = typeof raw.relativePath === 'string' ? raw.relativePath.trim() : '';
  const kind = typeof raw.kind === 'string' ? raw.kind : '';

  if (!id || !isSafeRelativePath(relativePath) || !ASSET_KINDS.has(kind)) {
    return null;
  }

  return {
    id,
    characterId: typeof raw.characterId === 'string' ? raw.characterId : null,
    kind: kind as LocalAsset['kind'],
    relativePath,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : null,
    label: typeof raw.label === 'string' ? raw.label : null,
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };
}

export async function loadLocalContent(): Promise<LocalContentManifest | null> {
  const filePath = resolveLocalContentPath();
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(raw)) {
    return null;
  }

  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(validateAsset).filter((asset): asset is LocalAsset => asset !== null)
    : [];
  const presentation: Record<string, LocalPresentation> = {};

  if (isRecord(raw.presentation)) {
    for (const [characterId, value] of Object.entries(raw.presentation)) {
      if (!isRecord(value)) {
        continue;
      }

      const preferredRenderer = typeof value.preferredRenderer === 'string'
        && RENDERERS.has(value.preferredRenderer)
        ? value.preferredRenderer as LocalPresentation['preferredRenderer']
        : undefined;

      presentation[characterId] = {
        preferredRenderer,
        dynamicAssetId: typeof value.dynamicAssetId === 'string' ? value.dynamicAssetId : null,
        defaultAssetId: typeof value.defaultAssetId === 'string' ? value.defaultAssetId : null,
        fallbackEmotion: typeof value.fallbackEmotion === 'string' ? value.fallbackEmotion : undefined,
        emotionAssetMap: isRecord(value.emotionAssetMap)
          ? Object.fromEntries(
            Object.entries(value.emotionAssetMap)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          )
          : undefined,
      };
    }
  }

  return { schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1, assets, presentation };
}

/**
 * Seed local presentation assets without hardcoding a character or model in
 * public code. Existing user choices are preserved: a profile is only seeded
 * while it still looks untouched.
 */
export function applyLocalContent(repos: Repositories, manifest: LocalContentManifest) {
  let assets = 0;
  let presentations = 0;

  for (const asset of manifest.assets ?? []) {
    if (asset.characterId && !repos.characters.get(asset.characterId)) {
      continue;
    }

    repos.assets.create({
      ...asset,
      characterId: asset.characterId ?? null,
      metadata: asset.metadata ?? {},
    });
    assets += 1;
  }

  for (const [characterId, presentation] of Object.entries(manifest.presentation ?? {})) {
    if (!repos.characters.get(characterId)) {
      continue;
    }

    const current = repos.presentationProfiles.get(characterId);
    const isPristine = !current.dynamicAssetId
      && (current.preferredRenderer ?? 'auto') === 'auto'
      && Object.keys(current.emotionAssetMap ?? {}).length === 0;

    if (!isPristine) {
      continue;
    }

    repos.presentationProfiles.upsert({
      ...current,
      characterId,
      ...presentation,
      emotionAssetMap: {
        ...(current.emotionAssetMap ?? {}),
        ...(presentation.emotionAssetMap ?? {}),
      },
      fallbackEmotion: (presentation.fallbackEmotion as typeof current.fallbackEmotion | undefined)
        ?? current.fallbackEmotion,
    });
    presentations += 1;
  }

  return { assets, presentations };
}
