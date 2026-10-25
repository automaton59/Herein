export const PERSONA_LAYERS = [
  'L0_safety_identity',
  'L1_character_core',
  'L2_relationship',
  'L3_user_model',
  'L4_scene',
  'L5_task',
  'L6_output_contract',
] as const;

export type PersonaLayer = typeof PERSONA_LAYERS[number];

export const PERSONA_VARIABLES = [
  'character_name',
  'nickname',
  'user_address',
  'relationship_frame',
  'relationship_stage',
  'closeness',
  'default_address',
  'occasional_address',
  'shared_habits',
  'private_language',
  'important_experiences',
  'unresolved_context',
  'presence_mode',
] as const;

export type PersonaVariable = typeof PERSONA_VARIABLES[number];

export interface PersonaTemplateRef {
  id: string;
  layer: PersonaLayer;
  file: string;
  required?: boolean;
}

export interface PersonaTurnDirectorTuning {
  /** Vent messages at/above this length are listened to silently first. */
  ventLongChars?: number;
  /** Statements at/below this length get a light reaction instead of a reply. */
  shortChars?: number;
  /** Patience below this value keeps replies short. */
  lowPatience?: number;
  /** Bare acknowledgements within this window after a reply trigger silence. */
  recentReplyWindowMs?: number;
  maxTokens?: {
    elaborate?: number;
    question?: number;
    ordinary?: number;
    react?: number;
  };
}

export interface PersonaReplyStyleTuning {
  maxBubbles?: number;
  maxBubbleChars?: number;
}

export interface PersonaTuning {
  turnDirector?: PersonaTurnDirectorTuning;
  replyStyle?: PersonaReplyStyleTuning;
}

export interface PersonaManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  engine: string;
  character: string;
  templates: PersonaTemplateRef[];
  tuning?: PersonaTuning;
}

export interface PersonaCharacterVoice {
  provider: string;
  speaker?: string;
  referenceAudio?: string;
  emotionInstructs?: Record<string, string>;
}

export interface PersonaCharacterAvatar {
  id?: string;
  type: string;
  entry: string;
  lipsync?: string;
  expressions?: Record<string, string>;
}

export interface PersonaCharacter {
  schemaVersion: 1;
  id: string;
  name: string;
  nickname?: string;
  relationshipFrame: string;
  personality: {
    core: string[];
    values?: string[];
    boundaries?: string[];
  };
  speakingStyle: {
    defaultAddress: string;
    occasionalAddress?: string;
    sweetness?: number;
    stubbornness?: number;
    replyShape?: string;
    examples?: string[];
  };
  voice?: PersonaCharacterVoice;
  avatar?: PersonaCharacterAvatar;
  createdAt?: string;
}

export type PersonaValidation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isSafeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/').trim();

  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }

  return normalized.split('/').every(part => part !== '..' && part !== '');
}

