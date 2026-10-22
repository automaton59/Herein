import { describe, expect, it } from 'vitest';
import { assembleChatContext } from './contextAssembly';
import type { CharacterProfile, MemoryItem, RelationshipProfile, TimelineMessage } from './types';

const character: CharacterProfile = {
  id: 'char-1',
  name: 'AL-1S',
  description: 'Warm companion.',
  scenario: 'Private chat.',
  firstMessage: 'I am here.',
  systemPrompt: 'Stay in character.',
  personalityCore: 'Gentle, perceptive, playful.',
  speakingStyle: 'Natural and concrete.',
  valuesText: 'Values long-term companionship.',
  boundaries: 'Do not show reasoning.',
};

const relationship: RelationshipProfile = {
  characterId: 'char-1',
  tone: 'close and relaxed',
  closeness: 4,
  sharedHabits: 'Say good night before sleep.',
  privateLanguage: 'Uses a soft nickname.',
  importantExperiences: 'They talked through a stressful week.',
  unresolvedContext: 'User is preparing to move.',
};

const memories: MemoryItem[] = [
  {
    id: 'state-1',
    kind: 'state',
    scope: 'character',
    characterId: 'char-1',
    content: 'User recently lives in Hangzhou and will move to Shanghai next week.',
    currentValue: 'Moving to Shanghai next week.',
    previousValue: 'Recently in Hangzhou.',
  },
  {
    id: 'pref-1',
    kind: 'preference',
    scope: 'global',
    content: 'User dislikes repeated confirmation questions.',
    pinned: true,
  },
  {
    id: 'rel-1',
    kind: 'relationship',
    scope: 'character',
    characterId: 'char-1',
    content: 'They say good night before sleep.',
  },
  {
    id: 'event-1',
    kind: 'event',
    scope: 'character',
    characterId: 'char-1',
    content: 'On August 3, user gave AL-1S a gift.',
  },
  {
    id: 'disabled-1',
    kind: 'profile',
    scope: 'global',
    content: 'This should not appear.',
    status: 'disabled',
  },
];

const recentMessages: TimelineMessage[] = [
  {
    id: 'm1',
    timelineId: 'timeline-1',
    role: 'user',
    content: 'I am packing tonight.',
    timestamp: '2026-06-19T00:00:00.000Z',
  },
];

describe('assembleChatContext', () => {
  it('builds a deterministic prompt with explainable sections', () => {
    const context = assembleChatContext({
      character,
      relationship,
      memories,
      summary: {
        id: 'summary-1',
        timelineId: 'timeline-1',
        content: 'User and AL-1S discussed moving logistics.',
        messageCount: 18,
        sourceMessageIds: ['m1'],
      },
      recentMessages,
    });

    const prompt = context.systemPrompt;
    const headings = [
      '【角色】',
      '【关系】',
      '【用户当前状态】',
      '【互动偏好】',
      '【关系记忆】',
      '【共同经历】',
      '【当前总结】',
      '【内部行为规则】',
    ];

    for (let index = 0; index < headings.length - 1; index++) {
      expect(prompt.indexOf(headings[index])).toBeLessThan(prompt.indexOf(headings[index + 1]));
    }

    expect(prompt).toContain('AL-1S');
    expect(prompt).toContain('Moving to Shanghai next week.');
    expect(prompt).toContain('Previously: Recently in Hangzhou.');
    expect(prompt).toContain('User dislikes repeated confirmation questions.');
    expect(prompt).toContain('They say good night before sleep.');
    expect(prompt).toContain('On August 3, user gave AL-1S a gift.');
    expect(prompt).toContain('User and AL-1S discussed moving logistics.');
    expect(prompt).not.toContain('This should not appear.');
    expect(prompt).not.toContain('Stay in character.');
    expect(prompt).not.toContain('Private chat.');

    expect(context.recentMessages).toBe(recentMessages);
    expect(context.explainableSections.map(section => section.title)).toEqual([
      '角色',
      '关系',
      '用户当前状态',
      '互动偏好',
      '关系记忆',
      '共同经历',
      '当前总结',
    ]);
  });

  it('keeps private memories out of group context', () => {
    const context = assembleChatContext({
      character,
      audience: 'group',
      memories: [
        {
          id: 'private-1',
          kind: 'state',
          scope: 'character',
          content: '只属于私聊的秘密。',
          audience: 'private',
        },
        {
          id: 'group-1',
          kind: 'state',
          scope: 'character',
          content: '群里大家都知道的安排。',
          audience: 'group',
        },
      ],
      recentMessages,
    });

    expect(context.systemPrompt).toContain('群里大家都知道的安排。');
    expect(context.systemPrompt).not.toContain('只属于私聊的秘密。');
  });

  it('stops adding memories when the token budget is exhausted', () => {
    const firstContent = '甲'.repeat(100);
    const secondContent = '乙'.repeat(100);

    const context = assembleChatContext({
      character,
      memoryBudgetTokens: 60,
      memories: [
        {
          id: 'high',
          kind: 'state',
          scope: 'character',
          content: firstContent,
          importance: 9,
        },
        {
          id: 'low',
          kind: 'state',
          scope: 'character',
          content: secondContent,
          importance: 1,
        },
      ],
      recentMessages,
    });

    expect(context.systemPrompt).toContain(firstContent);
    expect(context.systemPrompt).not.toContain(secondContent);
  });

  it('always keeps pinned memories even over budget', () => {
    const pinnedContent = '丙'.repeat(200);

    const context = assembleChatContext({
      character,
      memoryBudgetTokens: 10,
      memories: [
        {
          id: 'pinned',
          kind: 'preference',
          scope: 'global',
          content: pinnedContent,
          pinned: true,
          importance: 1,
        },
      ],
      recentMessages,
    });

    expect(context.systemPrompt).toContain(pinnedContent);
  });
});
