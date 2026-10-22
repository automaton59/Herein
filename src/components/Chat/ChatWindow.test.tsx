import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../stores/chat';
import { useCallStore } from '../../stores/call';
import { useSettingsStore } from '../../stores/settings';
import type { CharacterConfig, Conversation } from '../../services/interfaces';
import type { AssetRecord, CharacterPresentationProfile, Phase2PreloadAPI } from '../../services/phase2/types';
import { ChatWindow } from './ChatWindow';

const characters: CharacterConfig[] = [
  {
    id: 'char-1',
    name: 'AL-1S',
    description: '',
    scenario: '',
    firstMessage: '你好。',
    systemPrompt: '',
    avatarAssetId: 'asset-1',
  },
  {
    id: 'char-2',
    name: 'AL-2S',
    description: '',
    scenario: '',
    firstMessage: '晚上好。',
    systemPrompt: '',
  },
];

const conversations: Conversation[] = [
  {
    id: 'conversation-1',
    characterId: 'char-1',
    title: '晚上好',
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
        content: '晚上好呀。',
        timestamp: new Date('2026-06-19T10:51:00Z'),
        status: 'sent',
      },
    ],
    createdAt: new Date('2026-06-19T10:45:00Z'),
    updatedAt: new Date('2026-06-19T12:50:00Z'),
  },
  {
    id: 'conversation-2',
    characterId: 'char-2',
    title: '晚安',
    messages: [],
    createdAt: new Date('2026-06-19T10:00:00Z'),
    updatedAt: new Date('2026-06-19T11:00:00Z'),
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

afterEach(() => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: undefined,
  });
  useCallStore.getState().endCall();
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
  it('shows characters as contacts instead of a role selector plus chat titles', () => {
    useSettingsStore.setState({
      isConfigured: false,
      characters,
      activeCharacterId: 'char-2',
      characterConfig: characters[1],
      connectionStatus: 'unconfigured',
    });
    useChatStore.setState({
      conversations,
      activeConversationId: 'conversation-2',
      messages: [],
      isLoading: false,
      error: null,
      pendingRequest: null,
    });

    render(<ChatWindow />);

    expect(screen.getByText('联系人')).toBeInTheDocument();
    expect(screen.queryByText('一位角色，一条主聊天')).not.toBeInTheDocument();
    expect(screen.queryByText('角色')).not.toBeInTheDocument();
    expect(screen.queryByText('聊天记录')).not.toBeInTheDocument();

    const contact = screen.getByRole('button', { name: /AL-1S/ });
    expect(within(contact).getByText('AL-1S')).toBeInTheDocument();
    expect(within(contact).queryByText('2 条消息')).not.toBeInTheDocument();
    expect(within(contact).queryByText('备注')).not.toBeInTheDocument();
    expect(within(contact).queryByText('清空')).not.toBeInTheDocument();
  });

  it('lets the user edit a local contact remark from the contact profile drawer', () => {
    useSettingsStore.setState({
      isConfigured: false,
      characters,
      activeCharacterId: 'char-1',
      characterConfig: characters[0],
      connectionStatus: 'unconfigured',
    });
    useChatStore.setState({
      conversations,
      activeConversationId: 'conversation-1',
      messages: conversations[0].messages,
      isLoading: false,
      error: null,
      pendingRequest: null,
    });

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: /打开联系人资料/ }));
    fireEvent.change(screen.getAllByLabelText('备注')[0], {
      target: { value: '搬家准备' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: '保存备注' })[0]);

    expect(screen.getAllByText('搬家准备').length).toBeGreaterThan(0);
    expect(useChatStore.getState().conversations[0].contactRemark).toBe('搬家准备');
    expect(useSettingsStore.getState().characters[0].name).toBe('AL-1S');
  });

  it('does not expose a create-chat button because each character has one chat', () => {
    useSettingsStore.setState({
      isConfigured: false,
      characters,
      activeCharacterId: 'char-1',
      characterConfig: characters[0],
      connectionStatus: 'unconfigured',
    });
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: [],
      isLoading: false,
      error: null,
      pendingRequest: null,
    });

    render(<ChatWindow />);

    expect(screen.queryByRole('button', { name: '新聊天' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '主聊天' })).not.toBeInTheDocument();
  });

  it('keeps contact cards clean and shows status as a standalone indicator', () => {
    useSettingsStore.setState({
      isConfigured: false,
      characters,
      activeCharacterId: 'char-2',
      characterConfig: characters[1],
      connectionStatus: 'online',
    });
    useChatStore.setState({
      conversations,
      activeConversationId: 'conversation-2',
      messages: [],
      isLoading: false,
      error: null,
      pendingRequest: null,
    });

    render(<ChatWindow />);

    const activeContact = screen.getByRole('button', { name: /选择联系人：AL-2S/ });
    expect(within(activeContact).getAllByText('AL-2S')).toHaveLength(1);
    expect(screen.getByLabelText('在线状态：在线')).toBeInTheDocument();
  });

  it('selects a contact by selecting its one primary conversation', () => {
    useSettingsStore.setState({
      isConfigured: false,
      characters,
      activeCharacterId: 'char-1',
      characterConfig: characters[0],
      connectionStatus: 'unconfigured',
    });
    useChatStore.setState({
      conversations,
      activeConversationId: 'conversation-1',
      messages: conversations[0].messages,
      isLoading: false,
      error: null,
      pendingRequest: null,
    });

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: /AL-2S/ }));

    expect(useSettingsStore.getState().activeCharacterId).toBe('char-2');
    expect(useChatStore.getState().activeConversationId).toBe('conversation-2');
  });

  it('starts a video call for the current contact from the chat top bar', () => {
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

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: '发起视频通话' }));

    expect(useCallStore.getState().session).toEqual(expect.objectContaining({
      characterId: 'char-1',
      timelineId: 'conversation-1',
      mode: 'windowed',
    }));
    expect(screen.getByRole('dialog', { name: 'AL-1S 视频通话' })).toBeInTheDocument();
  });

  it('minimizes an active call when switching contacts and restores it from mini', () => {
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

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: '发起视频通话' }));
    fireEvent.click(screen.getByRole('button', { name: /选择联系人：AL-2S/ }));

    expect(useCallStore.getState().session?.mode).toBe('mini');
    expect(screen.getByRole('button', { name: '恢复 AL-1S 通话' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '恢复 AL-1S 通话' }));

    expect(useSettingsStore.getState().activeCharacterId).toBe('char-1');
    expect(useChatStore.getState().activeConversationId).toBe('conversation-1');
    expect(useCallStore.getState().session?.mode).toBe('windowed');
  });

  it('requires confirmation before starting a second contact call', () => {
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

    render(<ChatWindow />);

    fireEvent.click(screen.getByRole('button', { name: '发起视频通话' }));
    fireEvent.click(screen.getByRole('button', { name: /选择联系人：AL-2S/ }));
    fireEvent.click(screen.getByRole('button', { name: '发起视频通话' }));

    expect(screen.getByText('当前正在和 AL-1S 通话。')).toBeInTheDocument();
    expect(useCallStore.getState().session?.characterId).toBe('char-1');

    fireEvent.click(screen.getByRole('button', { name: '结束当前通话并拨给 AL-2S' }));

    expect(useCallStore.getState().session).toEqual(expect.objectContaining({
      characterId: 'char-2',
      timelineId: 'conversation-2',
      mode: 'windowed',
    }));
  });

  it('loads dynamic avatar assets and renders the selected video source in calls', async () => {
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

    render(<ChatWindow />);

    await waitFor(() => {
      expect(api.assets.list).toHaveBeenCalledWith({ kind: 'video' });
      expect(api.assets.getDataUrl).toHaveBeenCalledWith('video-idle');
    });

    fireEvent.click(screen.getByRole('button', { name: '发起视频通话' }));

    expect(screen.getByLabelText('AL-1S 动态形象')).toHaveAttribute('src', 'data:video/mp4;base64,loop');
  });
});
