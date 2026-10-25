import { create } from 'zustand';
import type { ChatResponse, Conversation, Message, LLMService } from '../services/interfaces';
import { LLMServiceFactory } from '../services/llm';
import { parseAssistantMetadata } from '../services/llm/metadata';
import { CoreClient } from '../services/coreClient';
import { useSettingsStore } from './settings';
import { buildCharacterSystemPrompt } from '../services/character';
import {
  CORE_TOKEN_KEY,
  CORE_URL_KEY,
  clearPersistentChatHistory,
  loadChatHistory,
  loadPersistentChatHistory,
  saveChatHistory,
} from '../services/chatHistory';

let messageCounter = 0;
let conversationCounter = 0;

const generateMessageId = () => {
  return `msg_${Date.now()}_${messageCounter++}`;
};

const generateConversationId = () => {
  return `conversation_${Date.now()}_${conversationCounter++}`;
};

function getConfiguredCoreClient(): CoreClient | null {
  try {
    const injected = typeof window !== 'undefined' ? window.hereinCore : undefined;
    const baseUrl = localStorage.getItem(CORE_URL_KEY) || injected?.url;
    if (!baseUrl) {
      return null;
    }

    return new CoreClient({
      baseUrl,
      token: localStorage.getItem(CORE_TOKEN_KEY) || injected?.token || undefined,
    });
  } catch {
    return null;
  }
}

type PendingRequest = {
  conversationId: string;
  controller: AbortController;
  userMessageId?: string;
  mode: 'send' | 'regenerate';
};

function getActiveMessages(conversations: Conversation[], activeConversationId: string | null) {
  return conversations.find(conversation => conversation.id === activeConversationId)?.messages || [];
}

