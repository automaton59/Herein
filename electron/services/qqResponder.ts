import type { LlmConfig } from '../core/llm';
import { chatCompletion, loadLlmConfig } from '../core/llm';
import { buildCoreChatPrompt } from '../core/chatContext';
import type { PluginChannelMessage } from '../core/pluginEvents';
import type { createPhase2Repositories } from '../data/repositories';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface QQReplyOptions {
  repos: Repositories;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  characterId?: string;
  fetchImpl?: typeof fetch;
}

function stripAssistantTags(text: string) {
  return text
    .replace(/\s*\[(?:emotion:\s*)?(?:neutral|happy|sad|angry|shy|excited|worried|playful|serious)\]\s*/gi, ' ')
    .replace(/\s*\[(?:voice|instruct|voice[_ -]?instruct)\s*:\s*[^\]]+\]\s*/gi, ' ')
    .trim();
}

/**
 * Generates the reply for an incoming QQ channel message, on the Core side.
 *
 * Persona, relationship, memory and model access all live here — the QQ plugin
 * never sees any of it. It receives what was said and hands back text to send.
 */
export function createQQReply(options: QQReplyOptions) {
  let llmConfig: LlmConfig | undefined = options.llmConfig;

  const resolveLlmConfig = async (): Promise<LlmConfig | undefined> => {
    if (llmConfig) {
      return llmConfig;
    }

    if (options.llmConfigPath) {
      try {
        llmConfig = await loadLlmConfig(options.llmConfigPath);
      } catch {
        llmConfig = undefined;
      }
    }

    return llmConfig;
  };

  return async (message: PluginChannelMessage): Promise<string | null> => {
    const resolvedLlmConfig = await resolveLlmConfig();

    if (!resolvedLlmConfig) {
      return null;
    }

    const audience = message.conversationKind === 'group' ? 'group' as const : 'private' as const;
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
        conversationId: message.conversationId,
        limit: 12,
      })
      .filter(observation => observation.id !== message.msgId && observation.content)
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
        audience,
      }),
      audience === 'group'
        ? '你现在在群里，刚被 @。只回一句，短、自然；不要提私聊内容，不要复述群友名字。'
        : '你在私聊里。只回一句，短、自然。',
    ].join('\n\n');

    const completion = await chatCompletion(resolvedLlmConfig, [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message.content },
    ], {
      temperature: 0.8,
      maxTokens: 80,
      fetchImpl: options.fetchImpl,
    });

    const text = stripAssistantTags(completion.content).slice(0, 300);
    return text || null;
  };
}
