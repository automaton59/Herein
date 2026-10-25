import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chat';
import { useSettingsStore } from '../../stores/settings';
import type { CharacterConfig, Conversation } from '../../services/interfaces';
import type { AssetRecord, CharacterPresentationProfile, Phase2PreloadAPI } from '../../services/phase2/types';
import type { DesktopShellApi } from '../../services/desktopPresence';
import { ChatWindow } from './ChatWindow';

const characters: CharacterConfig[] = [
  {
    id: 'char-1',
    name: '海拾香',
    description: '',
    scenario: '',
    firstMessage: '',
    systemPrompt: '',
    avatarAssetId: 'asset-1',
  },
];

const conversations: Conversation[] = [
  {
    id: 'conversation-1',
    characterId: 'char-1',
    title: '在',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: '晚上好',
        timestamp: new Date('2026-06-19T10:50:00Z'),
        status: 'sent',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '在。',
        timestamp: new Date('2026-06-19T10:51:00Z'),
        status: 'sent',
      },
    ],
    createdAt: new Date('2026-06-19T10:45:00Z'),
    updatedAt: new Date('2026-06-19T12:50:00Z'),
  },
];

function createPresentationProfile(characterId: string): CharacterPresentationProfile {
  return {
    characterId,
    defaultAssetId: null,
    dynamicAssetId: null,
    emotionAssetMap: {},
    fallbackEmotion: 'neutral',
    preferredRenderer: 'auto',
  };
}

function createPhase2Mock(overrides: {
  assets?: Partial<Phase2PreloadAPI['assets']>;
  presentation?: Partial<Phase2PreloadAPI['presentation']>;
} = {}): Phase2PreloadAPI {
  return {
    bootstrap: vi.fn(),
    settings: {
      get: vi.fn(),
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
      importAvatar: vi.fn(),
      importExpression: vi.fn(),
      importVideo: vi.fn(),
      importLive2D: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      getDataUrl: vi.fn().mockResolvedValue(null),
      ...overrides.assets,
    },
    presentation: {
      getProfile: vi.fn(async (characterId: string) => createPresentationProfile(characterId)),
      upsertProfile: vi.fn().mockResolvedValue(true),
      ...overrides.presentation,
    },
    backup: {
      export: vi.fn(),
      restore: vi.fn(),
    },
    characterArchive: {
      export: vi.fn(),
      import: vi.fn(),
    },
  };
}

function installElectronPhase2(api: Phase2PreloadAPI) {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { phase2: api },
  });
}

function installDesktopShell(overrides: Partial<DesktopShellApi['app']> = {}) {
  const shell = {
    presence: {
      getState: vi.fn().mockResolvedValue(null),
      getShellState: vi.fn().mockResolvedValue({
        presenceEnabled: true,
        presenceVisible: true,
        alwaysOnTop: true,
        closeToHosting: true,
        launchAtLogin: false,
        hosting: false,
        mainWindowVisible: true,
      }),
      refresh: vi.fn().mockResolvedValue(true),
      openChat: vi.fn().mockResolvedValue(true),
      showContextMenu: vi.fn().mockResolvedValue(true),
      getBounds: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
      moveTo: vi.fn(),
      hide: vi.fn().mockResolvedValue(true),
      onState: vi.fn(() => () => undefined),
      onShellState: vi.fn(() => () => undefined),
    },
    app: {
      showMain: vi.fn().mockResolvedValue(true),
      setPresenceEnabled: vi.fn().mockResolvedValue({
        presenceEnabled: true,
        presenceVisible: true,
        alwaysOnTop: true,
        closeToHosting: true,
        launchAtLogin: false,
        hosting: false,
        mainWindowVisible: true,
      }),
      setAlwaysOnTop: vi.fn(),
      setCloseToHosting: vi.fn(),
      setLaunchAtLogin: vi.fn(),
      quit: vi.fn(),
      ...overrides,
    },
  } as unknown as DesktopShellApi;

  Object.defineProperty(window, 'hereinShell', {
    configurable: true,
    value: shell,
  });

  return shell;
}