function makeConversation(characterId: string): Conversation {
  const now = new Date();

  return {
    id: generateConversationId(),
    title: '新聊天',
    characterId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getConversationTitle(messages: Message[], fallback: string) {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim());

  if (!firstUserMessage) {
    return fallback;
  }

  const title = firstUserMessage.content.trim().replace(/\s+/g, ' ');
  return title.length > 22 ? `${title.slice(0, 22)}...` : title;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function commitConversations(
  set: (state: Partial<ChatState>) => void,
  conversations: Conversation[],
  activeConversationId: string | null,
  extra: Partial<ChatState> = {},
) {
  saveChatHistory(conversations, activeConversationId);
  set({
    conversations,
    activeConversationId,
    messages: getActiveMessages(conversations, activeConversationId),
    ...extra,
  });
}

function updateConversationMessages(
  conversations: Conversation[],
  conversationId: string,
  updater: (messages: Message[], conversation: Conversation) => Message[],
) {
  return conversations.map(conversation => {
    if (conversation.id !== conversationId) {
      return conversation;
    }

    const messages = updater(conversation.messages, conversation);

    return {
      ...conversation,
      title: getConversationTitle(messages, conversation.title),
      messages,
      updatedAt: new Date(),
    };
  });
}

// The desktop app's timeline lives in the local database. Seeding the store
// from localStorage would briefly render history that was already deleted
// (and could sync those stale messages back before hydrate finishes).
const initialChatHistory = typeof window !== 'undefined' && window.electron?.phase2
  ? { conversations: [] as Conversation[], activeConversationId: null as string | null }
  : loadChatHistory();

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  isHydrated: boolean;
  error: string | null;
  llmService: LLMService | null;
  pendingRequest: PendingRequest | null;
  silentNotice: string | null;

  hydrate: () => Promise<void>;
  initializeLLMService: () => void;
  createConversation: (characterId?: string) => string;
  selectConversation: (conversationId: string) => void;
  setContactRemark: (conversationId: string, contactRemark: string) => void;
  renameConversation: (conversationId: string, customTitle: string) => void;
  deleteConversation: (conversationId: string) => void;
  sendMessage: (content: string) => Promise<void>;
  clearSilentNotice: () => void;
  retractMessage: (messageId: string) => void;
  updateMessage: (messageId: string, content: string) => void;
  deleteAfterMessage: (messageId: string) => void;
  regenerateFromMessage: (messageId: string) => Promise<void>;
  clearMessages: () => Promise<void>;
}

async function requestAssistantReply(
  set: (state: Partial<ChatState>) => void,
  get: () => ChatState,
  conversationId: string,
  messagesForRequest: Message[],
  pendingRequest: PendingRequest,
) {
  const settingsStore = useSettingsStore.getState();
  const conversation = get().conversations.find(item => item.id === conversationId);
  const character = settingsStore.characters.find(item => item.id === conversation?.characterId)
    || settingsStore.characterConfig;
  const core = getConfiguredCoreClient();

  set({ pendingRequest, isLoading: true, error: null });
  settingsStore.setConnectionStatus('typing');

  try {
    let response: ChatResponse | null = null;

    if (core) {
      try {
        const coreResult = await core.chat(
          character.id,
          messagesForRequest.slice(-30).map(message => ({
            role: message.role as 'user' | 'assistant' | 'system',
            content: message.content,
          })),
          { maxTokens: 160, persist: false, signal: pendingRequest.controller.signal },
        );

        if (coreResult.silent) {
          const conversations = updateConversationMessages(get().conversations, conversationId, messages =>
            messages.map(message =>
              message.status === 'pending' || message.id === pendingRequest.userMessageId
                ? { ...message, status: 'sent' as const, readAt: new Date() }
                : message
            )
          );

          commitConversations(set, conversations, get().activeConversationId, {
            isLoading: false,
            pendingRequest: null,
            silentNotice: coreResult.presence?.notice
              ? `已读 · ${coreResult.presence.notice}`
              : '已读',
          });
          await useSettingsStore.getState().markConnectionOnline();
          return;
        }

        const coreMessage = coreResult.message;

        if (!coreMessage) {
          throw new Error('Core returned an empty reply');
        }

        const parsed = coreMessage.emotion || coreMessage.voiceInstruct
          ? {
            text: coreMessage.content,
            emotion: coreMessage.emotion ?? undefined,
            voiceInstruct: coreMessage.voiceInstruct ?? undefined,
          }
          : parseAssistantMetadata(coreMessage.content);
        response = {
          content: parsed.text,
          emotion: parsed.emotion,
          voiceInstruct: parsed.voiceInstruct,
          sticker: coreMessage.sticker ?? null,
          material: coreMessage.material ?? null,
          bubbles: coreMessage.bubbles,
        };
      } catch (error) {
        // A stale Core address must not brick the desktop; fall back to the
        // direct API when it is configured.
        if (!settingsStore.isConfigured) {
          throw error;
        }
      }
    }

    if (!response) {
      const service = LLMServiceFactory.create(settingsStore.llmConfig);
      response = await service.chat({
        messages: messagesForRequest,
        systemPrompt: buildCharacterSystemPrompt(character),
      }, {
        signal: pendingRequest.controller.signal,
      });
    }

    if (get().pendingRequest?.controller !== pendingRequest.controller) {
      return;
    }

    const assistantMessage: Message = {
      id: generateMessageId(),
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      emotion: response.emotion,
      voiceInstruct: response.voiceInstruct,
      sticker: response.sticker ?? null,
      material: response.material ?? null,
      status: 'sent',
      bubbles: response.bubbles,
    };
    const conversations = updateConversationMessages(get().conversations, conversationId, messages => [
      ...messages.map(message =>
        message.status === 'pending'
          ? { ...message, status: 'sent' as const }
          : message
      ),
      assistantMessage,
    ]);

    commitConversations(set, conversations, get().activeConversationId, {
      isLoading: false,
      pendingRequest: null,
      silentNotice: null,
    });
    await useSettingsStore.getState().markConnectionOnline();
  } catch (error) {
    if (get().pendingRequest?.controller !== pendingRequest.controller) {
      return;
    }

    if (isAbortError(error)) {
      set({ isLoading: false, pendingRequest: null });
      return;
    }

    const conversations = pendingRequest.userMessageId
      ? updateConversationMessages(get().conversations, conversationId, messages =>
        messages.map(message =>
          message.id === pendingRequest.userMessageId
            ? { ...message, status: 'failed' as const }
            : message
        ))
      : get().conversations;
    let errorMessage = '发生了未知错误';

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      if (msg.includes('401') || msg.includes('unauthorized')) {
        errorMessage = 'API Key 无效，请检查设置。';
      } else if (
        (msg.includes('404') && msg.includes('model'))
        || msg.includes('does not exist')
        || msg.includes('not support')
        || msg.includes('不支持所选模型')
      ) {
        errorMessage = '当前接口不支持这个模型。请到设置里点击“获取模型”，选择该 API 实际返回并可用于对话的模型 id。';
      } else if (msg.includes('429') || msg.includes('rate limit')) {
        errorMessage = '请求过于频繁或额度受限，请稍后再试。';
      } else if (msg.includes('network') || msg.includes('fetch failed')) {
        errorMessage = '网络错误，请检查网络、代理或 Base URL。';
      } else if (msg.includes('timeout')) {
        errorMessage = '请求超时，API 响应太慢。';
      } else {
        errorMessage = `Error: ${error.message}`;
      }
    }

    commitConversations(set, conversations, get().activeConversationId, {
      error: errorMessage,
      isLoading: false,
      pendingRequest: null,
    });
    useSettingsStore.getState().setConnectionStatus('offline', errorMessage);
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: initialChatHistory.conversations,
  activeConversationId: initialChatHistory.activeConversationId,
  messages: getActiveMessages(initialChatHistory.conversations, initialChatHistory.activeConversationId),
  isLoading: false,
  isHydrated: false,
  error: null,
  llmService: null,
  pendingRequest: null,
  silentNotice: null,

  hydrate: async () => {
    const history = await loadPersistentChatHistory();
    commitConversations(set, history.conversations, history.activeConversationId, {
      isHydrated: true,
    });
  },

  initializeLLMService: () => {
    const { llmConfig } = useSettingsStore.getState();
    const service = LLMServiceFactory.create(llmConfig);
    set({ llmService: service });
  },

  createConversation: (characterId) => {
    const resolvedCharacterId = characterId || useSettingsStore.getState().activeCharacterId;
    const existingConversation = get().conversations.find(conversation => conversation.characterId === resolvedCharacterId);

    if (existingConversation) {
      commitConversations(set, get().conversations, existingConversation.id, { error: null });
      return existingConversation.id;
    }

    const conversation = makeConversation(resolvedCharacterId);
    const conversations = [conversation, ...get().conversations];

    commitConversations(set, conversations, conversation.id, { error: null });
    return conversation.id;
  },

  selectConversation: (conversationId) => {
    const { conversations } = get();

    if (!conversations.some(conversation => conversation.id === conversationId)) {
      return;
    }

    commitConversations(set, conversations, conversationId, { error: null });
  },

  setContactRemark: (conversationId, contactRemark) => {
    const remark = contactRemark.trim();
    const conversations = get().conversations.map(conversation =>
      conversation.id === conversationId
        ? { ...conversation, contactRemark: remark || null, customTitle: undefined, updatedAt: new Date() }
        : conversation
    );

    commitConversations(set, conversations, get().activeConversationId, { error: null });
  },

  renameConversation: (conversationId, customTitle) => {
    get().setContactRemark(conversationId, customTitle);
  },

  deleteConversation: (conversationId) => {
    const { conversations, activeConversationId, pendingRequest } = get();

    if (pendingRequest?.conversationId === conversationId) {
      pendingRequest.controller.abort();
    }

    const updatedConversations = conversations.filter(conversation => conversation.id !== conversationId);
    const nextActiveConversationId = activeConversationId === conversationId
      ? updatedConversations[0]?.id || null
      : activeConversationId;

    commitConversations(set, updatedConversations, nextActiveConversationId, {
      error: null,
      isLoading: pendingRequest?.conversationId === conversationId ? false : get().isLoading,
      pendingRequest: pendingRequest?.conversationId === conversationId ? null : pendingRequest,
    });

    if (pendingRequest?.conversationId === conversationId) {
      useSettingsStore.getState().setConnectionStatus(
        useSettingsStore.getState().isConfigured ? 'online' : 'unconfigured',
      );
    }
  },

  sendMessage: async (content: string) => {
    const state = get();

    if (state.pendingRequest) {
      // A new message supersedes the in-flight reply. The older request is
      // aborted; its user message stays in the timeline as context.
      state.pendingRequest.controller.abort();
    }

    const settings = useSettingsStore.getState();

    if (!settings.isConfigured && !getConfiguredCoreClient()) {
      set({ error: '请先检查 API 设置。' });
      return;
    }

    let { conversations, activeConversationId } = state;
    let conversation = conversations.find(item => item.id === activeConversationId);

    if (!conversation) {
      conversation = makeConversation(settings.activeCharacterId);
      conversations = [conversation, ...conversations];
      activeConversationId = conversation.id;
    }

    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date(),
      status: 'pending',
    };
    const nextMessages = [
      ...conversation.messages.map(message =>
        message.status === 'pending' ? { ...message, status: 'sent' as const } : message
      ),
      userMessage,
    ];
    const conversationId = conversation.id;
    const updatedConversation: Conversation = {
      ...conversation,
      title: getConversationTitle(nextMessages, conversation.title),
      messages: nextMessages,
      updatedAt: new Date(),
    };
    const nextConversations = [
      updatedConversation,
      ...conversations.filter(item => item.id !== conversationId),
    ];
    const pendingRequest: PendingRequest = {
      conversationId,
      controller: new AbortController(),
      userMessageId: userMessage.id,
      mode: 'send',
    };

    commitConversations(set, nextConversations, conversationId, {
      isLoading: true,
      error: null,
      pendingRequest,
      silentNotice: null,
    });
    await requestAssistantReply(set, get, conversationId, nextMessages, pendingRequest);
  },

  clearSilentNotice: () => {
    set({ silentNotice: null });
  },

  retractMessage: (messageId) => {
    const { pendingRequest, conversations, activeConversationId } = get();

    if (!pendingRequest || pendingRequest.userMessageId !== messageId) {
      return;
    }

    pendingRequest.controller.abort();
    const updatedConversations = updateConversationMessages(conversations, pendingRequest.conversationId, messages =>
      messages.filter(message => message.id !== messageId)
    );

    commitConversations(set, updatedConversations, activeConversationId, {
      isLoading: false,
      pendingRequest: null,
      error: null,
    });
    useSettingsStore.getState().setConnectionStatus(
      useSettingsStore.getState().isConfigured ? 'online' : 'unconfigured',
    );
  },

  updateMessage: (messageId, content) => {
    const { conversations, activeConversationId } = get();
    const updatedConversations = updateConversationMessages(conversations, activeConversationId || '', messages =>
      messages.map(message =>
        message.id === messageId
          ? { ...message, content, timestamp: new Date() }
          : message
      )
    );

    commitConversations(set, updatedConversations, activeConversationId, { error: null });
  },

  deleteAfterMessage: (messageId) => {
    const { conversations, activeConversationId, pendingRequest } = get();

    if (!activeConversationId) {
      return;
    }

    if (pendingRequest) {
      pendingRequest.controller.abort();
    }

    const updatedConversations = updateConversationMessages(conversations, activeConversationId, messages => {
      const index = messages.findIndex(message => message.id === messageId);
      return index >= 0 ? messages.slice(0, index + 1) : messages;
    });

    commitConversations(set, updatedConversations, activeConversationId, {
      isLoading: false,
      pendingRequest: null,
      error: null,
    });
    useSettingsStore.getState().setConnectionStatus(
      useSettingsStore.getState().isConfigured ? 'online' : 'unconfigured',
    );
  },

  regenerateFromMessage: async (messageId) => {
    const { conversations, activeConversationId, pendingRequest } = get();

    if (!activeConversationId || pendingRequest) {
      return;
    }

    const conversation = conversations.find(item => item.id === activeConversationId);
    const messageIndex = conversation?.messages.findIndex(message => message.id === messageId) ?? -1;

    if (!conversation || messageIndex < 0) {
      return;
    }

    const targetMessage = conversation.messages[messageIndex];
    const trimmedMessages = targetMessage.role === 'assistant'
      ? conversation.messages.slice(0, messageIndex)
      : conversation.messages.slice(0, messageIndex + 1).map(message =>
        message.id === messageId ? { ...message, status: 'sent' as const } : message
      );

    if (!trimmedMessages.some(message => message.role === 'user')) {
      return;
    }

    const updatedConversations = updateConversationMessages(conversations, activeConversationId, () => trimmedMessages);
    const request: PendingRequest = {
      conversationId: activeConversationId,
      controller: new AbortController(),
      userMessageId: targetMessage.role === 'user' ? targetMessage.id : undefined,
      mode: 'regenerate',
    };

    commitConversations(set, updatedConversations, activeConversationId, {
      isLoading: true,
      pendingRequest: request,
      error: null,
    });
    await requestAssistantReply(set, get, activeConversationId, trimmedMessages, request);
  },

  clearMessages: async () => {
    const { conversations, activeConversationId, pendingRequest } = get();

    if (pendingRequest) {
      pendingRequest.controller.abort();
    }

    const conversation = conversations.find(item => item.id === activeConversationId);

    if (conversation) {
      await clearPersistentChatHistory(conversation);
    }

    const updatedConversations = conversations.map(conversation =>
      conversation.id === activeConversationId
        ? { ...conversation, title: '新聊天', messages: [], updatedAt: new Date() }
        : conversation
    );

    commitConversations(set, updatedConversations, activeConversationId, {
      error: null,
      isLoading: false,
      pendingRequest: null,
    });
    useSettingsStore.getState().setConnectionStatus(
      useSettingsStore.getState().isConfigured ? 'online' : 'unconfigured',
    );
  },
}));

void useChatStore.getState().hydrate();
