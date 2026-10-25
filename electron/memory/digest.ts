import type { createPhase2Repositories } from '../data/repositories';
import type { MemoryStore } from '../data/memoryStore';
import type { DigestInput } from './types';

type Repositories = ReturnType<typeof createPhase2Repositories>;

function compact(value: string | null | undefined) {
  return value?.trim() ?? '';
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function relationshipLine(relationship: ReturnType<Repositories['relationships']['get']>) {
  if (!relationship) {
    return 'none';
  }

  return [
    relationship.tone && `tone=${relationship.tone}`,
    `closeness=${relationship.closeness}/10`,
    relationship.sharedHabits && `habits=${relationship.sharedHabits}`,
    relationship.privateLanguage && `private=${relationship.privateLanguage}`,
    relationship.importantExperiences && `experiences=${relationship.importantExperiences}`,
    relationship.unresolvedContext && `unresolved=${relationship.unresolvedContext}`,
  ].filter(Boolean).join('; ');
}

export function buildMemoryDigest(input: {
  repos: Repositories;
  store: MemoryStore;
  characterId: string;
  timelineId: string;
  messages: DigestInput['messages'];
  limit?: number;
}): string {
  const character = input.repos.characters.get(input.characterId);
  const relationship = input.repos.relationships.get(input.characterId);
  const narrative = input.store.narratives.latest(input.timelineId);
  const memories = input.store.items.listActive({
    characterId: input.characterId,
    subjects: ['user', 'self', 'relationship', 'world'],
    limit: input.limit ?? 20,
  });

  const known = memories.map(memory => {
    const temporal = memory.validFrom
      ? `valid=${memory.validFrom}${memory.validTo ? `..${memory.validTo}` : '..now'}`
      : 'valid=unknown';

    return [
      `[${memory.id}] ${memory.subject}/${memory.kind}`,
      memory.predicate ? `(${memory.predicate})` : '',
      `: ${truncate(memory.content, 240)}`,
      `| ${temporal}`,
      `| importance=${memory.importance}`,
      memory.confidence === null ? '' : `| confidence=${memory.confidence.toFixed(2)}`,
      memory.manual ? '| manual' : '',
    ].filter(Boolean).join(' ');
  });

  const evidence = input.messages.map(message => {
    return `[${message.id}] ${message.role} (${message.timestamp}): ${truncate(compact(message.content), 2000)}`;
  });

  const loops = narrative?.openLoops?.length
    ? narrative.openLoops.map(loop => `- ${loop}`).join('\n')
    : '- none';

  return [
    `Character: ${character?.name ?? input.characterId}`,
    `Relationship: ${relationshipLine(relationship)}`,
    '',
    `Narrative${narrative ? ` (v${narrative.version}, coveredMessages=${narrative.messageCount})` : ''}:`,
    narrative?.content ? truncate(narrative.content, 2400) : 'none',
    '',
    'Open loops:',
    loops,
    '',
    'Known memories:',
    known.length ? known.join('\n') : '- none',
    '',
    'New evidence:',
    evidence.length ? evidence.join('\n') : '- none',
  ].join('\n');
}
