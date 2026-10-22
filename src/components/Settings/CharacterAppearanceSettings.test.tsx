import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssetRecord, CharacterPresentationProfile } from '../../services/phase2/types';
import { CharacterAppearanceSettings } from './CharacterAppearanceSettings';

const assets: AssetRecord[] = [
  {
    id: 'asset-neutral',
    characterId: 'char-1',
    kind: 'expression',
    relativePath: 'assets/char-1/expression-neutral.png',
    mimeType: 'image/png',
    label: '默认',
    metadata: { emotion: 'neutral', priority: 100 },
  },
  {
    id: 'asset-happy',
    characterId: 'char-1',
    kind: 'expression',
    relativePath: 'assets/char-1/expression-happy.png',
    mimeType: 'image/png',
    label: '开心',
    metadata: { emotion: 'happy', expressionKey: 'happy-main', priority: 10 },
  },
];

const dynamicAssets: AssetRecord[] = [
  {
    id: 'video-idle',
    characterId: 'char-1',
    kind: 'video',
    relativePath: 'assets/char-1/video-idle.mp4',
    mimeType: 'video/mp4',
    label: '待机循环',
    metadata: { renderer: 'video' },
  },
  {
    id: 'live2d-main',
    characterId: 'char-1',
    kind: 'live2d',
    relativePath: 'assets/char-1/live2d-main/model.model3.json',
    mimeType: 'application/json',
    label: 'Live2D 主模型',
    metadata: { renderer: 'live2d', entry: 'model.model3.json' },
  },
];

const profile: CharacterPresentationProfile = {
  characterId: 'char-1',
  defaultAssetId: 'asset-neutral',
  dynamicAssetId: 'video-idle',
  emotionAssetMap: { happy: 'asset-happy' },
  fallbackEmotion: 'neutral',
  preferredRenderer: 'video',
};

