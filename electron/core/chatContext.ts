import type {
  CharacterRecord,
  TimelineRecord,
  createPhase2Repositories,
} from '../data/repositories';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface CoreChatPromptInput {
  repos: Repositories;
  character: CharacterRecord;
  timeline: TimelineRecord;
  audience?: 'private' | 'group' | 'public';
  budgetTokens?: number;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 2);
}

function memoryText(memory: {
  content: string;
  currentValue?: string | null;
  previousValue?: string | null;
  historicalNote?: string | null;
}) {
  return [
    memory.currentValue || memory.content,
    memory.previousValue ? `之前：${memory.previousValue}` : '',
    memory.historicalNote ? `补充：${memory.historicalNote}` : '',
  ].filter(Boolean).join('；');
}

export function buildCoreChatPrompt(input: CoreChatPromptInput): string {
  const audience = input.audience ?? 'private';
  const relationship = input.repos.relationships.get(input.character.id);
  const summary = input.repos.summaries.getByTimeline(input.timeline.id);
  const memories = input.repos.memories.listActive({
    characterId: input.character.id,
    timelineId: input.timeline.id,
    ...(audience === 'group' ? { audience: 'group' as const } : {}),
  }).sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) {
      return b.pinned ? 1 : -1;
    }

    return (b.importance ?? 5) - (a.importance ?? 5);
  });

  const budget = input.budgetTokens ?? 1200;
  const selected: string[] = [];
  let used = 0;

  for (const memory of memories) {
    const text = memoryText(memory);
    const cost = estimateTokens(text);

    if (memory.pinned || used + cost <= budget) {
      selected.push(text);
      used += cost;
    }
  }

  const sections: string[] = [
    `你是${input.character.name}。`,
    input.character.description,
    input.character.personalityCore && `人格：${input.character.personalityCore}`,
    input.character.speakingStyle && `说话方式：${input.character.speakingStyle}`,
    input.character.valuesText && `价值观：${input.character.valuesText}`,
    input.character.boundaries && `边界：${input.character.boundaries}`,
  ].filter((line): line is string => Boolean(line && line.trim()));

  if (relationship) {
    sections.push([
      '【关系】',
      relationship.tone && `语气：${relationship.tone}`,
      `亲近度：${relationship.closeness}/10`,
      relationship.sharedHabits && `共同习惯：${relationship.sharedHabits}`,
      relationship.privateLanguage && `私下用语：${relationship.privateLanguage}`,
      relationship.importantExperiences && `重要经历：${relationship.importantExperiences}`,
      relationship.unresolvedContext && `未解决：${relationship.unresolvedContext}`,
    ].filter(Boolean).join('\n'));
  }

  if (summary?.content) {
    sections.push(`【最近总结】\n${summary.content}`);
  }

  if (selected.length > 0) {
    sections.push(`【记忆】\n${selected.map(item => `- ${item}`).join('\n')}`);
  }

  sections.push([
    '【回复形态】',
    '- 默认一句，2–15 个汉字；先对眼前这句话做反应，不要先总结情绪。',
    '- 一次只做一件事：反应、追问、安慰、建议，四选一。',
    '- 不要心理咨询/客服腔：不要“先别硬撑/我陪着你/我理解你的感受/你已经很棒了”。',
    '- 只有对方明确要分析或长回复时才展开。',
    '- 群聊里不要提私聊内容；不确定就少说。',
    '- 记忆只用于理解，不要复述“我记得你说过”或暴露来源。',
  ].join('\n'));

  return sections.join('\n\n');
}
