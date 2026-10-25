import type { createPhase2Repositories } from '../data/repositories';
import type { PersonaPack } from './loader';

type Repositories = ReturnType<typeof createPhase2Repositories>;

/**
 * The old sync wrote a canned greeting into every character record. Keep a
 * user-authored opening line, but drop that legacy placeholder so an empty
 * opening really means "no opening bubble".
 */
function legacyOpeningLine(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';

  if (!trimmed || trimmed === '在' || trimmed === '在。') {
    return '';
  }

  return value ?? '';
}

function describe(character: PersonaPack['character']) {
  const sections: string[] = [];
  sections.push(character.personality.core.map(line => `- ${line}`).join('\n'));

  if (character.personality.values?.length) {
    sections.push(`价值观：\n${character.personality.values.map(line => `- ${line}`).join('\n')}`);
  }

  if (character.personality.boundaries?.length) {
    sections.push(`边界：\n${character.personality.boundaries.map(line => `- ${line}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function speakingStyle(character: PersonaPack['character']) {
  return [
    `默认称呼：${character.speakingStyle.defaultAddress}`,
    character.speakingStyle.occasionalAddress && `偶尔称呼：${character.speakingStyle.occasionalAddress}`,
    character.speakingStyle.replyShape && `回复形态：${character.speakingStyle.replyShape}`,
    character.speakingStyle.examples?.length
      && `语气示例：${character.speakingStyle.examples.join(' / ')}`,
  ].filter(Boolean).join('\n');
}

export interface PersonaSeedResult {
  characterId: string;
  created: boolean;
}

export function seedPersonaCharacter(repos: Repositories, pack: PersonaPack): PersonaSeedResult {
  const existing = repos.characters.get(pack.manifest.id);

  if (existing) {
    return { characterId: existing.id, created: false };
  }

  const character = pack.character;
  repos.characters.upsert({
    id: pack.manifest.id,
    name: character.name,
    nickname: character.nickname ?? null,
    description: describe(character),
    scenario: '',
    firstMessage: '',
    systemPrompt: '',
    personalityCore: character.personality.core.join('\n'),
    speakingStyle: speakingStyle(character),
    valuesText: (character.personality.values ?? []).join('\n'),
    boundaries: (character.personality.boundaries ?? []).join('\n'),
    avatarAssetId: null,
    assetDir: null,
  });
  repos.timelines.ensurePrimaryForCharacter(pack.manifest.id, character.name);

  return { characterId: pack.manifest.id, created: true };
}

/**
 * Re-applies persona-pack identity fields on every launch. The pack is the
 * fixed definition of the companion; only local, user-owned fields (opening
 * line, avatar, scenario) are preserved.
 */
export function syncPersonaCharacter(repos: Repositories, pack: PersonaPack): PersonaSeedResult {
  const existing = repos.characters.get(pack.manifest.id);
  const character = pack.character;

  repos.characters.upsert({
    id: pack.manifest.id,
    name: character.name,
    nickname: character.nickname ?? null,
    description: describe(character),
    scenario: existing?.scenario ?? '',
    firstMessage: legacyOpeningLine(existing?.firstMessage),
    systemPrompt: existing?.systemPrompt ?? '',
    personalityCore: character.personality.core.join('\n'),
    speakingStyle: speakingStyle(character),
    valuesText: (character.personality.values ?? []).join('\n'),
    boundaries: (character.personality.boundaries ?? []).join('\n'),
    avatarAssetId: existing?.avatarAssetId ?? null,
    assetDir: existing?.assetDir ?? null,
  });
  repos.timelines.ensurePrimaryForCharacter(pack.manifest.id, character.name);
  repos.settings.set('activeCharacterId', pack.manifest.id);

  return { characterId: pack.manifest.id, created: !existing };
}

export function seedPersonaPacks(repos: Repositories, packs: ReadonlyMap<string, PersonaPack>) {
  const results: PersonaSeedResult[] = [];

  for (const pack of packs.values()) {
    results.push(seedPersonaCharacter(repos, pack));
  }

  return results;
}
