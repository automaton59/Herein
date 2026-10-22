import { describe, expect, it } from 'vitest';
import type { CharacterConfig, Conversation, Message } from '../interfaces';
import type { Timeline, TimelineMessage } from './types';
import {
  characterConfigToProfile,
  characterProfileToConfig,
  conversationToTimelineMessages,
  timelineMessageToMessage,
  timelineToConversation,
} from './mappers';

describe('phase2 mappers', () => {
  it('maps between legacy character config and Phase 2 character profile without losing core prompt fields', () => {
    const character: CharacterConfig = {
      id: 'char-1',
      name: 'AL-1S',
      description: 'Warm companion.',
      scenario: 'Private chat.',
      firstMessage: 'I am here.',
      systemPrompt: 'Stay in character.',
      avatarAssetId: 'asset-avatar-1',
    };

    const profile = characterConfigToProfile(character);

    expect(profile).toEqual(expect.objectContaining({
      id: 'char-1',
      name: 'AL-1S',
      description: 'Warm companion.',
      scenario: 'Private chat.',
      firstMessage: 'I am here.',
      systemPrompt: 'Stay in character.',
      personalityCore: '',
      speakingStyle: '',
      valuesText: '',
      boundaries: '',
      avatarAssetId: 'asset-avatar-1',
    }));
    expect(characterProfileToConfig(profile)).toEqual(character);
  });

  it('maps a timeline title that differs from the character name as a local contact remark', () => {
    const timeline: Timeline = {
      id: 'timeline-1',
      characterId: 'char-1',
      title: '晚上好',
      kind: 'primary',
      isPrimary: true,
      createdAt: '2026-06-18T08:00:00.000Z',
      updatedAt: '2026-06-19T08:00:00.000Z',
    };

    const conversation = timelineToConversation(timeline, [], 'AL-1S');

    expect(conversation.contactRemark).toBe('晚上好');
    expect(conversation.customTitle).toBeUndefined();
  });

  it('maps timeline messages to chat messages with Date timestamps and optional fields normalized', () => {
    const timelineMessage: TimelineMessage = {
      id: 'msg-1',
      timelineId: 'timeline-1',
      role: 'assistant',
      content: 'I remember.',
      timestamp: '2026-06-19T08:00:00.000Z',
      emotion: 'happy',
      voiceInstruct: '用轻快的语气说',
      reasoning: null,
      status: 'sent',
    };

    expect(timelineMessageToMessage(timelineMessage)).toEqual({
      id: 'msg-1',
      role: 'assistant',
      content: 'I remember.',
      timestamp: new Date('2026-06-19T08:00:00.000Z'),
      emotion: 'happy',
      voiceInstruct: '用轻快的语气说',
      status: 'sent',
    });
  });

  it('maps a primary timeline and its messages into the existing single conversation shape', () => {
    const timeline: Timeline = {
      id: 'timeline-1',
      characterId: 'char-1',
      title: 'AL-1S',
      kind: 'primary',
      isPrimary: true,
      createdAt: '2026-06-18T08:00:00.000Z',
      updatedAt: '2026-06-19T08:00:00.000Z',
    };
    const messages: TimelineMessage[] = [
      {
        id: 'msg-1',
        timelineId: 'timeline-1',
        role: 'user',
        content: 'Hi',
        timestamp: '2026-06-19T07:59:00.000Z',
      },
    ];

    const conversation = timelineToConversation(timeline, messages);

    expect(conversation).toEqual<Conversation>({
      id: 'timeline-1',
      characterId: 'char-1',
      title: 'AL-1S',
      createdAt: new Date('2026-06-18T08:00:00.000Z'),
      updatedAt: new Date('2026-06-19T08:00:00.000Z'),
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hi',
          timestamp: new Date('2026-06-19T07:59:00.000Z'),
        },
      ],
    });
  });

  it('maps chat messages back to timeline messages for persistence', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'I am moving to Shanghai.',
        timestamp: new Date('2026-06-19T08:00:00.000Z'),
        voiceInstruct: '用平稳的语气说',
        status: 'sent',
      },
    ];

    expect(conversationToTimelineMessages(messages, 'timeline-1')).toEqual([
      {
        id: 'msg-1',
        timelineId: 'timeline-1',
        role: 'user',
        content: 'I am moving to Shanghai.',
        timestamp: '2026-06-19T08:00:00.000Z',
        voiceInstruct: '用平稳的语气说',
        status: 'sent',
      },
    ]);
  });
});