function validateTuningNumber(
  value: unknown,
  min: number,
  max: number,
  label: string,
  errors: string[],
) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${label} 必须是 ${min}–${max} 之间的数字`);
  }
}

function validateTuning(tuning: unknown, errors: string[]) {
  if (tuning === undefined) {
    return;
  }

  if (!isRecord(tuning)) {
    errors.push('tuning must be an object');
    return;
  }

  if (tuning.turnDirector !== undefined) {
    if (!isRecord(tuning.turnDirector)) {
      errors.push('tuning.turnDirector must be an object');
    } else {
      const turn = tuning.turnDirector;

      validateTuningNumber(turn.ventLongChars, 10, 500, 'tuning.turnDirector.ventLongChars', errors);
      validateTuningNumber(turn.shortChars, 1, 100, 'tuning.turnDirector.shortChars', errors);
      validateTuningNumber(turn.lowPatience, 0, 1, 'tuning.turnDirector.lowPatience', errors);
      validateTuningNumber(turn.recentReplyWindowMs, 0, 600_000, 'tuning.turnDirector.recentReplyWindowMs', errors);

      if (turn.maxTokens !== undefined) {
        if (!isRecord(turn.maxTokens)) {
          errors.push('tuning.turnDirector.maxTokens must be an object');
        } else {
          for (const key of ['elaborate', 'question', 'ordinary', 'react'] as const) {
            validateTuningNumber(
              turn.maxTokens[key],
              16,
              4096,
              `tuning.turnDirector.maxTokens.${key}`,
              errors,
            );
          }
        }
      }
    }
  }

  if (tuning.replyStyle !== undefined) {
    if (!isRecord(tuning.replyStyle)) {
      errors.push('tuning.replyStyle must be an object');
    } else {
      validateTuningNumber(tuning.replyStyle.maxBubbles, 1, 4, 'tuning.replyStyle.maxBubbles', errors);
      validateTuningNumber(tuning.replyStyle.maxBubbleChars, 10, 200, 'tuning.replyStyle.maxBubbleChars', errors);
    }
  }
}

export function validatePersonaManifest(input: unknown): PersonaValidation<PersonaManifest> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['persona manifest must be an object'] };
  }

  if (input.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.id)) {
    errors.push('id must be a lowercase slug');
  }

  if (typeof input.version !== 'string' || !/^\d+\.\d+\.\d+/.test(input.version)) {
    errors.push('version must be semver');
  }

  if (typeof input.engine !== 'string' || !input.engine.trim()) {
    errors.push('engine range is required');
  }

  if (typeof input.character !== 'string' || !isSafeRelativePath(input.character)) {
    errors.push('character must be a safe relative path');
  }

  if (!Array.isArray(input.templates) || input.templates.length === 0) {
    errors.push('templates must be a non-empty array');
  } else {
    const seen = new Set<string>();

    for (const raw of input.templates) {
      if (!isRecord(raw)) {
        errors.push('template must be an object');
        continue;
      }

      if (typeof raw.id !== 'string' || !raw.id.trim()) {
        errors.push('template id is required');
      } else if (seen.has(raw.id)) {
        errors.push(`duplicate template id: ${raw.id}`);
      } else {
        seen.add(raw.id);
      }

      if (typeof raw.layer !== 'string' || !(PERSONA_LAYERS as readonly string[]).includes(raw.layer)) {
        errors.push(`template ${String(raw.id)} has an invalid layer`);
      }

      if (typeof raw.file !== 'string' || !isSafeRelativePath(raw.file)) {
        errors.push(`template ${String(raw.id)} has an unsafe file path`);
      }
    }

    for (const required of ['safety_identity', 'character_core', 'chat_behavior']) {
      if (!seen.has(required)) {
        errors.push(`missing required template: ${required}`);
      }
    }
  }

  validateTuning(input.tuning, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as unknown as PersonaManifest };
}

export function validatePersonaCharacter(input: unknown): PersonaValidation<PersonaCharacter> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['character pack must be an object'] };
  }

  if (input.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  for (const key of ['id', 'name', 'relationshipFrame'] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  if (!isRecord(input.personality)) {
    errors.push('personality must be an object');
  } else {
    if (!isStringArray(input.personality.core) || input.personality.core.length === 0) {
      errors.push('personality.core must be a non-empty string array');
    }

    if (input.personality.values !== undefined && !isStringArray(input.personality.values)) {
      errors.push('personality.values must be a string array');
    }

    if (input.personality.boundaries !== undefined && !isStringArray(input.personality.boundaries)) {
      errors.push('personality.boundaries must be a string array');
    }
  }

  if (!isRecord(input.speakingStyle)) {
    errors.push('speakingStyle must be an object');
  } else if (typeof input.speakingStyle.defaultAddress !== 'string' || !input.speakingStyle.defaultAddress.trim()) {
    errors.push('speakingStyle.defaultAddress must be a non-empty string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as unknown as PersonaCharacter };
}

export function templateVariables(template: string) {
  const found = new Set<string>();

  for (const match of template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    found.add(match[1]);
  }

  return [...found];
}
