import type { Conversation, Message } from './interfaces';
import { CoreClient } from './coreClient';
import { createPhase2Client } from './phase2/client';
import { messageToTimelineMessage, timelineToConversation } from './phase2/mappers';
import { readJSONFile, writeJSONFile } from './storage';

const STORAGE_KEY = 'herein-chat-history';
const FILE_NAME = 'chat-history.json';
export const CORE_URL_KEY = 'herein-core-url';
export const CORE_TOKEN_KEY = 'herein-core-token';
const CORE_SYNC_STATE_KEY = 'herein-core-sync-state';

type CoreSyncState = Record<string, Record<string, string>>;

function readCoreSyncState(): CoreSyncState {
  try {
    const parsed = JSON.parse(localStorage.getItem(CORE_SYNC_STATE_KEY) ?? '{}') as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return parsed as CoreSyncState;
  } catch {
    return {};
  }
}

function writeCoreSyncState(state: CoreSyncState) {
  try {
    localStorage.setItem(CORE_SYNC_STATE_KEY, JSON.stringify(state));
  } catch {
    // Sync state is a cache; losing it only causes a full upsert next time.
  }
}

function messageFingerprint(message: Message) {
  return JSON.stringify([
    message.role,
    message.content,
    message.timestamp instanceof Date ? message.timestamp.toISOString() : String(message.timestamp),
    message.emotion ?? '',
    message.voiceInstruct ?? '',
    message.sticker?.id ?? '',
    message.material?.url ?? '',
    message.reasoning ?? '',
    message.status ?? '',
  ]);
}

export function diffMessagesForCoreSync(
  messages: Message[],
  previous: Record<string, string>,
) {
  const current: Record<string, string> = {};
  const upserts = messages.filter(message => {
    const fingerprint = messageFingerprint(message);
    current[message.id] = fingerprint;
    return previous[message.id] !== fingerprint;
  });
  const deletes = Object.keys(previous).filter(id => !(id in current));

  return { current, upserts, deletes };
}

export function getConfiguredCoreClient(): CoreClient | null {
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

interface StoredChatHistory {
  conversations?: unknown;
  activeConversationId?: unknown;
}

function parseDate(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeMessage(message: unknown): Message | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }

  const raw = message as Partial<Message>;
  const role = raw.role === 'assistant' || raw.role === 'system' ? raw.role : 'user';
  const content = typeof raw.content === 'string' ? raw.content : '';

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `msg_${Date.now()}`,
    role,
    content,
    timestamp: parseDate(raw.timestamp),
    emotion: typeof raw.emotion === 'string' ? raw.emotion : undefined,
    voiceInstruct: typeof raw.voiceInstruct === 'string' && raw.voiceInstruct.trim() ? raw.voiceInstruct : undefined,
    reasoning: typeof raw.reasoning === 'string' && raw.reasoning.trim() ? raw.reasoning : undefined,
  };
}

function normalizeConversation(conversation: unknown): Conversation | null {
  if (typeof conversation !== 'object' || conversation === null) {
    return null;
  }

  const raw = conversation as Partial<Conversation>;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `conversation_${Date.now()}`;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(normalizeMessage).filter((message): message is Message => message !== null)
    : [];

  const contactRemark = typeof raw.contactRemark === 'string' && raw.contactRemark.trim()
    ? raw.contactRemark.trim()
    : typeof raw.customTitle === 'string' && raw.customTitle.trim()
      ? raw.customTitle.trim()
      : null;

  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : '新聊天',
    ...(contactRemark ? { contactRemark } : {}),
    characterId: typeof raw.characterId === 'string' && raw.characterId ? raw.characterId : 'herein-default',
    messages,
    createdAt: parseDate(raw.createdAt),
    updatedAt: parseDate(raw.updatedAt),
  };
}

function hasPhase2Storage() {
  return Boolean(window.electron?.phase2);
}

export function loadChatHistory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return { conversations: [] as Conversation[], activeConversationId: null as string | null };
    }

    const parsed = JSON.parse(stored) as StoredChatHistory;
    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations
        .map(normalizeConversation)
        .filter((conversation): conversation is Conversation => conversation !== null)
      : [];
    const activeConversationId = typeof parsed.activeConversationId === 'string'
      && conversations.some(conversation => conversation.id === parsed.activeConversationId)
      ? parsed.activeConversationId
      : conversations[0]?.id || null;

    return { conversations, activeConversationId };
  } catch (error) {
    console.error('Failed to load chat history:', error);
    return { conversations: [] as Conversation[], activeConversationId: null as string | null };
  }
}

export function saveChatHistory(conversations: Conversation[], activeConversationId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeConversationId }));

    if (hasPhase2Storage()) {
      void savePersistentChatHistory(conversations, activeConversationId).catch(error => {
        console.error('Failed to save Phase 2 chat history:', error);
      });
      return;
    }

    void writeJSONFile(FILE_NAME, { conversations, activeConversationId });
  } catch (error) {
    console.error('Failed to save chat history:', error);
  }
}

