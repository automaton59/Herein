import type { MessageRecord, MessageSticker } from '../data/repositories';
import type { PluginRegistry } from '../plugins/registry';

const FREQUENCY_CHANCE: Record<string, number> = {
  rare: 0.12,
  normal: 0.3,
  often: 0.55,
};

export interface StickerPickInput {
  emotion?: string;
  text: string;
  recent?: MessageRecord[];
}

export interface StickerPickerOptions {
  plugins: PluginRegistry;
  random?: () => number;
}

function readFrequency(config: Record<string, unknown>) {
  const value = typeof config.frequency === 'string' ? config.frequency : 'normal';
  return FREQUENCY_CHANCE[value] ?? FREQUENCY_CHANCE.normal;
}

function readMinGap(config: Record<string, unknown>) {
  const value = Number(config.minGap);
  return Number.isFinite(value) ? Math.max(0, Math.min(20, Math.round(value))) : 3;
}

function normalizeSticker(raw: unknown): MessageSticker | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : '';
  const url = typeof value.url === 'string' ? value.url : '';

  // Only local assets: a plugin must not be able to make the renderer load a
  // remote URL (that would leak the user's IP and break offline use).
  if (!id || !url.startsWith('/assets/')) {
    return null;
  }

  return {
    id,
    name: typeof value.name === 'string' && value.name ? value.name : id,
    url,
    ...(typeof value.pack === 'string' ? { pack: value.pack } : {}),
    ...(typeof value.emotion === 'string' ? { emotion: value.emotion } : {}),
  };
}

/**
 * Decides whether this reply gets a sticker, and which one.
 *
 * The plugin owns the catalog; the runtime owns the rhythm. Frequency and gap
 * checks live here so a plugin cannot turn the character into a sticker spammer.
 */
export function createStickerPicker(options: StickerPickerOptions) {
  const random = options.random ?? Math.random;

  return {
    async pick(input: StickerPickInput): Promise<MessageSticker | null> {
      const view = options.plugins
        .list()
        .find(plugin => plugin.manifest.id === 'stickers');

      if (!view?.installed || !view.enabled) {
        return null;
      }

      const recent = input.recent ?? [];
      const minGap = readMinGap(view.config);

      if (minGap > 0 && recent.slice(-minGap).some(message => message.sticker)) {
        return null;
      }

      if (random() > readFrequency(view.config)) {
        return null;
      }

      const exclude = recent
        .slice(-8)
        .map(message => message.sticker?.id)
        .filter((id): id is string => Boolean(id));

      try {
        const result = await options.plugins.invoke('stickers', 'pick', {
          emotion: input.emotion ?? '',
          text: input.text,
          exclude,
        });

        return normalizeSticker(result);
      } catch {
        return null;
      }
    },
  };
}
