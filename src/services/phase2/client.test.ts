import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhase2Client } from './client';

const originalElectron = window.electron;

afterEach(() => {
  vi.restoreAllMocks();
  window.electron = originalElectron;
});

describe('createPhase2Client', () => {
  it('reports Phase 2 storage as unsupported outside Electron', async () => {
    window.electron = undefined;
    const client = createPhase2Client();

    await expect(client.bootstrap()).rejects.toThrow('Phase 2 storage requires the Electron app');
  });

  it('forwards calls to the Electron phase2 preload API', async () => {
    const bootstrap = vi.fn().mockResolvedValue({
      settings: { themeMode: 'dark' },
      profiles: [],
      characters: [],
    });
    const getSetting = vi.fn().mockResolvedValue('dark');
    const importAvatar = vi.fn().mockResolvedValue({ assetId: 'asset-1', relativePath: 'assets/char-1/avatar.png' });
    const importExpression = vi.fn().mockResolvedValue({ assetId: 'asset-happy', relativePath: 'assets/char-1/expression-asset-happy.png' });
    const importVideo = vi.fn().mockResolvedValue({ assetId: 'asset-video', relativePath: 'assets/char-1/video-asset-video.webm' });
    const importLive2D = vi.fn().mockResolvedValue({ assetId: 'asset-live2d', relativePath: 'assets/char-1/live2d-asset-live2d/model.model3.json' });
    const listAssets = vi.fn().mockResolvedValue([{ id: 'asset-happy', kind: 'expression', metadata: { emotion: 'happy' } }]);
    const updateAsset = vi.fn().mockResolvedValue(true);
    const deleteAsset = vi.fn().mockResolvedValue(true);
    const getDataUrl = vi.fn().mockResolvedValue('data:image/png;base64,abc');
    const getPresentationProfile = vi.fn().mockResolvedValue({
      characterId: 'char-1',
      defaultAssetId: 'asset-neutral',
      emotionAssetMap: { happy: 'asset-happy' },
      fallbackEmotion: 'neutral',
    });
    const upsertPresentationProfile = vi.fn().mockResolvedValue(true);

    window.electron = {
      platform: 'win32',
      phase2: {
        bootstrap,
        settings: {
          get: getSetting,
          set: vi.fn(),
        },
        profiles: {
          list: vi.fn(),
          upsert: vi.fn(),
          delete: vi.fn(),
        },
        characters: {
          list: vi.fn(),
          upsert: vi.fn(),
        },
        relationship: {
          get: vi.fn(),
          upsert: vi.fn(),
        },
        timeline: {
          getPrimary: vi.fn(),
          listMessages: vi.fn(),
          appendMessage: vi.fn(),
          syncMessages: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, deleted: 0 }),
          updateMessage: vi.fn(),
          updateTitle: vi.fn(),
          deleteAfter: vi.fn(),
          clearMessages: vi.fn(),
        },
        memory: {
          list: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        summary: {
          get: vi.fn(),
          upsert: vi.fn(),
        },
        assets: {
          importAvatar,
          importExpression,
          importVideo,
          importLive2D,
          list: listAssets,
          update: updateAsset,
          delete: deleteAsset,
          getDataUrl,
        },
        presentation: {
          getProfile: getPresentationProfile,
          upsertProfile: upsertPresentationProfile,
        },
        backup: {
          export: vi.fn(),
          restore: vi.fn(),
        },
        characterArchive: {
          export: vi.fn(),
          import: vi.fn(),
        },
      },
    };

    const client = createPhase2Client();

    await expect(client.bootstrap()).resolves.toEqual({
      settings: { themeMode: 'dark' },
      profiles: [],
      characters: [],
    });
    await expect(client.settings.get('themeMode', 'system')).resolves.toBe('dark');
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    await expect(client.assets.importAvatar('char-1', file)).resolves.toEqual({
      assetId: 'asset-1',
      relativePath: 'assets/char-1/avatar.png',
    });
    await expect(client.assets.getDataUrl('asset-1')).resolves.toBe('data:image/png;base64,abc');
    await expect(client.assets.importExpression('char-1', file, { emotion: 'happy', label: '开心' })).resolves.toEqual({
      assetId: 'asset-happy',
      relativePath: 'assets/char-1/expression-asset-happy.png',
    });
    const videoFile = new File(['video'], 'idle.webm', { type: 'video/webm' });
    await expect(client.assets.importVideo('char-1', videoFile, { label: '待机循环' })).resolves.toEqual({
      assetId: 'asset-video',
      relativePath: 'assets/char-1/video-asset-video.webm',
    });
    const live2dFile = new File(['{}'], 'model.model3.json', { type: 'application/json' });
    await expect(client.assets.importLive2D('char-1', live2dFile, { label: 'Live2D', entry: 'model.model3.json' })).resolves.toEqual({
      assetId: 'asset-live2d',
      relativePath: 'assets/char-1/live2d-asset-live2d/model.model3.json',
    });
    await expect(client.assets.list({ characterId: 'char-1', kind: 'expression' })).resolves.toEqual([
      expect.objectContaining({ id: 'asset-happy', metadata: { emotion: 'happy' } }),
    ]);
    await expect(client.assets.update('asset-happy', { label: '轻松开心' })).resolves.toBe(true);
    await expect(client.assets.delete('asset-happy')).resolves.toBe(true);
    await expect(client.presentation.getProfile('char-1')).resolves.toEqual({
      characterId: 'char-1',
      defaultAssetId: 'asset-neutral',
      emotionAssetMap: { happy: 'asset-happy' },
      fallbackEmotion: 'neutral',
    });
    await expect(client.presentation.upsertProfile({
      characterId: 'char-1',
      defaultAssetId: 'asset-neutral',
      emotionAssetMap: { happy: 'asset-happy' },
      fallbackEmotion: 'neutral',
    })).resolves.toBe(true);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(getSetting).toHaveBeenCalledWith('themeMode', 'system');
    expect(importAvatar).toHaveBeenCalledWith('char-1', file);
    expect(importExpression).toHaveBeenCalledWith('char-1', file, { emotion: 'happy', label: '开心' });
    expect(importVideo).toHaveBeenCalledWith('char-1', videoFile, { label: '待机循环' });
    expect(importLive2D).toHaveBeenCalledWith('char-1', live2dFile, { label: 'Live2D', entry: 'model.model3.json' });
    expect(listAssets).toHaveBeenCalledWith({ characterId: 'char-1', kind: 'expression' });
    expect(updateAsset).toHaveBeenCalledWith('asset-happy', { label: '轻松开心' });
    expect(deleteAsset).toHaveBeenCalledWith('asset-happy');
    expect(getDataUrl).toHaveBeenCalledWith('asset-1');
    expect(getPresentationProfile).toHaveBeenCalledWith('char-1');
    expect(upsertPresentationProfile).toHaveBeenCalledWith({
      characterId: 'char-1',
      defaultAssetId: 'asset-neutral',
      emotionAssetMap: { happy: 'asset-happy' },
      fallbackEmotion: 'neutral',
    });
  });
});