export async function loadPersistentChatHistory() {
  if (hasPhase2Storage()) {
    const client = createPhase2Client();
    const bootstrap = await client.bootstrap();
    const conversations: Conversation[] = [];
    const personaId = bootstrap.persona?.id ?? bootstrap.settings.activeCharacterId;
    // The product has one fixed companion. Loading obsolete contact timelines
    // would put other identities back into renderer state and make the chat
    // header depend on whichever conversation was persisted last.
    const charactersToLoad = bootstrap.persona
      ? bootstrap.characters.filter(character => character.id === bootstrap.persona?.id)
      : bootstrap.characters;

    for (const character of charactersToLoad) {
      const timeline = await client.timeline.getPrimary(character.id);

      if (!timeline) {
        continue;
      }

      const messages = await client.timeline.listMessages(timeline.id, 10000);
      conversations.push(timelineToConversation(timeline, messages, character.name));
    }

    const activeConversationId = conversations.find(
      conversation => conversation.characterId === personaId,
    )?.id ?? conversations[0]?.id ?? null;

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeConversationId }));
    return { conversations, activeConversationId };
  }

  const fileHistory = await readJSONFile<StoredChatHistory>(FILE_NAME);

  if (fileHistory) {
    const conversations = Array.isArray(fileHistory.conversations)
      ? fileHistory.conversations
        .map(normalizeConversation)
        .filter((conversation): conversation is Conversation => conversation !== null)
      : [];
    const activeConversationId = typeof fileHistory.activeConversationId === 'string'
      && conversations.some(conversation => conversation.id === fileHistory.activeConversationId)
      ? fileHistory.activeConversationId
      : conversations[0]?.id || null;

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeConversationId }));
    return { conversations, activeConversationId };
  }

  const legacyHistory = loadChatHistory();
  await writeJSONFile(FILE_NAME, legacyHistory);
  return legacyHistory;
}

export async function clearPersistentChatHistory(conversation: Conversation) {
  if (!hasPhase2Storage()) {
    return;
  }

  const core = getConfiguredCoreClient();

  if (core) {
    try {
      await core.health();
      await core.clearTimeline(conversation.characterId);
      const syncState = readCoreSyncState();
      syncState[conversation.id] = {};
      writeCoreSyncState(syncState);
      return;
    } catch (error) {
      console.warn('Core clear failed; falling back to IPC', error);
    }
  }

  try {
    await createPhase2Client().timeline.clearMessages(conversation.id);
  } catch (error) {
    console.warn('Failed to clear stored chat history:', error);
  }
}

export async function savePersistentChatHistory(conversations: Conversation[], activeConversationId: string | null) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeConversationId }));

  if (hasPhase2Storage()) {
    const client = createPhase2Client();
    const bootstrap = await client.bootstrap();
    const characterNames = new Map(bootstrap.characters.map(character => [character.id, character.name]));
    const core = getConfiguredCoreClient();

    if (core) {
      try {
        await core.health();

        const syncState = readCoreSyncState();

        for (const conversation of conversations) {
          const timelineTitle = conversation.contactRemark?.trim()
            || conversation.customTitle?.trim()
            || characterNames.get(conversation.characterId)
            || '新聊天';
          const previous = syncState[conversation.id] ?? {};
          const { current, upserts, deletes } = diffMessagesForCoreSync(
            conversation.messages,
            previous,
          );

          await core.applyTimeline(conversation.characterId, {
            upserts: upserts.map(message => messageToTimelineMessage(message, 'pending')),
            deletes,
            title: timelineTitle,
          });

          syncState[conversation.id] = current;
        }

        const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
        if (activeConversation) {
          await client.settings.set('activeCharacterId', activeConversation.characterId);
        }

        for (const conversationId of Object.keys(syncState)) {
          if (!conversations.some(conversation => conversation.id === conversationId)) {
            delete syncState[conversationId];
          }
        }

        writeCoreSyncState(syncState);
        return;
      } catch (error) {
        console.warn('Core sync failed; falling back to IPC', error);
      }
    }

    for (const conversation of conversations) {
      const timeline = await client.timeline.getPrimary(conversation.characterId);

      if (!timeline) {
        continue;
      }

      const timelineTitle = conversation.contactRemark?.trim()
        || conversation.customTitle?.trim()
        || characterNames.get(conversation.characterId)
        || timeline.title;

      await client.timeline.syncMessages(
        timeline.id,
        conversation.messages.map(message => messageToTimelineMessage(message, timeline.id)),
        timelineTitle,
      );
    }

    const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
    if (activeConversation) {
      await client.settings.set('activeCharacterId', activeConversation.characterId);
    }
    return;
  }

  await writeJSONFile(FILE_NAME, { conversations, activeConversationId });
}