describe('CharacterAppearanceSettings', () => {
  it('imports and lists expression standing art assets', async () => {
    const onImportExpression = vi.fn().mockResolvedValue(undefined);
    const onDeleteAsset = vi.fn().mockResolvedValue(undefined);
    const onUpdateAsset = vi.fn().mockResolvedValue(undefined);
    const onUpdateProfile = vi.fn().mockResolvedValue(undefined);

    render(
      <CharacterAppearanceSettings
        assets={assets}
        assetDataUrls={{ 'asset-happy': 'data:image/png;base64,abc' }}
        profile={profile}
        onImportExpression={onImportExpression}
        onDeleteAsset={onDeleteAsset}
        onUpdateAsset={onUpdateAsset}
        onUpdateProfile={onUpdateProfile}
      />,
    );

    expect(screen.getByText('形象与表情')).toBeInTheDocument();
    expect(screen.getAllByText('默认立绘').length).toBeGreaterThan(0);
    expect(screen.getByText('差分立绘')).toBeInTheDocument();

    const happyAsset = screen.getByLabelText('表情资产：开心');
    expect(within(happyAsset).getAllByText('开心').length).toBeGreaterThan(0);
    expect(within(happyAsset).getByRole('img', { name: '开心预览' })).toHaveAttribute('src', 'data:image/png;base64,abc');

    fireEvent.click(screen.getByRole('button', { name: '选择表情：开心' }));
    fireEvent.change(screen.getByLabelText('素材名称'), {
      target: { value: '轻松开心' },
    });
    const file = new File(['image'], 'happy.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传立绘文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onImportExpression).toHaveBeenCalledWith(file, 'happy', '轻松开心');
    });

    fireEvent.click(within(happyAsset).getByRole('button', { name: '删除 开心' }));

    await waitFor(() => {
      expect(onDeleteAsset).toHaveBeenCalledWith('asset-happy');
    });
  });

  it('saves presentation profile and expression asset metadata edits', async () => {
    const onUpdateAsset = vi.fn().mockResolvedValue(undefined);
    const onUpdateProfile = vi.fn().mockResolvedValue(undefined);

    render(
      <CharacterAppearanceSettings
        assets={assets}
        assetDataUrls={{}}
        profile={profile}
        onImportExpression={vi.fn()}
        onDeleteAsset={vi.fn()}
        onUpdateAsset={onUpdateAsset}
        onUpdateProfile={onUpdateProfile}
      />,
    );

    fireEvent.change(screen.getByLabelText('默认立绘'), {
      target: { value: 'asset-happy' },
    });

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith({
        ...profile,
        defaultAssetId: 'asset-happy',
      });
    });

    fireEvent.change(screen.getByLabelText('回退情绪'), {
      target: { value: 'worried' },
    });

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith({
        ...profile,
        fallbackEmotion: 'worried',
      });
    });

    const happyAsset = screen.getByLabelText('表情资产：开心');
    fireEvent.change(within(happyAsset).getByLabelText('编辑 开心 名称'), {
      target: { value: '微笑' },
    });
    fireEvent.change(within(happyAsset).getByLabelText('设置 开心 情绪'), {
      target: { value: 'worried' },
    });
    fireEvent.change(within(happyAsset).getByLabelText('设置 开心 优先级'), {
      target: { value: '25' },
    });
    fireEvent.click(within(happyAsset).getByRole('button', { name: '保存 开心' }));

    await waitFor(() => {
      expect(onUpdateAsset).toHaveBeenCalledWith('asset-happy', {
        label: '微笑',
        metadata: {
          emotion: 'worried',
          expressionKey: 'happy-main',
          priority: 25,
        },
      });
    });

    fireEvent.click(within(happyAsset).getByRole('button', { name: '将 开心 设为担心表情' }));

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith({
        ...profile,
        emotionAssetMap: {
          happy: 'asset-happy',
          worried: 'asset-happy',
        },
      });
    });
  });

  it('imports, selects, and deletes dynamic avatar assets', async () => {
    const onImportVideo = vi.fn().mockResolvedValue(undefined);
    const onImportLive2D = vi.fn().mockResolvedValue(undefined);
    const onDeleteAsset = vi.fn().mockResolvedValue(undefined);
    const onUpdateProfile = vi.fn().mockResolvedValue(undefined);

    render(
      <CharacterAppearanceSettings
        assets={assets}
        assetDataUrls={{}}
        dynamicAssets={dynamicAssets}
        dynamicAssetDataUrls={{ 'video-idle': 'data:video/mp4;base64,loop' }}
        profile={profile}
        onImportExpression={vi.fn()}
        onImportVideo={onImportVideo}
        onImportLive2D={onImportLive2D}
        onDeleteAsset={onDeleteAsset}
        onUpdateAsset={vi.fn()}
        onUpdateProfile={onUpdateProfile}
      />,
    );

    expect(screen.getByLabelText('动态形象')).toHaveValue('video-idle');
    expect(screen.getByLabelText('渲染偏好')).toHaveValue('video');
    expect(screen.getByText('待机循环')).toBeInTheDocument();
    expect(screen.getByLabelText('待机循环预览')).toHaveAttribute('src', 'data:video/mp4;base64,loop');

    fireEvent.change(screen.getByLabelText('动态素材名称'), {
      target: { value: '夜间循环' },
    });
    const videoFile = new File(['video'], 'idle.webm', { type: 'video/webm' });
    fireEvent.change(screen.getByLabelText('上传视频动态形象文件'), {
      target: { files: [videoFile] },
    });

    await waitFor(() => {
      expect(onImportVideo).toHaveBeenCalledWith(videoFile, '夜间循环');
    });

    const live2dFile = new File(['{}'], 'model.model3.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('导入 Live2D 模型文件'), {
      target: { files: [live2dFile] },
    });

    await waitFor(() => {
      expect(onImportLive2D).toHaveBeenCalledWith(live2dFile, 'Live2D 模型');
    });

    fireEvent.change(screen.getByLabelText('动态形象'), {
      target: { value: 'live2d-main' },
    });

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith({
        ...profile,
        dynamicAssetId: 'live2d-main',
      });
    });

    fireEvent.change(screen.getByLabelText('渲染偏好'), {
      target: { value: 'static' },
    });

    await waitFor(() => {
      expect(onUpdateProfile).toHaveBeenCalledWith({
        ...profile,
        preferredRenderer: 'static',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '删除 待机循环' }));

    await waitFor(() => {
      expect(onDeleteAsset).toHaveBeenCalledWith('video-idle');
      expect(onUpdateProfile).toHaveBeenCalledWith({
        ...profile,
        dynamicAssetId: null,
      });
    });
  });
});
