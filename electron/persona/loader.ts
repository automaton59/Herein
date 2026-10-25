import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PERSONA_VARIABLES,
  isSafeRelativePath,
  templateVariables,
  validatePersonaCharacter,
  validatePersonaManifest,
  type PersonaCharacter,
  type PersonaManifest,
  type PersonaTemplateRef,
} from './manifest';

const MAX_FILE_BYTES = 128 * 1024;

export interface PersonaTemplate {
  ref: PersonaTemplateRef;
  text: string;
}

export interface PersonaPack {
  manifest: PersonaManifest;
  character: PersonaCharacter;
  templates: Map<string, PersonaTemplate>;
  root: string;
}

export function resolvePersonaRoot() {
  return path.resolve(
    process.env.HEREIN_PERSONA_DIR
      ?? path.join(process.cwd(), 'private', 'persona'),
  );
}

async function readPackFile(root: string, relative: string) {
  if (!isSafeRelativePath(relative)) {
    throw new Error(`unsafe persona pack path: ${relative}`);
  }

  const resolved = path.resolve(root, relative);
  const rootResolved = path.resolve(root);

  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`persona pack path escapes its root: ${relative}`);
  }

  const info = await stat(resolved);

  if (!info.isFile()) {
    throw new Error(`persona pack file is not a regular file: ${relative}`);
  }

  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`persona pack file is too large: ${relative}`);
  }

  return readFile(resolved, 'utf8');
}

function validateTemplateVariables(id: string, text: string) {
  const known = new Set<string>(PERSONA_VARIABLES);
  const unknown = templateVariables(text).filter(name => !known.has(name));

  if (unknown.length > 0) {
    throw new Error(`persona template "${id}" uses unknown variables: ${unknown.join(', ')}`);
  }
}

export async function loadPersonaPack(root: string): Promise<PersonaPack> {
  const resolvedRoot = path.resolve(root);
  const manifestRaw = JSON.parse(await readPackFile(resolvedRoot, 'manifest.json')) as unknown;
  const manifestResult = validatePersonaManifest(manifestRaw);

  if (!manifestResult.ok) {
    throw new Error(`invalid persona manifest at ${resolvedRoot}: ${manifestResult.errors.join('; ')}`);
  }

  const manifest = manifestResult.value;
  const characterRaw = JSON.parse(await readPackFile(resolvedRoot, manifest.character)) as unknown;
  const characterResult = validatePersonaCharacter(characterRaw);

  if (!characterResult.ok) {
    throw new Error(`invalid persona character at ${resolvedRoot}: ${characterResult.errors.join('; ')}`);
  }

  const character = characterResult.value;

  if (character.id !== manifest.id) {
    throw new Error(`persona pack id "${manifest.id}" does not match character id "${character.id}"`);
  }

  const templates = new Map<string, PersonaTemplate>();

  for (const ref of manifest.templates) {
    const text = await readPackFile(resolvedRoot, ref.file);
    validateTemplateVariables(ref.id, text);
    templates.set(ref.id, { ref, text });
  }

  return {
    manifest,
    character,
    templates,
    root: resolvedRoot,
  };
}

export async function loadPersonaPacks(root = resolvePersonaRoot()): Promise<Map<string, PersonaPack>> {
  const packs = new Map<string, PersonaPack>();
  let entries;

  try {
    entries = await readdir(path.resolve(root), { withFileTypes: true });
  } catch {
    return packs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packDir = path.join(root, entry.name);
    let hasManifest = false;

    try {
      hasManifest = (await stat(path.join(packDir, 'manifest.json'))).isFile();
    } catch {
      hasManifest = false;
    }

    if (!hasManifest) {
      continue;
    }

    const pack = await loadPersonaPack(packDir);

    if (packs.has(pack.manifest.id)) {
      throw new Error(`duplicate persona pack id: ${pack.manifest.id}`);
    }

    packs.set(pack.manifest.id, pack);
  }

  return packs;
}
