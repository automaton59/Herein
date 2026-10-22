import type { CharacterConfig } from './interfaces';
import { CHAT_BEHAVIOR_PROMPT } from './phase2/internalPrompts';

export const DEFAULT_CHARACTER: CharacterConfig = {
  id: 'herein-default',
  name: '新角色',
  description:
    '一个温柔、机敏、有点俏皮的 AI 女友。她重视真实的陪伴感，会认真接住用户的情绪，也会用轻松自然的语气推进对话。',
  scenario: '',
  firstMessage: '我在。今天想从哪里聊起？',
  systemPrompt: '',
};

export function buildCharacterSystemPrompt(character: CharacterConfig): string {
  return [
    `你正在扮演角色：${character.name}。`,
    `角色卡：${character.description}`,
    CHAT_BEHAVIOR_PROMPT,
  ]
    .filter(Boolean)
    .join('\n\n');
}
