/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { createStickerPicker } from './stickers';
import type { PluginRegistry } from '../plugins/registry';
import type { MessageRecord } from '../data/repositories';

function message(id: string, sticker: { id: string; name: string; url: string } | null = null): MessageRecord {
  return {
    id,
    timelineId: 'timeline-1',
    role: 'assistant',
    content: 'hello',
    timestamp: '2026-10-25T00:00:00.000Z',
    sticker,
  };
}

function registry(options: {
  installed?: boolean;
  enabled?: boolean;
  config?: Record<string, unknown>;
  invoke?: (action: string, input: unknown) => Promise<unknown>;
}) {
  const invoke = vi.fn(options.invoke ?? (async () => ({
    id: '开心/a.gif',
    name: '开心',
    url: '/assets/stickers/开心/a.gif',
  })));

  const value = {
    list: () => [{
      manifest: { id: 'stickers' },
      available: true,
      installed: options.installed ?? true,
      enabled: options.enabled ?? true,
      config: {
        frequency: 'often',
        minGap: 2,
        ...(options.config ?? {}),
      },
      health: { status: 'ok', checkedAt: '2026-10-25T00:00:00.000Z' },
      lastError: null,
    }],
    invoke,
  };

  return { registry: value as unknown as PluginRegistry, invoke };
}

describe('sticker picker', () => {
  it('picks a sticker when the plugin is enabled and nothing was sent recently', async () => {
    const { registry: plugins, invoke } = registry({});
    const picker = createStickerPicker({ plugins, random: () => 0 });

    await expect(picker.pick({
      emotion: 'happy',
      text: '今天好开心',
      recent: [message('1'), message('2')],
    })).resolves.toEqual({
      id: '开心/a.gif',
      name: '开心',
      url: '/assets/stickers/开心/a.gif',
    });
    expect(invoke).toHaveBeenCalledWith('stickers', 'pick', expect.objectContaining({
      emotion: 'happy',
      text: '今天好开心',
    }));
  });

  it('skips when the plugin is missing or disabled', async () => {
    const missing = createStickerPicker({ plugins: registry({ installed: false }).registry });
    const disabled = createStickerPicker({ plugins: registry({ enabled: false }).registry });

    await expect(missing.pick({ text: 'hi' })).resolves.toBeNull();
    await expect(disabled.pick({ text: 'hi' })).resolves.toBeNull();
  });

  it('respects the minimum gap between stickers', async () => {
    const { registry: plugins, invoke } = registry({});
    const picker = createStickerPicker({ plugins, random: () => 0 });

    await expect(picker.pick({
      text: 'hi',
      recent: [message('1'), message('2', { id: 'x', name: 'x', url: '/assets/x.gif' })],
    })).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('drops stickers that point outside the local asset route', async () => {
    const { registry: plugins } = registry({
      invoke: async () => ({ id: 'remote', name: 'remote', url: 'https://evil.test/a.gif' }),
    });
    const picker = createStickerPicker({ plugins, random: () => 0 });

    await expect(picker.pick({ text: 'hi' })).resolves.toBeNull();
  });

  it('stays silent when the plugin throws', async () => {
    const { registry: plugins } = registry({
      invoke: async () => {
        throw new Error('directory missing');
      },
    });
    const picker = createStickerPicker({ plugins, random: () => 0 });

    await expect(picker.pick({ text: 'hi' })).resolves.toBeNull();
  });
});
