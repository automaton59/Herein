import { createHash } from 'node:crypto';
import type { createPhase2Repositories } from '../data/repositories';
import { PERSONA_VARIABLES, templateVariables, type PersonaCharacter } from './manifest';
import type { PersonaPack } from './loader';
import { syncPersonaCharacter } from './seed';

type Repositories = ReturnType<typeof createPhase2Repositories>;

/**
 * The persona pack on disk is the factory default. Once the user edits the
 * companion in the settings UI, the edited snapshot lives in the app_settings
 * table and wins over the pack until the pack changes on disk again (pack
 * fingerprint mismatch) or the user explicitly restores from files.
 */
export const PERSONA_EDIT_KEY = 'personaEditState';
export const PERSONA_FINGERPRINT_KEY = 'personaPackFingerprint';

const MAX_TEMPLATE_BYTES = 128 * 1024;

export interface PersonaEditState {
  name: string;
  nickname: string;
  relationshipFrame: string;
  personalityCore: string[];
  values: string[];
  boundaries: string[];
  speakingStyle: {
    defaultAddress: string;
    occasionalAddress: string;
    examples: string[];
  };
  /** Sparse: only templates whose text differs from the pack on disk. */
  templates: Record<string, string>;
}

/** Stable hash of everything a pack contributes, used to detect file edits. */
export function fingerprintPack(pack: PersonaPack): string {
  const hash = createHash('sha256');

  hash.update(JSON.stringify(pack.manifest));
  hash.update('\u0000');
  hash.update(JSON.stringify(pack.character));
  hash.update('\u0000');

  for (const id of [...pack.templates.keys()].sort()) {
    hash.update(id);
    hash.update('\u0000');
    hash.update(pack.templates.get(id)?.text ?? '');
    hash.update('\u0000');
  }

  return hash.digest('hex');
}

function cloneCharacter(pack: PersonaPack, edit: PersonaEditState): PersonaCharacter {
  return {
    ...pack.character,
    name: edit.name,
    nickname: edit.nickname.trim() || undefined,
    relationshipFrame: edit.relationshipFrame,
    personality: {
      core: edit.personalityCore,
      values: edit.values.length > 0 ? edit.values : undefined,
      boundaries: edit.boundaries.length > 0 ? edit.boundaries : undefined,
    },
    speakingStyle: {
      defaultAddress: edit.speakingStyle.defaultAddress,
      occasionalAddress: edit.speakingStyle.occasionalAddress.trim() || undefined,
      sweetness: pack.character.speakingStyle.sweetness,
      stubbornness: pack.character.speakingStyle.stubbornness,
      replyShape: pack.character.speakingStyle.replyShape,
      examples: edit.speakingStyle.examples.length > 0 ? edit.speakingStyle.examples : undefined,
    },
    voice: pack.character.voice,
    avatar: pack.character.avatar,
    createdAt: pack.character.createdAt,
  };
}

/** Build the pack the compiler should see: file defaults with UI edits on top. */
export function applyPersonaEdit(pack: PersonaPack, edit: PersonaEditState): PersonaPack {
  const templates = new Map(pack.templates);

  for (const [id, text] of Object.entries(edit.templates)) {
    const base = templates.get(id);

    if (base) {
      templates.set(id, { ref: base.ref, text });
    }
  }

  return {
    ...pack,
    character: cloneCharacter(pack, edit),
    templates,
  };
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a PUT /v1/persona body against the pack on disk. Template
 * overrides are stored sparsely: only texts that differ from the pack.
 */
export function validatePersonaEditInput(
  pack: PersonaPack,
  body: unknown,
): { ok: true; state: PersonaEditState } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ['请求体必须是对象'] };
  }

  const name = readText(body.name);

  if (!name) {
    errors.push('名字不能为空');
  } else if (name.length > 40) {
    errors.push('名字过长（不超过 40 字）');
  }

  const nickname = readText(body.nickname);

  if (nickname.length > 40) {
    errors.push('昵称过长（不超过 40 字）');
  }

  const relationshipFrame = readText(body.relationshipFrame) || '朋友';
  const personalityCore = readLines(body.personalityCore);

  if (personalityCore.length === 0) {
    errors.push('性格核心不能为空');
  }

  const values = readLines(body.values);
  const boundaries = readLines(body.boundaries);

  const style = isRecord(body.speakingStyle) ? body.speakingStyle : {};
  const defaultAddress = readText(style.defaultAddress);

  if (!defaultAddress) {
    errors.push('默认称呼不能为空');
  }

  const occasionalAddress = readText(style.occasionalAddress);
  const examples = readLines(style.examples);

  const templates: Record<string, string> = {};
  const inputTemplates = isRecord(body.templates) ? body.templates : {};
  const knownVariables = new Set<string>(PERSONA_VARIABLES);

  for (const [id, raw] of Object.entries(inputTemplates)) {
    const base = pack.templates.get(id);

    if (!base) {
      errors.push(`未知模板：${id}`);
      continue;
    }

    if (typeof raw !== 'string') {
      errors.push(`模板 ${id} 的内容必须是文本`);
      continue;
    }

    const text = raw.replace(/\r\n/g, '\n');

    if (Buffer.byteLength(text, 'utf8') > MAX_TEMPLATE_BYTES) {
      errors.push(`模板 ${id} 超过 128KB 上限`);
      continue;
    }

    if (base.ref.required && !text.trim()) {
      errors.push(`模板 ${id} 为必填层，不能清空`);
      continue;
    }

    const unknown = templateVariables(text).filter(variable => !knownVariables.has(variable));

    if (unknown.length > 0) {
      errors.push(`模板 ${id} 使用了未知变量：${unknown.join(', ')}`);
      continue;
    }

    if (text !== base.text) {
      templates[id] = text;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    state: {
      name,
      nickname,
      relationshipFrame,
      personalityCore,
      values,
      boundaries,
      speakingStyle: { defaultAddress, occasionalAddress, examples },
      templates,
    },
  };
}

/**
 * Startup sync: the pack on disk is only authoritative when it actually
 * changed (or the character does not exist yet). This keeps in-app edits
 * across restarts while still pulling in externally edited pack files.
 */
export function syncPersonaIfChanged(
  repos: Repositories,
  pack: PersonaPack,
): { applied: boolean; reason: 'seeded' | 'fingerprint-changed' | 'unchanged' } {
  const fingerprint = fingerprintPack(pack);
  const stored = repos.settings.get<string>(PERSONA_FINGERPRINT_KEY);
  const existing = repos.characters.get(pack.manifest.id);

  if (existing && stored === fingerprint) {
    return { applied: false, reason: 'unchanged' };
  }

  syncPersonaCharacter(repos, pack);
  repos.settings.set(PERSONA_EDIT_KEY, null);
  repos.settings.set(PERSONA_FINGERPRINT_KEY, fingerprint);

  return { applied: true, reason: existing ? 'fingerprint-changed' : 'seeded' };
}
