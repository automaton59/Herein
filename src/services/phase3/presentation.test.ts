import { describe, expect, it } from 'vitest';
import type { AssetRecord, CharacterPresentationProfile } from '../phase2/types';
import {
  isSupportedStandingArtMime,
  normalizePresentationEmotion,
  resolveCallViewMode,
  selectExpressionAsset,
  selectDynamicAvatarSource,
} from './presentation';

function expressionAsset(input: {
  id: string;
  emotion?: string;
  priority?: number;
  relativePath?: string;
}): AssetRecord {
  return {
    id: input.id,
    characterId: 'char-1',
    kind: 'expression',
    relativePath: input.relativePath ?? `assets/char-1/${input.id}.png`,
    mimeType: 'image/png',
    metadata: {
      emotion: input.emotion,
      priority: input.priority,
    },
  };
}

function dynamicAsset(input: {
  id: string;
  kind: 'video' | 'live2d';
  relativePath?: string;
}): AssetRecord {
  return {
    id: input.id,
    characterId: 'char-1',
    kind: input.kind,
    relativePath: input.relativePath ?? `assets/char-1/${input.id}`,
    mimeType: input.kind === 'video' ? 'video/webm' : 'application/json',
    metadata: { renderer: input.kind },
  };
}

describe('phase3 presentation helpers', () => {
  it('normalizes presentation emotions and call modes to supported fallbacks', () => {
    expect(normalizePresentationEmotion('happy')).toBe('happy');
    expect(normalizePresentationEmotion('unknown')).toBe('neutral');
    expect(normalizePresentationEmotion(null)).toBe('neutral');
    expect(resolveCallViewMode('fullscreen')).toBe('windowed');
    expect(resolveCallViewMode('pip')).toBe('mini');
    expect(resolveCallViewMode('windowed')).toBe('windowed');
  });

  it('accepts first-phase static standing art formats only', () => {
    expect(isSupportedStandingArtMime('image/png')).toBe(true);
    expect(isSupportedStandingArtMime('image/jpeg')).toBe(true);
    expect(isSupportedStandingArtMime('image/webp')).toBe(true);
    expect(isSupportedStandingArtMime('image/gif')).toBe(false);
    expect(isSupportedStandingArtMime('application/octet-stream')).toBe(false);
  });

  it('selects expression assets by emotion, priority, and fallback order', () => {
    const assets = [
      expressionAsset({ id: 'neutral', emotion: 'neutral', priority: 1 }),
      expressionAsset({ id: 'happy-low', emotion: 'happy', priority: 1 }),
      expressionAsset({ id: 'happy-high', emotion: 'happy', priority: 10 }),
      expressionAsset({ id: 'fallback', emotion: 'sad', priority: 1 }),
    ];

    expect(selectExpressionAsset({ emotion: 'happy', assets })?.id).toBe('happy-high');
    expect(selectExpressionAsset({ emotion: 'worried', assets })?.id).toBe('neutral');
    expect(selectExpressionAsset({
      emotion: 'angry',
      assets: assets.filter(asset => asset.id !== 'neutral'),
      fallbackAssetId: 'fallback',
    })?.id).toBe('fallback');
    expect(selectExpressionAsset({ emotion: 'angry', assets: [expressionAsset({ id: 'first' })] })?.id).toBe('first');
    expect(selectExpressionAsset({ emotion: 'angry', assets: [] })).toBeNull();
  });

  it('uses presentation profile mappings before automatic metadata fallback', () => {
    const profile: CharacterPresentationProfile = {
      characterId: 'char-1',
      defaultAssetId: 'default',
      fallbackEmotion: 'worried',
      emotionAssetMap: {
        happy: 'happy-manual',
        worried: 'worried-manual',
      },
    };
    const assets = [
      expressionAsset({ id: 'neutral', emotion: 'neutral', priority: 100 }),
      expressionAsset({ id: 'happy-auto', emotion: 'happy', priority: 50 }),
      expressionAsset({ id: 'happy-manual', emotion: 'happy', priority: 1 }),
      expressionAsset({ id: 'worried-manual', emotion: 'worried', priority: 1 }),
      expressionAsset({ id: 'default', priority: 0 }),
    ];

    expect(selectExpressionAsset({ emotion: 'happy', assets, profile })?.id).toBe('happy-manual');
    expect(selectExpressionAsset({ emotion: 'angry', assets, profile })?.id).toBe('worried-manual');
    expect(selectExpressionAsset({
      emotion: 'sad',
      assets: assets.filter(asset => !['worried-manual', 'neutral'].includes(asset.id)),
      profile,
    })?.id).toBe('default');
    expect(selectExpressionAsset({
      emotion: 'happy',
      assets: assets.filter(asset => asset.id !== 'happy-manual'),
      profile,
    })?.id).toBe('happy-auto');
  });

  it('selects dynamic avatar sources by profile preference and available data urls', () => {
    const assets = [
      dynamicAsset({ id: 'video-1', kind: 'video' }),
      dynamicAsset({ id: 'live2d-1', kind: 'live2d', relativePath: 'assets/char-1/live2d-1/model.model3.json' }),
    ];

    expect(selectDynamicAvatarSource({
      assets,
      assetDataUrls: { 'video-1': 'data:video/webm;base64,abc' },
      profile: {
        characterId: 'char-1',
        defaultAssetId: null,
        dynamicAssetId: 'video-1',
        emotionAssetMap: {},
        fallbackEmotion: 'neutral',
        preferredRenderer: 'video',
      },
    })).toEqual({
      kind: 'video',
      assetId: 'video-1',
      src: 'data:video/webm;base64,abc',
      label: undefined,
    });

    expect(selectDynamicAvatarSource({
      assets,
      assetDataUrls: {},
      profile: {
        characterId: 'char-1',
        defaultAssetId: null,
        dynamicAssetId: 'live2d-1',
        emotionAssetMap: {},
        fallbackEmotion: 'neutral',
        preferredRenderer: 'live2d',
      },
    })).toEqual({
      kind: 'live2d',
      assetId: 'live2d-1',
      entry: 'assets/char-1/live2d-1/model.model3.json',
      label: undefined,
    });

    expect(selectDynamicAvatarSource({
      assets,
      assetDataUrls: { 'video-1': 'data:video/webm;base64,abc' },
      profile: {
        characterId: 'char-1',
        defaultAssetId: null,
        dynamicAssetId: null,
        emotionAssetMap: {},
        fallbackEmotion: 'neutral',
        preferredRenderer: 'auto',
      },
    })?.assetId).toBe('video-1');

    expect(selectDynamicAvatarSource({
      assets,
      assetDataUrls: { 'video-1': 'data:video/webm;base64,abc' },
      profile: {
        characterId: 'char-1',
        defaultAssetId: null,
        dynamicAssetId: 'video-1',
        emotionAssetMap: {},
        fallbackEmotion: 'neutral',
        preferredRenderer: 'static',
      },
    })).toBeNull();
  });
});
