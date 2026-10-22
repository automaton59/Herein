import type { AvatarManifest } from './index.js';

export interface CharacterVoice {
  provider: 'local-qwen3' | 'local-cosyvoice' | 'system';
  speaker?: string;
  referenceAudio?: string;
  emotionInstructs?: Record<string, string>;
}

export interface CharacterPackManifest {
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
  voice?: CharacterVoice;
  avatar?: AvatarManifest;
  createdAt?: string;
}

export type CharacterPackValidation =
  | { ok: true; value: CharacterPackManifest }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function validateCharacterPack(input: unknown): CharacterPackValidation {
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
  } else {
    if (typeof input.speakingStyle.defaultAddress !== 'string' || !input.speakingStyle.defaultAddress.trim()) {
      errors.push('speakingStyle.defaultAddress must be a non-empty string');
    }

    if (input.speakingStyle.examples !== undefined && !isStringArray(input.speakingStyle.examples)) {
      errors.push('speakingStyle.examples must be a string array');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as unknown as CharacterPackManifest };
}
