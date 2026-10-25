import type { PersonaPack } from './loader';

export interface PersonaRuntime {
  id: string;
  name: string;
  nickname: string | null;
  pack: PersonaPack;
}

/**
 * Herein ships with a single fixed persona. The persona pack is the source of
 * truth for who the companion is; the renderer must not offer a character
 * picker. Keeping the selection here (instead of in renderer state) makes it
 * impossible for a stale chat row or an old settings value to switch identity.
 */
export function selectPrimaryPersona(
  packs: ReadonlyMap<string, PersonaPack>,
  requestedId = process.env.HEREIN_PERSONA_ID,
): PersonaRuntime | null {
  if (packs.size === 0) {
    return null;
  }

  const ids = [...packs.keys()].sort();
  const preferred = requestedId?.trim();
  const id = preferred && packs.has(preferred) ? preferred : ids[0];
  const pack = packs.get(id);

  if (!pack) {
    return null;
  }

  if (preferred && preferred !== id) {
    console.warn(`[herein] persona "${preferred}" was not found; using "${id}"`);
  }

  if (!preferred && ids.length > 1) {
    console.warn(`[herein] multiple persona packs found; using "${id}". Set HEREIN_PERSONA_ID to choose one.`);
  }

  return {
    id: pack.manifest.id,
    name: pack.character.name,
    nickname: pack.character.nickname ?? null,
    pack,
  };
}
