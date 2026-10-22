import type { LlmConfig } from '../core/llm';
import { chatCompletion } from '../core/llm';
import { buildCoreChatPrompt } from '../core/chatContext';
import type { createPhase2Repositories } from '../data/repositories';
import type {
  QQGatewayEventLike,
  QQObservationDraftLike,
} from './qqListener';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface QQResponderOptions {
  repos: Repositories;
  llmConfig: LlmConfig;
  characterId?: string;
  fetchImpl?: typeof fetch;
}

function stripAssistantTags(text: string) {
  return text
    .replace(/\s*\[(?:emotion:\s*)?(?:neutral|happy|sad|angry|shy|excited|worried|playful|serious)\]\s*/gi, ' ')
    .replace(/\s*\[(?:voice|instruct|voice[_ -]?instruct)\s*:\s*[^\]]+\]\s*/gi, ' ')
    .trim();
}

export function createQQResponder(options: QQResponderOptions) {
  return async (
    _event: QQGatewayEventLike,
    draft: QQObservationDraftLike,
  ): Promise<string | null> => {
    const character = options.characterId
      ? options.repos.characters.get(options.characterId)
      : options.repos.characters.list()[0];

    if (!character) {
      return null;
    }

    const timeline = options.repos.timelines.getPrimaryForCharacter(character.id)
      ?? options.repos.timelines.ensurePrimaryForCharacter(character.id, character.name);

    const history = options.repos.observations
      .listRecent({
        platform: 'qq',
        conversationId: draft.conversationId,
        limit: 12,
      })
      .filter(observation => observation.id !== draft.id && observation.content)
      .reverse()
      .map(observation => ({
        role: observation.isSelf ? 'assistant' as const : 'user' as const,
        content: observation.actorName
          ? `${observation.actorName}：${observation.content}`
          : observation.content ?? '',
      }));

    const systemPrompt = [
      buildCoreChatPrompt({
        repos: options.repos,
        character,
        timeline,
        audience: draft.audience,
      }),
      draft.audience === 'group'
        ? '你现在在群里，刚被 @。只回一句，短、自然；不要提私聊内容，不要复述群友名字。'
        : '你在私聊里。只回一句，短、自然。',
    ].join('\n\n');

    const completion = await chatCompletion(options.llmConfig, [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: draft.content },
    ], {
      temperature: 0.8,
      maxTokens: 80,
      fetchImpl: options.fetchImpl,
    });

    const text = stripAssistantTags(completion.content).slice(0, 300);
    return text || null;
  };
}