function setSinglePersonaState() {
  useSettingsStore.setState({
    isConfigured: false,
    characters,
    activeCharacterId: 'char-1',
    characterConfig: characters[0],
    connectionStatus: 'online',
  });
  useChatStore.setState({
    conversations,
    activeConversationId: 'conversation-1',
    messages: conversations[0].messages,
    isLoading: false,
    error: null,
    pendingRequest: null,
  });
}

afterEach(() => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'hereinShell', {
    configurable: true,
    value: undefined,
  });
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    messages: [],
    isLoading: false,
    error: null,
    pendingRequest: null,
  });
});

describe('ChatWindow', () => {
  it('renders a single fixed companion without a contact list or role selector', () => {
    setSinglePersonaState();

    render(<ChatWindow />);

    expect(screen.queryByText('联系人')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择联系人/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新聊天' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开角色资料' })).toBeInTheDocument();
    expect(screen.getByText('海拾香')).toBeInTheDocument();
  });

  it('keeps the local contact remark editable from the role profile drawer', () => {
    setSinglePersonaState();

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: '打开角色资料' }));
    fireEvent.change(screen.getAllByLabelText('备注')[0], {
      target: { value: '搬家准备' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: '保存备注' })[0]);

    expect(useChatStore.getState().conversations[0].contactRemark).toBe('搬家准备');
  });

  it('can bring the desktop presence back from the chat header', async () => {
    const shell = installDesktopShell();
    setSinglePersonaState();

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: '打开桌面形象' }));

    await waitFor(() => {
      expect(shell.app.setPresenceEnabled).toHaveBeenCalledWith(true);
      expect(shell.presence.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('clears chat history only after the confirmation', async () => {
    setSinglePersonaState();

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: '清空聊天记录' }));
    expect(screen.getByRole('dialog', { name: '清空聊天记录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));

    await waitFor(() => {
      expect(useChatStore.getState().messages).toEqual([]);
    });
    expect(screen.queryByRole('dialog', { name: '清空聊天记录' })).not.toBeInTheDocument();
  });

  it('loads dynamic avatar assets and previews the video source in the profile drawer', async () => {
    const videoAsset: AssetRecord = {
      id: 'video-idle',
      characterId: 'char-1',
      kind: 'video',
      relativePath: 'assets/char-1/video-idle.mp4',
      mimeType: 'video/mp4',
      label: '待机循环',
      metadata: { renderer: 'video' },
    };
    const profile: CharacterPresentationProfile = {
      characterId: 'char-1',
      defaultAssetId: null,
      dynamicAssetId: 'video-idle',
      emotionAssetMap: {},
      fallbackEmotion: 'neutral',
      preferredRenderer: 'video',
    };
    const api = createPhase2Mock({
      assets: {
        list: vi.fn(async (filter?: { kind?: AssetRecord['kind'] }) => {
          if (filter?.kind === 'video') {
            return [videoAsset];
          }

          return [];
        }),
        getDataUrl: vi.fn(async (assetId: string) => (
          assetId === 'video-idle' ? 'data:video/mp4;base64,loop' : null
        )),
      },
      presentation: {
        getProfile: vi.fn(async (characterId: string) => (
          characterId === 'char-1'
            ? profile
            : createPresentationProfile(characterId)
        )),
      },
    });
    installElectronPhase2(api);
    installDesktopShell();
    setSinglePersonaState();

    render(<ChatWindow />);

    await waitFor(() => {
      expect(api.assets.list).toHaveBeenCalledWith({ kind: 'video' });
      expect(api.assets.getDataUrl).toHaveBeenCalledWith('video-idle');
    });

    fireEvent.click(screen.getByRole('button', { name: '打开角色资料' }));

    expect(screen.getAllByLabelText('待机循环预览')[0]).toHaveAttribute('src', 'data:video/mp4;base64,loop');
  });
});
