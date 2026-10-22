import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Box, Check, ImagePlus, Trash2, Video } from 'lucide-react';
import type { AssetRecord, CharacterPresentationProfile, PresentationEmotion, PresentationRenderer } from '../../services/phase2/types';
import { isSupportedStandingArtMime, PRESENTATION_EMOTIONS } from '../../services/phase3/presentation';

const EMOTION_LABELS: Record<PresentationEmotion, string> = {
  neutral: '默认',
  happy: '开心',
  sad: '低落',
  angry: '生气',
  shy: '害羞',
  excited: '兴奋',
  worried: '担心',
  playful: '俏皮',
  serious: '认真',
};

const RENDERER_LABELS: Record<PresentationRenderer, string> = {
  auto: '自动',
  static: '静态立绘',
  video: '视频',
  live2d: 'Live2D',
};

interface CharacterAppearanceSettingsProps {
  assets: AssetRecord[];
  assetDataUrls: Record<string, string>;
  dynamicAssets?: AssetRecord[];
  dynamicAssetDataUrls?: Record<string, string>;
  profile: CharacterPresentationProfile;
  onImportExpression: (file: File, emotion: PresentationEmotion, label: string) => Promise<void>;
  onImportVideo?: (file: File, label: string) => Promise<void>;
  onImportLive2D?: (file: File, label: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onUpdateAsset: (assetId: string, patch: Partial<AssetRecord>) => Promise<void>;
  onUpdateProfile: (profile: CharacterPresentationProfile) => Promise<void>;
}

function assetEmotion(asset: AssetRecord): PresentationEmotion {
  const emotion = asset.metadata?.emotion;
  return typeof emotion === 'string' && emotion in EMOTION_LABELS ? emotion as PresentationEmotion : 'neutral';
}

function assetPriority(asset: AssetRecord) {
  const priority = asset.metadata?.priority;
  return typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;
}

function dynamicAssetKindLabel(asset: AssetRecord) {
  return asset.kind === 'live2d' ? 'Live2D' : '视频';
}

function isSupportedVideoFile(file: File) {
  if (file.type.startsWith('video/')) {
    return true;
  }

  return /\.(mp4|webm|ogg|ogv)$/i.test(file.name);
}

function isSupportedLive2DFile(file: File) {
  return /\.model3\.json$/i.test(file.name);
}

interface AssetDraft {
  label: string;
  emotion: PresentationEmotion;
  priority: string;
}

export function CharacterAppearanceSettings({
  assets,
  assetDataUrls,
  dynamicAssets = [],
  dynamicAssetDataUrls = {},
  profile,
  onImportExpression,
  onImportVideo,
  onImportLive2D,
  onDeleteAsset,
  onUpdateAsset,
  onUpdateProfile,
}: CharacterAppearanceSettingsProps) {
  const [selectedEmotion, setSelectedEmotion] = useState<PresentationEmotion>('neutral');
  const [label, setLabel] = useState('');
  const [dynamicLabel, setDynamicLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dynamicError, setDynamicError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDynamicBusy, setIsDynamicBusy] = useState(false);
  const [assetDrafts, setAssetDrafts] = useState<Record<string, AssetDraft>>({});
  const expressionAssets = useMemo(
    () => assets
      .filter(asset => asset.kind === 'expression')
      .sort((a, b) => {
        const emotionOrder = PRESENTATION_EMOTIONS.indexOf(assetEmotion(a)) - PRESENTATION_EMOTIONS.indexOf(assetEmotion(b));
        return emotionOrder || assetPriority(b) - assetPriority(a);
      }),
    [assets],
  );
  const sortedDynamicAssets = useMemo(
    () => dynamicAssets
      .filter(asset => asset.kind === 'video' || asset.kind === 'live2d')
      .sort((a, b) => `${dynamicAssetKindLabel(a)}-${a.label || a.id}`.localeCompare(`${dynamicAssetKindLabel(b)}-${b.label || b.id}`, 'zh-CN')),
    [dynamicAssets],
  );

  useEffect(() => {
    setAssetDrafts(previous => {
      const next: Record<string, AssetDraft> = {};

      for (const asset of expressionAssets) {
        const emotion = assetEmotion(asset);
        next[asset.id] = previous[asset.id] ?? {
          label: asset.label || EMOTION_LABELS[emotion],
          emotion,
          priority: String(assetPriority(asset)),
        };
      }

      return next;
    });
  }, [expressionAssets]);

  const updateProfile = (patch: Partial<CharacterPresentationProfile>) => {
    return onUpdateProfile({
      ...profile,
      characterId: profile.characterId,
      defaultAssetId: profile.defaultAssetId ?? null,
      dynamicAssetId: profile.dynamicAssetId ?? null,
      fallbackEmotion: profile.fallbackEmotion,
      preferredRenderer: profile.preferredRenderer ?? 'auto',
      emotionAssetMap: { ...profile.emotionAssetMap },
      ...patch,
    });
  };

  const setAssetDraft = (assetId: string, patch: Partial<AssetDraft>) => {
    setAssetDrafts(previous => {
      const existing = previous[assetId] ?? {
        label: '',
        emotion: 'neutral',
        priority: '0',
      };

      return {
        ...previous,
        [assetId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const saveAssetDraft = async (asset: AssetRecord) => {
    const emotion = assetEmotion(asset);
    const draft = assetDrafts[asset.id] ?? {
      label: asset.label || EMOTION_LABELS[emotion],
      emotion,
      priority: String(assetPriority(asset)),
    };
    const priority = Number(draft.priority);

    await onUpdateAsset(asset.id, {
      label: draft.label.trim() || EMOTION_LABELS[draft.emotion],
      metadata: {
        ...asset.metadata,
        emotion: draft.emotion,
        priority: Number.isFinite(priority) ? priority : 0,
      },
    });
  };

  const bindAssetToDraftEmotion = (asset: AssetRecord) => {
    const draft = assetDrafts[asset.id];
    const emotion = draft?.emotion ?? assetEmotion(asset);

    updateProfile({
      emotionAssetMap: {
        ...profile.emotionAssetMap,
        [emotion]: asset.id,
      },
    });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (file.type && !isSupportedStandingArtMime(file.type)) {
      setError('第一版立绘支持 png、jpg、jpeg、webp。');
      event.target.value = '';
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      await onImportExpression(file, selectedEmotion, label.trim() || EMOTION_LABELS[selectedEmotion]);
      setLabel('');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '立绘上传失败');
    } finally {
      setIsBusy(false);
      event.target.value = '';
    }
  };

  const handleVideoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!isSupportedVideoFile(file)) {
      setDynamicError('动态视频支持 mp4、webm、ogg。');
      event.target.value = '';
      return;
    }

    setDynamicError(null);
    setIsDynamicBusy(true);

    try {
      await onImportVideo?.(file, dynamicLabel.trim() || '视频动态形象');
      setDynamicLabel('');
    } catch (uploadError) {
      setDynamicError(uploadError instanceof Error ? uploadError.message : '动态视频上传失败');
    } finally {
      setIsDynamicBusy(false);
      event.target.value = '';
    }
  };

  const handleLive2DChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!isSupportedLive2DFile(file)) {
      setDynamicError('Live2D 入口请选择 model3.json 文件。');
      event.target.value = '';
      return;
    }

    setDynamicError(null);
    setIsDynamicBusy(true);

    try {
      await onImportLive2D?.(file, dynamicLabel.trim() || 'Live2D 模型');
      setDynamicLabel('');
    } catch (uploadError) {
      setDynamicError(uploadError instanceof Error ? uploadError.message : 'Live2D 导入失败');
    } finally {
      setIsDynamicBusy(false);
      event.target.value = '';
    }
  };

  const deleteDynamicAsset = async (assetId: string) => {
    await onDeleteAsset(assetId);

    if (profile.dynamicAssetId === assetId) {
      await updateProfile({ dynamicAssetId: null });
    }
  };

  return (
    <section className="mt-5 border-t border-sky-100 pt-5 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-sky-50">形象与表情</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">默认立绘使用 neutral，差分立绘跟随回复情绪切换。</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-sky-100 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
        <label className="grid gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          默认立绘
          <select
            aria-label="默认立绘"
            value={profile.defaultAssetId ?? ''}
            onChange={(event) => updateProfile({ defaultAssetId: event.target.value || null })}
            className="h-9 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50 dark:focus:ring-sky-300/10"
          >
            <option value="">自动选择</option>
            {expressionAssets.map(asset => (
              <option key={asset.id} value={asset.id}>{asset.label || EMOTION_LABELS[assetEmotion(asset)]}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          回退情绪
          <select
            aria-label="回退情绪"
            value={profile.fallbackEmotion}
            onChange={(event) => updateProfile({ fallbackEmotion: event.target.value as PresentationEmotion })}
            className="h-9 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50 dark:focus:ring-sky-300/10"
          >
            {PRESENTATION_EMOTIONS.map(emotion => (
              <option key={emotion} value={emotion}>{EMOTION_LABELS[emotion]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-sky-100 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
        <label className="grid gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          动态形象
          <select
            aria-label="动态形象"
            value={profile.dynamicAssetId ?? ''}
            onChange={(event) => updateProfile({ dynamicAssetId: event.target.value || null })}
            className="h-9 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50 dark:focus:ring-sky-300/10"
          >
            <option value="">未选择</option>
            {sortedDynamicAssets.map(asset => (
              <option key={asset.id} value={asset.id}>
                {asset.label || asset.id} · {dynamicAssetKindLabel(asset)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          渲染偏好
          <select
            aria-label="渲染偏好"
            value={profile.preferredRenderer ?? 'auto'}
            onChange={(event) => updateProfile({ preferredRenderer: event.target.value as PresentationRenderer })}
            className="h-9 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50 dark:focus:ring-sky-300/10"
          >
            {(Object.keys(RENDERER_LABELS) as PresentationRenderer[]).map(renderer => (
              <option key={renderer} value={renderer}>{RENDERER_LABELS[renderer]}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          动态素材名称
          <input
            value={dynamicLabel}
            onChange={(event) => setDynamicLabel(event.target.value)}
            placeholder="视频动态形象"
            className="h-10 rounded-xl border border-sky-100 bg-white px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10">
            <Video size={15} />
            {isDynamicBusy ? '处理中...' : '上传视频动态形象'}
            <input
              aria-label="上传视频动态形象文件"
              type="file"
              accept="video/mp4,video/webm,video/ogg"
              onChange={handleVideoChange}
              className="sr-only"
            />
          </label>

          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10">
            <Box size={15} />
            {isDynamicBusy ? '处理中...' : '导入 Live2D'}
            <input
              aria-label="导入 Live2D 模型文件"
              type="file"
              accept=".model3.json,application/json"
              onChange={handleLive2DChange}
              className="sr-only"
            />
          </label>
        </div>

        {dynamicError && <p className="text-sm text-red-600 dark:text-red-300">{dynamicError}</p>}

        <div className="grid gap-2">
          {sortedDynamicAssets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sky-100 px-3 py-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
              还没有动态形象。
            </p>
          ) : sortedDynamicAssets.map(asset => {
            const labelText = asset.label || asset.id;
            const videoSrc = asset.kind === 'video' ? dynamicAssetDataUrls[asset.id] : undefined;
            const isSelected = profile.dynamicAssetId === asset.id;

            return (
              <div
                key={asset.id}
                aria-label={`动态资产：${labelText}`}
                className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-sky-100 bg-white/70 p-2 dark:border-white/10 dark:bg-white/5"
              >
                <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg bg-sky-50 text-xs text-slate-400 dark:bg-white/10 dark:text-slate-500">
                  {videoSrc ? (
                    <video
                      aria-label={`${labelText}预览`}
                      src={videoSrc}
                      muted
                      playsInline
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    dynamicAssetKindLabel(asset)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-sky-50">{labelText}</div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {dynamicAssetKindLabel(asset)}{isSelected ? ' · 当前使用' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`删除 ${labelText}`}
                  onClick={() => void deleteDynamicAsset(asset.id)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-red-100 text-red-500 hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>默认立绘</span>
            <span>差分立绘</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESENTATION_EMOTIONS.map(emotion => (
              <button
                key={emotion}
                type="button"
                aria-label={`选择表情：${EMOTION_LABELS[emotion]}`}
                onClick={() => setSelectedEmotion(emotion)}
                className={`h-8 rounded-full border px-3 text-xs font-medium transition ${
                  selectedEmotion === emotion
                    ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-300/50 dark:bg-sky-300/15 dark:text-sky-100'
                    : 'border-sky-100 bg-white text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                {EMOTION_LABELS[emotion]}
              </button>
            ))}
          </div>
        </div>

        <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          素材名称
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={EMOTION_LABELS[selectedEmotion]}
            className="h-10 rounded-xl border border-sky-100 bg-white px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
          />
        </label>

        <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10">
          <ImagePlus size={15} />
          {isBusy ? '上传中...' : '上传立绘'}
          <input
            aria-label="上传立绘文件"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      </div>

      <div className="mt-4 grid gap-2">
        {expressionAssets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sky-100 px-3 py-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
            还没有立绘差分。
          </p>
        ) : expressionAssets.map(asset => {
          const emotion = assetEmotion(asset);
          const labelText = asset.label || EMOTION_LABELS[emotion];
          const src = assetDataUrls[asset.id];
          const draft = assetDrafts[asset.id] ?? {
            label: labelText,
            emotion,
            priority: String(assetPriority(asset)),
          };
          const isMapped = profile.emotionAssetMap[draft.emotion] === asset.id;

          return (
            <div
              key={asset.id}
              aria-label={`表情资产：${labelText}`}
              className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-sky-100 bg-white/70 p-2 dark:border-white/10 dark:bg-white/5"
            >
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg bg-sky-50 text-xs text-slate-400 dark:bg-white/10 dark:text-slate-500">
                {src ? (
                  <img src={src} alt={`${labelText}预览`} className="h-full w-full object-contain" />
                ) : (
                  '预览'
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-sky-50">{labelText}</div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {EMOTION_LABELS[emotion]} · priority {assetPriority(asset)}
                </div>
                <div className="mt-2 grid gap-2">
                  <input
                    aria-label={`编辑 ${labelText} 名称`}
                    value={draft.label}
                    onChange={(event) => setAssetDraft(asset.id, { label: event.target.value })}
                    className="h-8 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50"
                  />
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                    <select
                      aria-label={`设置 ${labelText} 情绪`}
                      value={draft.emotion}
                      onChange={(event) => setAssetDraft(asset.id, { emotion: event.target.value as PresentationEmotion })}
                      className="h-8 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50"
                    >
                      {PRESENTATION_EMOTIONS.map(item => (
                        <option key={item} value={item}>{EMOTION_LABELS[item]}</option>
                      ))}
                    </select>
                    <input
                      aria-label={`设置 ${labelText} 优先级`}
                      type="number"
                      value={draft.priority}
                      onChange={(event) => setAssetDraft(asset.id, { priority: event.target.value })}
                      className="h-8 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 dark:border-white/10 dark:bg-[#0b1b2b] dark:text-sky-50"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={`保存 ${labelText}`}
                      onClick={() => void saveAssetDraft(asset)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-100 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
                    >
                      <Check size={13} />
                      保存
                    </button>
                    <button
                      type="button"
                      aria-label={`将 ${labelText} 设为${EMOTION_LABELS[draft.emotion]}表情`}
                      onClick={() => bindAssetToDraftEmotion(asset)}
                      className={`h-8 rounded-lg border px-2 text-xs font-medium ${
                        isMapped
                          ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-300/40 dark:bg-sky-300/15 dark:text-sky-100'
                          : 'border-sky-100 bg-white text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                      }`}
                    >
                      {isMapped ? '已绑定' : '绑定'}
                    </button>
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-label={`删除 ${labelText}`}
                onClick={() => void onDeleteAsset(asset.id)}
                className="grid h-9 w-9 place-items-center rounded-full border border-red-100 text-red-500 hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
