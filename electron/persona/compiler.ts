import type { RelationshipRecord } from '../data/repositories';
import type { PersonaPack } from './loader';
import type { PersonaLayer, PersonaTemplateRef } from './manifest';

export interface PersonaCompileContext {
  relationship?: RelationshipRecord | null;
  audience?: 'private' | 'group' | 'public';
  userAddress?: string;
  presenceMode?: string;
}

export interface CompiledPersona {
  packId: string;
  packVersion: string;
  identity: string;
  relationship: string | null;
  behavior: string;
  layers: Array<{ id: string; layer: PersonaLayer }>;
}

function renderTemplate(id: string, template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const value = variables[name];

    if (value === undefined) {
      throw new Error(`persona template "${id}" is missing variable "${name}"`);
    }

    return value;
  });
}

function buildVariables(pack: PersonaPack, context: PersonaCompileContext) {
  const character = pack.character;
  const relationship = context.relationship;

  return {
    character_name: character.name,
    nickname: character.nickname?.trim() || character.name,
    user_address: context.userAddress?.trim() || '你',
    relationship_frame: character.relationshipFrame,
    relationship_stage: relationship?.tone?.trim() || '刚开始',
    closeness: String(relationship?.closeness ?? 0),
    default_address: character.speakingStyle.defaultAddress,
    occasional_address: character.speakingStyle.occasionalAddress?.trim() || '无',
    shared_habits: relationship?.sharedHabits?.trim() || '暂无',
    private_language: relationship?.privateLanguage?.trim() || '暂无',
    important_experiences: relationship?.importantExperiences?.trim() || '暂无',
    unresolved_context: relationship?.unresolvedContext?.trim() || '暂无',
    presence_mode: context.presenceMode?.trim() || 'participant',
  };
}

export function compilePersona(pack: PersonaPack, context: PersonaCompileContext = {}): CompiledPersona {
  const variables = buildVariables(pack, context);
  const safety = pack.templates.get('safety_identity');
  const core = pack.templates.get('character_core');
  const relationship = pack.templates.get('relationship');
  const group = pack.templates.get('group_behavior');
  const chat = pack.templates.get('chat_behavior');

  if (!safety || !core || !chat) {
    throw new Error(`persona pack "${pack.manifest.id}" is missing required templates`);
  }

  const audience = context.audience ?? 'private';
  const includeRelationship = audience === 'private';
  const behaviorTemplate = audience === 'group' && group ? group : chat;
  const behaviorId = audience === 'group' && group ? 'group_behavior' : 'chat_behavior';
  const layers: Array<{ id: string; layer: PersonaLayer }> = [
    { id: safety.ref.id, layer: safety.ref.layer },
    { id: core.ref.id, layer: core.ref.layer },
  ];

  if (relationship && includeRelationship) {
    layers.push({ id: relationship.ref.id, layer: relationship.ref.layer });
  }

  layers.push({ id: behaviorId, layer: behaviorTemplate.ref.layer });

  return {
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    identity: [
      renderTemplate(safety.ref.id, safety.text, variables),
      renderTemplate(core.ref.id, core.text, variables),
    ].join('\n\n'),
    relationship: relationship && includeRelationship
      ? renderTemplate(relationship.ref.id, relationship.text, variables)
      : null,
    behavior: renderTemplate(behaviorTemplate.ref.id, behaviorTemplate.text, variables),
    layers,
  };
}

export function personaTemplateRef(pack: PersonaPack, id: string): PersonaTemplateRef | undefined {
  return pack.templates.get(id)?.ref;
}
