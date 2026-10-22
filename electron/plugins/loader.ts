import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolvePluginEntry,
  validatePluginManifest,
} from './manifest';
import {
  PluginError,
  type PluginInstance,
  type PluginManifest,
  type PluginModule,
} from './types';

export interface DiscoveredPlugin {
  dir?: string;
  manifest: PluginManifest;
  create?: () => Promise<PluginInstance> | PluginInstance;
}

async function isDirectory(target: string) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function readPluginManifest(pluginDir: string): Promise<PluginManifest> {
  const manifestPath = path.join(pluginDir, 'plugin.json');

  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new PluginError(
      'invalid_manifest',
      `cannot read ${manifestPath}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  return validatePluginManifest(raw);
}

export async function discoverPlugins(pluginsDir: string): Promise<DiscoveredPlugin[]> {
  if (!(await isDirectory(pluginsDir))) {
    return [];
  }

  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const discovered: DiscoveredPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = path.join(pluginsDir, entry.name);

    try {
      discovered.push({ dir, manifest: await readPluginManifest(dir) });
    } catch (error) {
      console.warn(
        `plugin skipped: ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return discovered.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

function isPluginInstance(value: unknown): value is PluginInstance {
  return typeof value === 'object' && value !== null;
}

export async function loadPluginInstance(
  pluginDir: string,
  manifest: PluginManifest,
): Promise<PluginInstance> {
  const entryPath = resolvePluginEntry(pluginDir, manifest.entry);
  let module: PluginModule;

  try {
    module = await import(pathToFileURL(entryPath).href) as PluginModule;
  } catch (error) {
    throw new PluginError(
      'plugin_failed',
      `cannot import plugin entry: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }

  const defaultExport = module.default;
  const factory = typeof module.createPlugin === 'function'
    ? module.createPlugin
    : typeof defaultExport === 'function'
      ? defaultExport
      : defaultExport
        && typeof defaultExport === 'object'
        && 'createPlugin' in defaultExport
        && typeof defaultExport.createPlugin === 'function'
        ? defaultExport.createPlugin
        : undefined;

  if (!factory) {
    throw new PluginError('plugin_failed', 'plugin entry must export createPlugin()', 500);
  }

  let instance: unknown;

  try {
    instance = await factory();
  } catch (error) {
    throw new PluginError(
      'plugin_failed',
      `createPlugin() failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }

  if (!isPluginInstance(instance)) {
    throw new PluginError('plugin_failed', 'createPlugin() must return an object', 500);
  }

  return instance;
}
