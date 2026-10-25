import { useEffect, useState, type ChangeEvent } from 'react';
import { Brain, Camera, Check, Monitor, Settings, Trash2, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useSettingsStore } from '../../stores/settings';
import { createPhase2Client } from '../../services/phase2/client';
import { CORE_TOKEN_KEY, CORE_URL_KEY } from '../../services/chatHistory';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { MemoryPanel } from '../Memory/MemoryPanel';
import { CharacterAppearanceSettings } from '../Settings/CharacterAppearanceSettings';
import type { CharacterConfig, Conversation } from '../../services/interfaces';
import type { AssetRecord, CharacterPresentationProfile, PresentationEmotion } from '../../services/phase2/types';

interface ChatWindowProps {
  onEditCharacter?: () => void;
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
    return 'bg-aqua-400 shadow-[0_0_0_3px_rgba(124,200,234,0.18)]';
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
  reaction = null,
}: {
  character: CharacterConfig;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  reaction?: string | null;
}) {
  const sizeClass = size === 'lg' ? 'h-14 w-14 rounded-2xl text-xl' : size === 'sm' ? 'h-10 w-10 rounded-xl text-base' : 'h-12 w-12 rounded-2xl text-lg';

  return (
    <div className={`relative shrink-0 ${sizeClass}`}>
      <div className={`grid h-full w-full place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-400 font-semibold text-white shadow-sm shadow-sky-200 dark:from-sky-300 dark:to-fuchsia-300 dark:text-[#04101a] dark:shadow-none ${size === 'sm' ? 'rounded-xl' : 'rounded-2xl'}`}>
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          character.name.slice(0, 1).toUpperCase()
        )}
      </div>
      {reaction && (
        <span className="absolute -bottom-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full border border-white bg-white px-1 text-[10px] text-slate-500 shadow-sm dark:border-[#0E1424] dark:bg-[#1A2136] dark:text-sky-200">
          {reaction}
        </span>
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
    <aside className="flex h-full min-h-0 flex-col border-l border-[#E6E5F0] bg-[#FFFFFF] dark:border-white/10 dark:bg-[#0E1424]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/70 px-4 py-3 dark:border-white/10">
        <div>
          <p className="text-xs font-medium text-sky-400 dark:text-sky-300">角色资料</p>
          <h2 className="truncate text-lg font-semibold text-slate-950 dark:text-sky-50">{displayName}</h2>
        </div>
        <button
          type="button"
          aria-label="关闭联系人资料"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full border border-sky-100 text-slate-500 hover:bg-sky-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="flex items-center gap-3">
          <ContactAvatar character={character} src={avatarSrc} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-slate-950 dark:text-sky-50">{displayName}</div>
            <div className="truncate text-sm text-slate-500 dark:text-slate-400">角色名：{character.name}</div>
          </div>
        </section>

        <label className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-sky-100 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10">
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
              className="h-10 rounded-xl border border-sky-100 bg-white px-3 text-slate-950 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
            />
          </label>
          <button
            type="button"
            aria-label="保存备注"
            onClick={() => onSaveRemark(remarkDraft)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300"
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

        <div className="mt-5 grid gap-2 border-t border-sky-100 pt-5 dark:border-white/10">
          {onEditCharacter && (
            <button
              type="button"
              onClick={onEditCharacter}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-sky-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
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
  const [isOpeningDesktopPresence, setIsOpeningDesktopPresence] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const {
    conversations,
    activeConversationId,
    error,
    silentNotice,
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
    connectionStatus,
    connectionAuto,
    updateCharacterConfig,
    checkConnection,
  } = useSettingsStore();
  // There is exactly one companion. The persona is defined by the private
  // persona pack and is not selectable from the chat UI, so identity must not
  // be inferred from whichever conversation happened to be active last.
  const currentCharacter = getCharacter(characters, characterConfig.id, characterConfig);
  const activeConversation = conversations.find(conversation => conversation.characterId === currentCharacter.id);
  const currentDisplayName = getContactDisplayName(currentCharacter, activeConversation);
  const currentAvatarSrc = currentCharacter.avatarAssetId ? avatarDataUrls[currentCharacter.avatarAssetId] : undefined;
  const currentExpressionAssets = expressionAssets.filter(asset => asset.characterId === currentCharacter.id);
  const currentDynamicAssets = dynamicAssets.filter(asset => asset.characterId === currentCharacter.id);
  const currentPresentationProfile = presentationProfiles[currentCharacter.id] ?? createDefaultPresentationProfile(currentCharacter.id);

  useEffect(() => {
    const base = (window.hereinCore?.url || localStorage.getItem(CORE_URL_KEY) || '')
      .trim()
      .replace(/\/+$/, '');

    if (!base) {
      return;
    }

    const token = window.hereinCore?.token || localStorage.getItem(CORE_TOKEN_KEY)?.trim() || '';
    const source = new EventSource(`${base}/v1/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onCore = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { type?: string };

        if (
          parsed.type !== 'chat.completed'
          && parsed.type !== 'timeline.synced'
          && parsed.type !== 'assistant.proactive'
        ) {
          return;
        }

        if (useChatStore.getState().isLoading) {
          return;
        }

        if (timer) {
          clearTimeout(timer);
        }

        timer = setTimeout(() => {
          void useChatStore.getState().hydrate();
        }, 150);
      } catch {
        // Ignore malformed Core events.
      }
    };

    source.addEventListener('core', onCore as EventListener);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      source.removeEventListener('core', onCore as EventListener);
      source.close();
    };
  }, []);

  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const focusMessage = (event: Event) => {
      const messageId = (event as CustomEvent<string>).detail;

      if (!messageId) {
        return;
      }

      const tryFind = () => {
        const node = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(messageId)}"]`,
        );

        if (!node) {
          attempts += 1;

          if (attempts < 15) {
            timer = setTimeout(tryFind, 200);
          }

          return;
        }

        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node.classList.add('ring-2', 'ring-sky-400/70', 'rounded-2xl');
        window.setTimeout(() => {
          node.classList.remove('ring-2', 'ring-sky-400/70', 'rounded-2xl');
        }, 1800);
      };

      tryFind();
    };

    window.addEventListener('herein:focus-message', focusMessage);

    return () => {
      if (timer) {
        clearTimeout(timer);
      }

      window.removeEventListener('herein:focus-message', focusMessage);
    };
  }, []);

  useEffect(() => {
    if (!currentCharacter.id) {
      return;
    }

    const conversation = conversations.find(item => item.characterId === currentCharacter.id);

    if (!conversation) {
      createConversation(currentCharacter.id);
      return;
    }

    if (activeConversationId !== conversation.id) {
      selectConversation(conversation.id);
    }
  }, [
    activeConversationId,
    conversations,
    createConversation,
    currentCharacter.id,
    selectConversation,
  ]);

  useEffect(() => {
    if (isConfigured) {
      initializeLLMService();
    }
  }, [isConfigured, llmConfig, initializeLLMService]);

  useEffect(() => {
    // Respect a manual 「断开」 in the API settings: no background probing then.
    // Skip when a probe is already in flight (connecting from the settings page).
    if (
      isConfigured
      && connectionAuto
      && useSettingsStore.getState().connectionStatus !== 'checking'
    ) {
      void checkConnection();
    }
  }, [activeProfileId, checkConnection, connectionAuto, isConfigured]);

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

  const ensureConversation = () => {
    const existingConversation = conversations.find(
      conversation => conversation.characterId === currentCharacter.id,
    );

    if (existingConversation) {
      if (activeConversationId !== existingConversation.id) {
        selectConversation(existingConversation.id);
      }

      return existingConversation.id;
    }

    return createConversation(currentCharacter.id);
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

    void window.hereinShell?.presence.refresh();
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

    void window.hereinShell?.presence.refresh();
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
    void window.hereinShell?.presence.refresh();
  };

  const showDesktopPresence = async () => {
    const shell = window.hereinShell;

    if (!shell) {
      return;
    }

    setIsOpeningDesktopPresence(true);

    try {
      await shell.app.setPresenceEnabled(true);
      await shell.presence.refresh();
    } finally {
      setIsOpeningDesktopPresence(false);
    }
  };

  const openContactPanel = () => {
    setIsContactPanelOpen(true);
    setIsMemoryOpen(false);
  };

  const openMemoryPanel = () => {
    setIsMemoryOpen(true);
    setIsContactPanelOpen(false);
  };

  const confirmClearMessages = async () => {
    setIsClearing(true);

    try {
      await clearMessages();
      setIsClearConfirmOpen(false);
      setIsContactPanelOpen(false);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-[radial-gradient(circle_at_top_left,#e6f7ff_0,#f6fbff_34%,#f8fafc_82%)] text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,#082036_0,#04101a_34%,#02070c_82%)] dark:text-sky-50">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-[#E6E5F0] bg-[#FFFFFF]/85 px-4 py-3 dark:border-white/10 dark:bg-[#0E1424]/85">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label="打开角色资料"
              onClick={openContactPanel}
              className="flex min-w-0 items-center gap-3 rounded-2xl px-1 py-1 text-left hover:bg-white/50 dark:hover:bg-white/5"
            >
              <ContactAvatar
                character={currentCharacter}
                src={currentAvatarSrc}
                reaction={silentNotice ? '…' : null}
              />
              <span className="min-w-0">
                <span className="block truncate text-xl font-semibold text-slate-950 dark:text-sky-50">{currentDisplayName}</span>
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
                aria-label="打开桌面形象"
                title="打开桌面形象"
                onClick={() => void showDesktopPresence()}
                disabled={isOpeningDesktopPresence}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-sky-100 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-sky-50 disabled:cursor-wait disabled:text-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
              >
                <Monitor size={15} />
                <span className="hidden sm:inline">桌面形象</span>
              </button>
              <button
                type="button"
                aria-label="清空聊天记录"
                title="清空聊天记录"
                onClick={() => setIsClearConfirmOpen(true)}
                disabled={!activeConversation || activeConversation.messages.length === 0}
                className="grid h-9 w-9 place-items-center rounded-full border border-sky-100 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-300 dark:disabled:border-white/10 dark:disabled:text-slate-600"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                onClick={openMemoryPanel}
                className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
              >
                <Brain size={15} />
                记忆
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="shrink-0 border-l-4 border-red-400 bg-red-50/90 p-4 dark:bg-red-500/10">
            <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
          </div>
        )}

        <MessageList
          messages={activeConversation?.messages ?? []}
          firstMessage={currentCharacter.firstMessage}
          onEditMessage={updateMessage}
          onRetractMessage={retractMessage}
          onRegenerateMessage={(messageId) => void regenerateFromMessage(messageId)}
          onDeleteAfterMessage={deleteAfterMessage}
        />

        {silentNotice && (
          <div className="shrink-0 pb-1 text-center text-[11px] text-slate-400 dark:text-slate-500">
            {silentNotice}
          </div>
        )}

        <InputBar
          onSend={(content) => {
            ensureConversation();
            void sendMessage(content);
          }}
        />
      </div>

      {isContactPanelOpen && (
        <div className="fixed inset-0 z-40 bg-[#0B1020]/25 lg:hidden">
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
              onClearMessages={() => setIsClearConfirmOpen(true)}
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
            onClearMessages={() => setIsClearConfirmOpen(true)}
          />
        </div>
      )}

      {isMemoryOpen && (
        <div className="fixed inset-0 z-40 bg-[#0B1020]/25 lg:hidden">
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

      {isClearConfirmOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#0B1020]/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="清空聊天记录"
        >
          <div className="w-full max-w-sm rounded-2xl border border-sky-100 bg-white p-5 shadow-[0_24px_60px_rgba(15,35,70,0.18)] dark:border-white/10 dark:bg-[#0E1424]">
            <h2 className="text-base font-semibold text-slate-950 dark:text-sky-50">
              清空和{currentDisplayName}的聊天记录？
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {activeConversation?.messages.length ?? 0} 条消息会从聊天记录里删掉，基于这段对话的总结也会一起清掉。记忆面板里的条目不受影响。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsClearConfirmOpen(false)}
                className="inline-flex h-9 items-center rounded-full border border-sky-100 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-sky-50 dark:border-white/10 dark:bg-white/5 dark:text-sky-100 dark:hover:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmClearMessages()}
                disabled={isClearing}
                className="inline-flex h-9 items-center rounded-full bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-wait disabled:bg-red-300"
              >
                {isClearing ? '清空中…' : '确认清空'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
