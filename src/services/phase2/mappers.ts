import type { CharacterConfig, Conversation, Message } from '../interfaces';
import type { CharacterProfile, Timeline, TimelineMessage } from './types';

function parseDate(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function optionalString(value: string | null | undefined) {
  return value?.trim() ? value : undefined;
}

function messageStatus(value: string | null | undefined): Message['status'] | undefined {
  return value === 'pending' || value === 'sent' || value === 'failed' ? value : undefined;
}

export function characterConfigToProfile(character: CharacterConfig): CharacterProfile {
  return {
    id: character.id,
    name: character.name,
    description: character.description,
    scenario: character.scenario,
    firstMessage: character.firstMessage,
    systemPrompt: character.systemPrompt,
    personalityCore: '',
    speakingStyle: '',
    valuesText: '',
    boundaries: '',
    avatarAssetId: character.avatarAssetId ?? null,
  };
}

export function characterProfileToConfig(profile: CharacterProfile): CharacterConfig {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    scenario: profile.scenario,
    firstMessage: profile.firstMessage,
    systemPrompt: profile.systemPrompt,
    avatarAssetId: profile.avatarAssetId ?? null,
  };
}

export function timelineMessageToMessage(message: TimelineMessage): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: parseDate(message.timestamp),
    emotion: optionalString(message.emotion),
    voiceInstruct: optionalString(message.voiceInstruct),
    ...(message.sticker ? { sticker: message.sticker } : {}),
    ...(message.material ? { material: message.material } : {}),
    reasoning: optionalString(message.reasoning),
    status: messageStatus(message.status),
  };
}

export function messageToTimelineMessage(message: Message, timelineId: string): TimelineMessage {
  return {
    id: message.id,
    timelineId,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp.toISOString(),
    emotion: message.emotion,
    voiceInstruct: message.voiceInstruct,
    ...(message.sticker ? { sticker: message.sticker } : {}),
    ...(message.material ? { material: message.material } : {}),
    reasoning: message.reasoning,
    status: message.status,
  };
}

export function conversationToTimelineMessages(messages: Message[], timelineId: string): TimelineMessage[] {
  return messages.map(message => messageToTimelineMessage(message, timelineId));
}

export function timelineToConversation(timeline: Timeline, messages: TimelineMessage[], characterName?: string): Conversation {
  const title = timeline.title.trim();
  const contactRemark = title && characterName && title !== characterName ? title : null;

  return {
    id: timeline.id,
    title: timeline.title,
    ...(contactRemark ? { contactRemark } : {}),
    characterId: timeline.characterId,
    messages: messages.map(timelineMessageToMessage),
    createdAt: parseDate(timeline.createdAt),
    updatedAt: parseDate(timeline.updatedAt),
  };
}
