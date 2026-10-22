import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Brain, Camera, Check, Settings, Trash2, Video, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useCallStore } from '../../stores/call';
import { useSettingsStore } from '../../stores/settings';
import { createPhase2Client } from '../../services/phase2/client';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { MemoryPanel } from '../Memory/MemoryPanel';
import { CharacterAppearanceSettings } from '../Settings/CharacterAppearanceSettings';
import { CallLayer } from '../Call/CallLayer';
import type { CharacterConfig, Conversation } from '../../services/interfaces';
import type { AssetRecord, CharacterPresentationProfile, PresentationEmotion } from '../../services/phase2/types';

interface ChatWindowProps {
  onEditCharacter?: () => void;
}

function formatConversationTime(conversation: Conversation | undefined) {
  if (!conversation) {
    return '';
  }

  return conversation.updatedAt.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCharacter(characters: CharacterConfig[], characterId: string | undefined, fallback: CharacterConfig) {
  return characters.find(character => character.id === characterId) || fallback;
}

function getContactRemark(conversation: Conversation | undefined) {
  return conversation?.contactRemark?.trim() || conversation?.customTitle?.trim() || '';
}

function getContactDisplayName(character: CharacterConfig, conversation: Conversation | undefined) {
  return getContactRemark(conversation) || character.name;
}

function createDefaultPresentationProfile(characterId: string): CharacterPresentationProfile {
  return {
    characterId,
    defaultAssetId: null,
    dynamicAssetId: null,
    emotionAssetMap: {},
    fallbackEmotion: 'neutral',
    preferredRenderer: 'auto',
  };
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'typing':
      return '正在输入...';
    case 'online':
      return '在线';
    case 'checking':
      return '正在连接';
    case 'offline':
      return '离线';
    default:
      return '未配置';
  }
}

function getStatusDot(status: string) {
  if (status === 'typing' || status === 'online') {
    return 'bg-emerald-400';
  }

  if (status === 'checking') {
    return 'bg-amber-400';
  }

  return 'bg-slate-300';
}

