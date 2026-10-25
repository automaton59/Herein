/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { validatePluginConfig, validatePluginManifest } from './manifest';

const base = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  kind: 'tool',
  entry: 'index.mjs',
  permissions: [{ kind: 'filesystem', value: 'assets/demo' }],
};

describe('plugin manifest', () => {
  it('keeps setup/helpUrl and the optional config hints', () => {
    const manifest = validatePluginManifest({
      ...base,
      description: 'demo plugin',
      setup: '把文件放进 data/demo 即可',
      helpUrl: 'docs/PLUGIN-SETUP.md#demo',
      configSchema: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            title: '目录',
            description: '留空用默认目录',
            placeholder: 'D:\\demo',
            format: 'directory',
            examples: ['D:\\demo'],
            helpUrl: 'https://example.com/demo',
          },
          token: {
            type: 'string',
            title: 'Token',
            format: 'password',
          },
        },
        required: ['token'],
        additionalProperties: false,
      },
    });

    expect(manifest.setup).toBe('把文件放进 data/demo 即可');
    expect(manifest.helpUrl).toBe('docs/PLUGIN-SETUP.md#demo');
    expect(manifest.configSchema?.properties.dir).toEqual(expect.objectContaining({
      format: 'directory',
      placeholder: 'D:\\demo',
      examples: ['D:\\demo'],
      helpUrl: 'https://example.com/demo',
    }));
    expect(manifest.configSchema?.required).toEqual(['token']);
  });

  it('rejects an unknown config format', () => {
    expect(() => validatePluginManifest({
      ...base,
      configSchema: {
        type: 'object',
        properties: {
          bad: { type: 'string', format: 'yaml' },
        },
      },
    })).toThrow(/format/);
  });

  it('fills config defaults and enforces required fields', () => {
    const manifest = validatePluginManifest({
      ...base,
      configSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', default: 'normal', enum: ['rare', 'normal'] },
          token: { type: 'string' },
        },
        required: ['token'],
      },
    });

    expect(validatePluginConfig(manifest, { token: 'x' })).toEqual({ mode: 'normal', token: 'x' });
    expect(() => validatePluginConfig(manifest, { mode: 'normal' })).toThrow(/token is required/);
    expect(() => validatePluginConfig(manifest, { token: 'x', mode: 'wild' })).toThrow(/one of/);
  });
});
