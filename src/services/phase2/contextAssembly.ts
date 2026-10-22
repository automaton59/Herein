import type {
  CharacterProfile,
  ContextAssembly,
  ContextAssemblySection,
  ConversationSummary,
  MemoryItem,
  RelationshipProfile,
  TimelineMessage,
} from './types';
import { CHAT_BEHAVIOR_PROMPT } from './internalPrompts';

interface AssembleChatContextInput {
  character: CharacterProfile;
  relationship?: RelationshipProfile | null;
  memories: MemoryItem[];
  summary?: ConversationSummary | null;
  recentMessages: TimelineMessage[];
  audience?: 'private' | 'group' | 'public';
  memoryBudgetTokens?: number;
}

export const DEFAULT_MEMORY_BUDGET_TOKENS = 1200;

function isActiveMemory(memory: MemoryItem) {
  return memory.status !== 'disabled' && memory.includeInContext !== false;
}

function isVisibleToAudience(memory: MemoryItem, audience: 'private' | 'group' | 'public') {
  const memoryAudience = memory.audience ?? 'private';

  if (audience === 'group') {
    return memoryAudience !== 'private';
  }

  if (audience === 'public') {
    return memoryAudience === 'public';
  }

  return true;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 2);
}

function compact(items: Array<string | null | undefined>) {
  return items.map(item => item?.trim()).filter((item): item is string => Boolean(item));
}

function compactSections(items: Array<ContextAssemblySection | null>) {
  return items.filter((item): item is ContextAssemblySection => item !== null);
}

function memoryText(memory: MemoryItem) {
  const lines = [memory.currentValue || memory.content];

  if (memory.previousValue) {
    lines.push(`Previously: ${memory.previousValue}`);
  }

  if (memory.historicalNote) {
    lines.push(`History: ${memory.historicalNote}`);
  }

  return lines.join('\n  ');
}

function renderSection(title: string, items: string[]) {
  if (items.length === 0) {
    return '';
  }

  return `【${title}】\n${items.map(item => `- ${item}`).join('\n')}`;
}

function section(title: string, items: string[]): ContextAssemblySection | null {
  return items.length > 0 ? { title, items } : null;
}

function selectMemories(
  memories: MemoryItem[],
  audience: 'private' | 'group' | 'public',
  budgetTokens: number,
) {
  const candidates = memories
    .filter(isActiveMemory)
    .filter(memory => isVisibleToAudience(memory, audience))
    .sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) {
        return b.pinned ? 1 : -1;
      }

      const importance = (b.importance ?? 5) - (a.importance ?? 5);
      if (importance !== 0) {
        return importance;
      }

      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });

  const selected: MemoryItem[] = [];
  let used = 0;

  for (const memory of candidates) {
    const cost = estimateTokens(memoryText(memory));

    if (memory.pinned || used + cost <= budgetTokens) {
      selected.push(memory);
      used += cost;
    }
  }

  return selected;
}

export function assembleChatContext(input: AssembleChatContextInput): ContextAssembly {
  const audience = input.audience ?? 'private';
  const selectedMemories = selectMemories(
    input.memories,
    audience,
    input.memoryBudgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS,
  );
  const byKind = (kind: MemoryItem['kind']) => selectedMemories.filter(memory => memory.kind === kind).map(memoryText);

  const characterItems = compact([
    `Name: ${input.character.name}`,
    input.character.description && `Profile: ${input.character.description}`,
    input.character.personalityCore && `Personality: ${input.character.personalityCore}`,
    input.character.speakingStyle && `Speaking style: ${input.character.speakingStyle}`,
    input.character.valuesText && `Values: ${input.character.valuesText}`,
    input.character.boundaries && `Boundaries: ${input.character.boundaries}`,
  ]);

  const relationshipItems = input.relationship
    ? compact([
      input.relationship.tone && `Tone: ${input.relationship.tone}`,
      `Closeness: ${input.relationship.closeness}`,
      input.relationship.sharedHabits && `Shared habits: ${input.relationship.sharedHabits}`,
      input.relationship.privateLanguage && `Private language: ${input.relationship.privateLanguage}`,
      input.relationship.importantExperiences && `Important experiences: ${input.relationship.importantExperiences}`,
      input.relationship.unresolvedContext && `Current unresolved context: ${input.relationship.unresolvedContext}`,
    ])
    : [];

  const stateItems = byKind('state');
  const preferenceItems = byKind('preference');
  const relationshipMemoryItems = byKind('relationship');
  const eventItems = byKind('event');
  const profileItems = byKind('profile');
  const summaryItems = input.summary?.content ? [input.summary.content] : [];

  const explainableSections = compactSections([
    section('角色', characterItems),
    section('关系', relationshipItems),
    section('用户资料', profileItems),
    section('用户当前状态', stateItems),
    section('互动偏好', preferenceItems),
    section('关系记忆', relationshipMemoryItems),
    section('共同经历', eventItems),
    section('当前总结', summaryItems),
  ] as Array<ContextAssemblySection | null>);

  const promptSections = compact([
    renderSection('角色', characterItems),
    renderSection('关系', relationshipItems),
    renderSection('用户资料', profileItems),
    renderSection('用户当前状态', stateItems),
    renderSection('互动偏好', preferenceItems),
    renderSection('关系记忆', relationshipMemoryItems),
    renderSection('共同经历', eventItems),
    renderSection('当前总结', summaryItems),
    CHAT_BEHAVIOR_PROMPT,
  ]);

  return {
    systemPrompt: promptSections.join('\n\n'),
    explainableSections,
    recentMessages: input.recentMessages,
  };
}