function ContactAvatar({
  character,
  src,
  size = 'md',
}: {
  character: CharacterConfig;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass = size === 'lg' ? 'h-14 w-14 rounded-2xl text-xl' : size === 'sm' ? 'h-10 w-10 rounded-xl text-base' : 'h-12 w-12 rounded-2xl text-lg';

  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-rose-400 to-fuchsia-400 font-semibold text-white shadow-sm shadow-rose-200 dark:from-rose-300 dark:to-fuchsia-300 dark:text-[#1b1018] dark:shadow-none ${sizeClass}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        character.name.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function ContactProfilePanel({
  character,
  conversation,
  displayName,
  avatarSrc,
  onClose,
  onSaveRemark,
  onUploadAvatar,
  expressionAssets,
  expressionAssetDataUrls,
  dynamicAssets,
  dynamicAssetDataUrls,
  onImportExpression,
  onImportVideo,
  onImportLive2D,
  onDeleteExpression,
  onDeleteDynamic,
  onUpdateExpression,
  presentationProfile,
  onUpdatePresentationProfile,
  onEditCharacter,
  onClearMessages,
}: {
  character: CharacterConfig;
  conversation: Conversation | undefined;
  displayName: string;
  avatarSrc?: string;
  onClose: () => void;
  onSaveRemark: (value: string) => void;
  onUploadAvatar: (file: File) => Promise<void>;
  expressionAssets: AssetRecord[];
  expressionAssetDataUrls: Record<string, string>;
  dynamicAssets: AssetRecord[];
  dynamicAssetDataUrls: Record<string, string>;
  onImportExpression: (file: File, emotion: PresentationEmotion, label: string) => Promise<void>;
  onImportVideo: (file: File, label: string) => Promise<void>;
  onImportLive2D: (file: File, label: string) => Promise<void>;
  onDeleteExpression: (assetId: string) => Promise<void>;
  onDeleteDynamic: (assetId: string) => Promise<void>;
  onUpdateExpression: (assetId: string, patch: Partial<AssetRecord>) => Promise<void>;
  presentationProfile: CharacterPresentationProfile;
  onUpdatePresentationProfile: (profile: CharacterPresentationProfile) => Promise<void>;
  onEditCharacter?: () => void;
  onClearMessages: () => void;
}) {
  const [remarkDraft, setRemarkDraft] = useState(getContactRemark(conversation));
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    setRemarkDraft(getContactRemark(conversation));
  }, [conversation]);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      await onUploadAvatar(file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '头像上传失败');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-white/70 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-[#171018]/85">
      <div className="flex shrink-0 items-center justify-between border-b border-white/70 px-4 py-3 dark:border-white/10">
        <div>
          <p className="text-xs font-medium text-rose-400 dark:text-rose-300">联系人资料</p>
          <h2 className="truncate text-lg font-semibold text-slate-950 dark:text-rose-50">{displayName}</h2>
        </div>
        <button
          type="button"
          aria-label="关闭联系人资料"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full border border-rose-100 text-slate-500 hover:bg-rose-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="flex items-center gap-3">
          <ContactAvatar character={character} src={avatarSrc} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-slate-950 dark:text-rose-50">{displayName}</div>
            <div className="truncate text-sm text-slate-500 dark:text-slate-400">角色名：{character.name}</div>
          </div>
        </section>

        <label className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10">
          <Camera size={15} />
          {isUploading ? '上传中...' : '上传头像'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleAvatarChange} className="sr-only" />
        </label>
        {uploadError && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{uploadError}</p>}

        <div className="mt-5 grid gap-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            备注
            <input
              type="text"
              value={remarkDraft}
              onChange={(event) => setRemarkDraft(event.target.value)}
              placeholder={character.name}
              className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:ring-rose-300/10"
            />
          </label>
          <button
            type="button"
            aria-label="保存备注"
            onClick={() => onSaveRemark(remarkDraft)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-600 dark:bg-rose-400 dark:text-[#1b1018] dark:hover:bg-rose-300"
          >
            <Check size={15} />
            保存备注
          </button>
        </div>

        <CharacterAppearanceSettings
          assets={expressionAssets}
          assetDataUrls={expressionAssetDataUrls}
          dynamicAssets={dynamicAssets}
          dynamicAssetDataUrls={dynamicAssetDataUrls}
          profile={presentationProfile}
          onImportExpression={onImportExpression}
          onImportVideo={onImportVideo}
          onImportLive2D={onImportLive2D}
          onDeleteAsset={(assetId) => (
            dynamicAssets.some(asset => asset.id === assetId)
              ? onDeleteDynamic(assetId)
              : onDeleteExpression(assetId)
          )}
          onUpdateAsset={onUpdateExpression}
          onUpdateProfile={onUpdatePresentationProfile}
        />

        <div className="mt-5 grid gap-2 border-t border-rose-100 pt-5 dark:border-white/10">
          {onEditCharacter && (
            <button
              type="button"
              onClick={onEditCharacter}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
            >
              <Settings size={15} />
              角色卡设置
            </button>
          )}
          <button
            type="button"
            onClick={onClearMessages}
            disabled={!conversation}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-100 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 dark:border-red-400/20 dark:bg-white/5 dark:text-red-300 dark:hover:bg-red-500/10 dark:disabled:border-white/10 dark:disabled:text-slate-600"
          >
            <Trash2 size={15} />
            清空聊天
          </button>
        </div>
      </div>
    </aside>
  );
}

export function ChatWindow({ onEditCharacter }: ChatWindowProps) {
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(false);
  const [avatarDataUrls, setAvatarDataUrls] = useState<Record<string, string>>({});
  const [expressionAssets, setExpressionAssets] = useState<AssetRecord[]>([]);
  const [expressionAssetDataUrls, setExpressionAssetDataUrls] = useState<Record<string, string>>({});
  const [dynamicAssets, setDynamicAssets] = useState<AssetRecord[]>([]);
  const [dynamicAssetDataUrls, setDynamicAssetDataUrls] = useState<Record<string, string>>({});
  const [presentationProfiles, setPresentationProfiles] = useState<Record<string, CharacterPresentationProfile>>({});
  const [pendingCallCharacterId, setPendingCallCharacterId] = useState<string | null>(null);
  const {
    conversations,
    activeConversationId,
    messages,
    isLoading,
    error,
    sendMessage,
    retractMessage,
    updateMessage,
    deleteAfterMessage,
    regenerateFromMessage,
    initializeLLMService,
    createConversation,
    selectConversation,
    setContactRemark,
    clearMessages,
  } = useChatStore();
  const {
    isConfigured,
    llmConfig,
    activeProfileId,
    characters,
    characterConfig,
    voiceConfig,
    connectionStatus,
    setActiveCharacter,
    updateCharacterConfig,
    checkConnection,
  } = useSettingsStore();
  const callSession = useCallStore(state => state.session);
  const startCall = useCallStore(state => state.startCall);
  const minimizeCall = useCallStore(state => state.minimizeCall);
  const endCall = useCallStore(state => state.endCall);
  const canStartCall = useCallStore(state => state.canStartCall);
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
  const currentCharacter = getCharacter(characters, activeConversation?.characterId, characterConfig);
  const currentDisplayName = getContactDisplayName(currentCharacter, activeConversation);
  const currentAvatarSrc = currentCharacter.avatarAssetId ? avatarDataUrls[currentCharacter.avatarAssetId] : undefined;
  const currentExpressionAssets = expressionAssets.filter(asset => asset.characterId === currentCharacter.id);
  const currentDynamicAssets = dynamicAssets.filter(asset => asset.characterId === currentCharacter.id);
  const currentPresentationProfile = presentationProfiles[currentCharacter.id] ?? createDefaultPresentationProfile(currentCharacter.id);
  const activeCallCharacter = characters.find(character => character.id === callSession?.characterId);
  const pendingCallCharacter = characters.find(character => character.id === pendingCallCharacterId);

  const contactRows = useMemo(() => {
    return characters
      .map(character => {
        const conversation = conversations.find(item => item.characterId === character.id);
        return {
          character,
          conversation,
          displayName: getContactDisplayName(character, conversation),
          avatarSrc: character.avatarAssetId ? avatarDataUrls[character.avatarAssetId] : undefined,
        };
      })
      .sort((a, b) => {
        const aTime = a.conversation?.updatedAt.getTime() ?? 0;
        const bTime = b.conversation?.updatedAt.getTime() ?? 0;
        return bTime - aTime;
      });
  }, [avatarDataUrls, characters, conversations]);

  useEffect(() => {
    if (isConfigured) {
      initializeLLMService();
    }
  }, [isConfigured, llmConfig, initializeLLMService]);

  useEffect(() => {
    if (isConfigured) {
      void checkConnection();
    }
  }, [activeProfileId, checkConnection, isConfigured]);

  useEffect(() => {
    const assetIds = characters
      .map(character => character.avatarAssetId)
      .filter((assetId): assetId is string => Boolean(assetId && !avatarDataUrls[assetId]));

    if (assetIds.length === 0 || !window.electron?.phase2) {
      return;
    }

    let isCancelled = false;
    const client = createPhase2Client();

    void Promise.all(assetIds.map(async assetId => {
      const dataUrl = await client.assets.getDataUrl(assetId);
      return dataUrl ? [assetId, dataUrl] as const : null;
    })).then(entries => {
      if (isCancelled) {
        return;
      }

      setAvatarDataUrls(previous => {
        const next = { ...previous };

        for (const entry of entries) {
          if (entry) {
            next[entry[0]] = entry[1];
          }
        }

        return next;
      });
    }).catch(error => {
      console.warn('Failed to load avatar assets:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [avatarDataUrls, characters]);

  useEffect(() => {
    if (!window.electron?.phase2) {
      return;
    }

    let isCancelled = false;
    const client = createPhase2Client();

    void client.assets.list({ kind: 'expression' }).then(assets => {
      if (!isCancelled) {
        setExpressionAssets(assets);
      }
    }).catch(error => {
      console.warn('Failed to load expression assets:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [characters]);

  useEffect(() => {
    if (!window.electron?.phase2) {
      return;
    }

    let isCancelled = false;
    const client = createPhase2Client();

    void Promise.all([
      client.assets.list({ kind: 'video' }),
      client.assets.list({ kind: 'live2d' }),
    ]).then(([videoAssets, live2dAssets]) => {
      if (!isCancelled) {
        setDynamicAssets([...videoAssets, ...live2dAssets]);
      }
    }).catch(error => {
      console.warn('Failed to load dynamic avatar assets:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [characters]);

  useEffect(() => {
    if (!window.electron?.phase2) {
      setPresentationProfiles(previous => {
        const next = { ...previous };

        for (const character of characters) {
          next[character.id] ??= createDefaultPresentationProfile(character.id);
        }

        return next;
      });
      return;
    }

    let isCancelled = false;
    const client = createPhase2Client();

    void Promise.all(characters.map(async character => {
      try {
        return await client.presentation.getProfile(character.id);
      } catch (error) {
        console.warn(`Failed to load presentation profile for ${character.id}:`, error);
        return createDefaultPresentationProfile(character.id);
      }
    })).then(profiles => {
      if (isCancelled) {
        return;
      }

      setPresentationProfiles(previous => {
        const next = { ...previous };

        for (const profile of profiles) {
          next[profile.characterId] = profile;
        }

        return next;
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [characters]);

  useEffect(() => {
    const assetIds = expressionAssets
      .map(asset => asset.id)
      .filter(assetId => !expressionAssetDataUrls[assetId]);

    if (assetIds.length === 0 || !window.electron?.phase2) {
      return;
    }

    let isCancelled = false;
    const client = createPhase2Client();

    void Promise.all(assetIds.map(async assetId => {
      const dataUrl = await client.assets.getDataUrl(assetId);
      return dataUrl ? [assetId, dataUrl] as const : null;
    })).then(entries => {
      if (isCancelled) {
        return;
      }

      setExpressionAssetDataUrls(previous => {
        const next = { ...previous };

        for (const entry of entries) {
          if (entry) {
            next[entry[0]] = entry[1];
          }
        }

        return next;
      });
    }).catch(error => {
      console.warn('Failed to load expression assets:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [expressionAssetDataUrls, expressionAssets]);

  useEffect(() => {
    const assetIds = dynamicAssets
      .filter(asset => asset.kind === 'video')
      .map(asset => asset.id)
      .filter(assetId => !dynamicAssetDataUrls[assetId]);

    if (assetIds.length === 0 || !window.electron?.phase2) {
      return;
    }

    let isCancelled = false;
    const client = createPhase2Client();

    void Promise.all(assetIds.map(async assetId => {
      const dataUrl = await client.assets.getDataUrl(assetId);
      return dataUrl ? [assetId, dataUrl] as const : null;
    })).then(entries => {
      if (isCancelled) {
        return;
      }

      setDynamicAssetDataUrls(previous => {
        const next = { ...previous };

        for (const entry of entries) {
          if (entry) {
            next[entry[0]] = entry[1];
          }
        }

        return next;
      });
    }).catch(error => {
      console.warn('Failed to load dynamic avatar assets:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [dynamicAssetDataUrls, dynamicAssets]);

  const selectContact = (characterId: string) => {
    if (callSession?.mode === 'windowed' && callSession.characterId !== characterId) {
      minimizeCall();
    }

    setActiveCharacter(characterId);

    const existingConversation = conversations.find(conversation => conversation.characterId === characterId);

    if (existingConversation) {
      selectConversation(existingConversation.id);
    } else {
      createConversation(characterId);
    }

    setIsContactPanelOpen(false);
    setIsMemoryOpen(false);
  };

  const saveContactRemark = (value: string) => {
    const conversationId = activeConversation?.id || createConversation(currentCharacter.id);
    setContactRemark(conversationId, value);
  };

  const uploadAvatar = async (file: File) => {
    const client = createPhase2Client();
    const result = await client.assets.importAvatar(currentCharacter.id, file);
    const dataUrl = await client.assets.getDataUrl(result.assetId);

    updateCharacterConfig({ avatarAssetId: result.assetId });

    if (dataUrl) {
      setAvatarDataUrls(previous => ({
        ...previous,
        [result.assetId]: dataUrl,
      }));
    }
  };

  const refreshCharacterExpressionAssets = async (characterId: string) => {
    const client = createPhase2Client();
    const assets = await client.assets.list({ characterId, kind: 'expression' });

    setExpressionAssets(previous => [
      ...previous.filter(asset => asset.characterId !== characterId),
      ...assets,
    ]);

    return assets;
  };

  const refreshCharacterDynamicAssets = async (characterId: string) => {
    const client = createPhase2Client();
    const [videoAssets, live2dAssets] = await Promise.all([
      client.assets.list({ characterId, kind: 'video' }),
      client.assets.list({ characterId, kind: 'live2d' }),
    ]);
    const assets = [...videoAssets, ...live2dAssets];

    setDynamicAssets(previous => [
      ...previous.filter(asset => asset.characterId !== characterId),
      ...assets,
    ]);

    return assets;
  };

  const importExpression = async (file: File, emotion: PresentationEmotion, label: string) => {
    const client = createPhase2Client();
    const result = await client.assets.importExpression(currentCharacter.id, file, {
      emotion,
      label,
      expressionKey: `${emotion}-${Date.now()}`,
      priority: emotion === 'neutral' ? 100 : 10,
    });
    const [dataUrl] = await Promise.all([
      client.assets.getDataUrl(result.assetId),
      refreshCharacterExpressionAssets(currentCharacter.id),
    ]);

    if (dataUrl) {
      setExpressionAssetDataUrls(previous => ({
        ...previous,
        [result.assetId]: dataUrl,
      }));
    }
  };

  const importVideo = async (file: File, label: string) => {
    const client = createPhase2Client();
    const result = await client.assets.importVideo(currentCharacter.id, file, {
      label,
      renderer: 'video',
      loop: true,
      muted: true,
    });
    const [dataUrl] = await Promise.all([
      client.assets.getDataUrl(result.assetId),
      refreshCharacterDynamicAssets(currentCharacter.id),
    ]);

    if (dataUrl) {
      setDynamicAssetDataUrls(previous => ({
        ...previous,
        [result.assetId]: dataUrl,
      }));
    }

    await updatePresentationProfile({
      ...currentPresentationProfile,
      dynamicAssetId: result.assetId,
      preferredRenderer: 'video',
    });
  };

  const importLive2D = async (file: File, label: string) => {
    const client = createPhase2Client();
    const result = await client.assets.importLive2D(currentCharacter.id, file, {
      label,
      renderer: 'live2d',
      entry: file.name,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    await refreshCharacterDynamicAssets(currentCharacter.id);
    await updatePresentationProfile({
      ...currentPresentationProfile,
      dynamicAssetId: result.assetId,
      preferredRenderer: 'live2d',
    });
  };

  const updatePresentationProfile = async (profile: CharacterPresentationProfile) => {
    setPresentationProfiles(previous => ({
      ...previous,
      [profile.characterId]: profile,
    }));

    if (window.electron?.phase2) {
      const client = createPhase2Client();
      await client.presentation.upsertProfile(profile);
    }
  };

  const updateExpression = async (assetId: string, patch: Partial<AssetRecord>) => {
    if (window.electron?.phase2) {
      const client = createPhase2Client();
      await client.assets.update(assetId, patch);
    }

    setExpressionAssets(previous => previous.map(asset => (
      asset.id === assetId
        ? {
          ...asset,
          ...patch,
          metadata: patch.metadata ?? asset.metadata,
        }
        : asset
    )));
  };

  const deleteExpression = async (assetId: string) => {
    const client = createPhase2Client();
    await client.assets.delete(assetId);
    setExpressionAssets(previous => previous.filter(asset => asset.id !== assetId));
    setExpressionAssetDataUrls(previous => {
      const next = { ...previous };
      delete next[assetId];
      return next;
    });

    const nextMap = Object.fromEntries(
      Object.entries(currentPresentationProfile.emotionAssetMap)
        .filter(([, mappedAssetId]) => mappedAssetId !== assetId),
    ) as CharacterPresentationProfile['emotionAssetMap'];
    const nextProfile = {
      ...currentPresentationProfile,
      defaultAssetId: currentPresentationProfile.defaultAssetId === assetId ? null : currentPresentationProfile.defaultAssetId,
      emotionAssetMap: nextMap,
    };

    if (
      nextProfile.defaultAssetId !== currentPresentationProfile.defaultAssetId
      || Object.keys(nextMap).length !== Object.keys(currentPresentationProfile.emotionAssetMap).length
    ) {
      await updatePresentationProfile(nextProfile);
    }
  };

  const deleteDynamic = async (assetId: string) => {
    const client = createPhase2Client();
    await client.assets.delete(assetId);
    setDynamicAssets(previous => previous.filter(asset => asset.id !== assetId));
    setDynamicAssetDataUrls(previous => {
      const next = { ...previous };
      delete next[assetId];
      return next;
    });
  };

  const getConversationForCharacter = (characterId: string) => {
    return conversations.find(conversation => conversation.characterId === characterId);
  };

  const startCallForCharacter = (characterId: string) => {
    const guard = canStartCall(characterId);

    if (!guard.ok) {
      setPendingCallCharacterId(characterId);
      return;
    }

    setActiveCharacter(characterId);
    const conversationId = getConversationForCharacter(characterId)?.id || createConversation(characterId);
    selectConversation(conversationId);
    setIsContactPanelOpen(false);
    setIsMemoryOpen(false);
    setPendingCallCharacterId(null);
    startCall({ characterId, timelineId: conversationId });
  };

  const confirmSecondCall = () => {
    if (!pendingCallCharacterId) {
      return;
    }

    const nextCharacterId = pendingCallCharacterId;
    endCall();
    setPendingCallCharacterId(null);
    setActiveCharacter(nextCharacterId);
    const conversationId = getConversationForCharacter(nextCharacterId)?.id || createConversation(nextCharacterId);
    selectConversation(conversationId);
    startCall({ characterId: nextCharacterId, timelineId: conversationId });
  };

  const openContactPanel = () => {
    setIsContactPanelOpen(true);
    setIsMemoryOpen(false);
  };

  const openMemoryPanel = () => {
    setIsMemoryOpen(true);
    setIsContactPanelOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 bg-[radial-gradient(circle_at_top_left,#ffe4e6_0,#fff7ed_34%,#f8fafc_82%)] text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,#3a1728_0,#1b1018_34%,#0d1118_82%)] dark:text-rose-50">
      <aside className="hidden w-80 shrink-0 flex-col border-r border-white/70 bg-white/55 backdrop-blur dark:border-white/10 dark:bg-[#171018]/70 md:flex">
        <div className="shrink-0 border-b border-white/70 p-4 dark:border-white/10">
          <div className="text-sm font-semibold text-slate-700 dark:text-rose-100">联系人</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-2">
            {contactRows.map(({ character, conversation, displayName, avatarSrc }) => {
              const isActive = character.id === currentCharacter.id;

              return (
                <button
                  key={character.id}
                  type="button"
                  aria-label={`选择联系人：${displayName}`}
                  onClick={() => selectContact(character.id)}
                  className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-white/80 px-3 py-3 text-left shadow-sm transition dark:bg-white/5 dark:shadow-none ${isActive ? 'border-rose-200 ring-2 ring-rose-100 dark:border-rose-300/40 dark:ring-rose-300/10' : 'border-white/80 hover:border-rose-100 dark:border-white/10 dark:hover:border-rose-300/30'}`}
                >
                  <ContactAvatar character={character} src={avatarSrc} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-950 dark:text-rose-50">{displayName}</span>
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{formatConversationTime(conversation)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-white/70 bg-white/60 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#171018]/65">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label="打开联系人资料"
              onClick={openContactPanel}
              className="flex min-w-0 items-center gap-3 rounded-2xl px-1 py-1 text-left hover:bg-white/50 dark:hover:bg-white/5"
            >
              <ContactAvatar character={currentCharacter} src={currentAvatarSrc} />
              <span className="min-w-0">
                <span className="block truncate text-xl font-semibold text-slate-950 dark:text-rose-50">{currentDisplayName}</span>
                <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <span
                    aria-label={`在线状态：${getStatusLabel(connectionStatus)}`}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDot(connectionStatus)}`}
                  />
                  <span className="truncate">{getStatusLabel(connectionStatus)}</span>
                </span>
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label="发起视频通话"
                title="发起视频通话"
                onClick={() => startCallForCharacter(currentCharacter.id)}
                className="grid h-9 w-9 place-items-center rounded-full border border-rose-100 bg-white text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
              >
                <Video size={16} />
              </button>
              <button
                type="button"
                onClick={openMemoryPanel}
                className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
              >
                <Brain size={15} />
                记忆
              </button>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 md:hidden" aria-hidden="true">
            {contactRows.map(({ character, displayName, avatarSrc }) => (
              <button
                key={character.id}
                type="button"
                tabIndex={-1}
                onClick={() => selectContact(character.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${character.id === currentCharacter.id ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-300/10 dark:text-rose-100' : 'border-white/80 bg-white/70 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}
              >
                <ContactAvatar character={character} src={avatarSrc} size="sm" />
                {displayName}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="shrink-0 border-l-4 border-red-400 bg-red-50/90 p-4 dark:bg-red-500/10">
            <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
          </div>
        )}

        <MessageList
          messages={messages}
          firstMessage={currentCharacter.firstMessage}
          onEditMessage={updateMessage}
          onRetractMessage={retractMessage}
          onRegenerateMessage={(messageId) => void regenerateFromMessage(messageId)}
          onDeleteAfterMessage={deleteAfterMessage}
        />

        <InputBar onSend={sendMessage} disabled={isLoading} />
      </div>

      {isContactPanelOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-sm lg:hidden">
          <div className="ml-auto h-full w-full max-w-sm">
            <ContactProfilePanel
              character={currentCharacter}
              conversation={activeConversation}
              displayName={currentDisplayName}
              avatarSrc={currentAvatarSrc}
              onClose={() => setIsContactPanelOpen(false)}
              onSaveRemark={saveContactRemark}
              onUploadAvatar={uploadAvatar}
              expressionAssets={currentExpressionAssets}
              expressionAssetDataUrls={expressionAssetDataUrls}
              dynamicAssets={currentDynamicAssets}
              dynamicAssetDataUrls={dynamicAssetDataUrls}
              onImportExpression={importExpression}
              onImportVideo={importVideo}
              onImportLive2D={importLive2D}
              onDeleteExpression={deleteExpression}
              onDeleteDynamic={deleteDynamic}
              onUpdateExpression={updateExpression}
              presentationProfile={currentPresentationProfile}
              onUpdatePresentationProfile={updatePresentationProfile}
              onEditCharacter={onEditCharacter}
              onClearMessages={clearMessages}
            />
          </div>
        </div>
      )}

      {isContactPanelOpen && (
        <div className="hidden w-96 shrink-0 lg:block">
          <ContactProfilePanel
            character={currentCharacter}
            conversation={activeConversation}
            displayName={currentDisplayName}
            avatarSrc={currentAvatarSrc}
            onClose={() => setIsContactPanelOpen(false)}
            onSaveRemark={saveContactRemark}
            onUploadAvatar={uploadAvatar}
            expressionAssets={currentExpressionAssets}
            expressionAssetDataUrls={expressionAssetDataUrls}
            dynamicAssets={currentDynamicAssets}
            dynamicAssetDataUrls={dynamicAssetDataUrls}
            onImportExpression={importExpression}
            onImportVideo={importVideo}
            onImportLive2D={importLive2D}
            onDeleteExpression={deleteExpression}
            onDeleteDynamic={deleteDynamic}
            onUpdateExpression={updateExpression}
            presentationProfile={currentPresentationProfile}
            onUpdatePresentationProfile={updatePresentationProfile}
            onEditCharacter={onEditCharacter}
            onClearMessages={clearMessages}
          />
        </div>
      )}

      {isMemoryOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-sm lg:hidden">
          <div className="ml-auto h-full w-full max-w-sm">
            <MemoryPanel
              characterId={currentCharacter.id}
              characterName={currentCharacter.name}
              onClose={() => setIsMemoryOpen(false)}
            />
          </div>
        </div>
      )}

      {isMemoryOpen && (
        <div className="hidden w-96 shrink-0 lg:block">
          <MemoryPanel
            characterId={currentCharacter.id}
            characterName={currentCharacter.name}
            onClose={() => setIsMemoryOpen(false)}
          />
        </div>
      )}

      <CallLayer
        characters={characters}
        conversations={conversations}
        avatarDataUrls={avatarDataUrls}
        expressionAssets={expressionAssets}
        expressionAssetDataUrls={expressionAssetDataUrls}
        dynamicAssets={dynamicAssets}
        dynamicAssetDataUrls={dynamicAssetDataUrls}
        presentationProfiles={presentationProfiles}
        voiceConfig={voiceConfig}
        isLoading={isLoading}
        onSend={(content) => void sendMessage(content)}
        onRestoreCharacter={selectContact}
      />

      {pendingCallCharacterId && activeCallCharacter && pendingCallCharacter && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
          <section className="w-full max-w-sm rounded-2xl border border-white/70 bg-white p-5 shadow-2xl shadow-slate-950/20 dark:border-white/10 dark:bg-[#171018] dark:shadow-black/40">
            <h2 className="text-base font-semibold text-slate-950 dark:text-rose-50">切换通话对象</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              当前正在和 {activeCallCharacter.name} 通话。
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={confirmSecondCall}
                className="h-10 rounded-xl bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-600 dark:bg-rose-400 dark:text-[#1b1018] dark:hover:bg-rose-300"
              >
                结束当前通话并拨给 {pendingCallCharacter.name}
              </button>
              <button
                type="button"
                onClick={() => setPendingCallCharacterId(null)}
                className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
              >
                取消
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
