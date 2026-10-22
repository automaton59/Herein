import type { CharacterConfig, Message } from '../interfaces';
import { assembleChatContext } from './contextAssembly';
import { characterConfigToProfile, conversationToTimelineMessages } from './mappers';
import type { ContextAssembly, Phase2PreloadAPI } from './types';

interface BuildPhase2ChatContextInput {
  client: Phase2PreloadAPI;
  character: CharacterConfig;
  messages: Message[];
  audience?: 'private' | 'group' | 'public';
  memoryBudgetTokens?: number;
}

export type Phase2ChatContext = ContextAssembly & {
  timelineId: string;
};

export async function buildPhase2ChatContext(input: BuildPhase2ChatContextInput): Promise<Phase2ChatContext> {
  const timeline = await input.client.timeline.getPrimary(input.character.id);

  if (!timeline) {
    throw new Error(`No primary timeline exists for character ${input.character.id}`);
  }

  const [relationship, summary, memories] = await Promise.all([
    input.client.relationship.get(input.character.id),
    input.client.summary.get(timeline.id),
    input.client.memory.list({
      characterId: input.character.id,
      timelineId: timeline.id,
      activeOnly: true,
    }),
  ]);

  const context = assembleChatContext({
    character: characterConfigToProfile(input.character),
    relationship,
    memories,
    summary,
    recentMessages: conversationToTimelineMessages(input.messages, timeline.id),
    audience: input.audience,
    memoryBudgetTokens: input.memoryBudgetTokens,
  });

  return {
    ...context,
    timelineId: timeline.id,
  };
}
