import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Phase2Database } from '../data/database';
import { discoverPlugins, loadPluginInstance, type DiscoveredPlugin } from './loader';
import { defaultPluginConfig, validatePluginConfig, validatePluginManifest } from './manifest';
import {
  PLUGIN_API_VERSION,
  PluginError,
  type PluginAuditRecord,
  type PluginContext,
  type PluginEvent,
  type PluginHealth,
  type PluginHealthStatus,
  type PluginInstance,
  type PluginLogLevel,
  type PluginManifest,
  type PluginSummary,
  type PluginView,
} from './types';

export interface PluginLogger {
  info: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  error: (message: string, detail?: unknown) => void;
}

export interface PluginRegistryOptions {
  db: Phase2Database;
  pluginsDir: string | string[];
  /** Asset roots served at `/assets/<rel>`; forwarded to plugins as `ctx.assetsDirs`. */
  assetsDirs?: string[];
  /** User data directory; forwarded to plugins as `ctx.dataDir`. */
  dataDir?: string;
  /**
   * Application root used by `ctx.loadModule()`. In a packaged build this is the
   * asar path, so bundled adapters and the core package stay importable.
   */
  appRoot?: string;
  /** Test seam: modules served by `ctx.loadModule()` before touching the disk. */
  bundledModules?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logger?: PluginLogger;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
}

/** Receives every event a plugin pushes through `ctx.emit()`. */
export type PluginEventSink = (pluginId: string, event: PluginEvent) => Promise<void> | void;

interface PluginRow {
  plugin_id: string;
  manifest_json: string;
  config_json: string;
  enabled: number;
  health_json: string;
  installed_at: string;
  updated_at: string;
}

interface LoadedPlugin {
  instance: PluginInstance;
  context: PluginContext;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2500;
const DEFAULT_START_TIMEOUT_MS = 30000;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isHealthStatus(value: unknown): value is PluginHealthStatus {
  return value === 'ok' || value === 'degraded' || value === 'failed' || value === 'unknown';
}

function normalizeHealth(value: PluginHealth | undefined, now: string): PluginHealth {
  if (!value || !isHealthStatus(value.status)) {
    return { status: 'unknown', checkedAt: now };
  }

  return {
    ...value,
    checkedAt: value.checkedAt || now,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function hostMatches(hostname: string, permission: string | undefined) {
  if (!permission || permission === '*') {
    return true;
  }

  const normalized = permission.toLowerCase();
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

export class PluginRegistry {
  private readonly db: Phase2Database;
  private readonly pluginsDirs: string[];
  private readonly assetsDirs: string[];
  private readonly dataDir: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly logger: PluginLogger;
  private readonly healthTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly appRoot: string | undefined;
  private readonly bundledModules: Record<string, unknown> | undefined;
  private eventSink: PluginEventSink | undefined;
  private readonly discovered = new Map<string, DiscoveredPlugin>();
  private readonly builtins = new Map<string, DiscoveredPlugin>();
  private readonly loaded = new Map<string, LoadedPlugin>();
  private readonly health = new Map<string, PluginHealth>();

  constructor(options: PluginRegistryOptions) {
    this.db = options.db;
    this.pluginsDirs = (Array.isArray(options.pluginsDir) ? options.pluginsDir : [options.pluginsDir])
      .map(dir => path.resolve(dir));
    this.assetsDirs = (options.assetsDirs ?? [])
      .filter(dir => Boolean(dir && dir.trim()))
      .map(dir => path.resolve(dir));
    this.dataDir = options.dataDir ? path.resolve(options.dataDir) : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? {
      info: (message, detail) => console.log(message, detail ?? ''),
      warn: (message, detail) => console.warn(message, detail ?? ''),
      error: (message, detail) => console.error(message, detail ?? ''),
    };
    this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.appRoot = options.appRoot ? path.resolve(options.appRoot) : undefined;
    this.bundledModules = options.bundledModules;
  }

  /**
   * Wires the Core-side handler for `ctx.emit()`. Optional: without a sink a
   * plugin that calls `emit` fails loudly rather than dropping events.
   */
  setEventSink(sink: PluginEventSink | undefined) {
    this.eventSink = sink;
  }

  async initialize() {
    await this.refreshDiscovered();

    for (const row of this.rows()) {
      this.health.set(
        row.plugin_id,
        normalizeHealth(parseJson<PluginHealth | undefined>(row.health_json, undefined), this.nowIso()),
      );

      if (row.enabled !== 1) {
        continue;
      }

      try {
        await this.start(row.plugin_id, row);
      } catch (error) {
        this.markFailed(row.plugin_id, error);
        this.logger.error(`plugin failed to start: ${row.plugin_id}`, error);
      }
    }
  }

  registerBuiltin(
    manifest: PluginManifest,
    create: () => Promise<PluginInstance> | PluginInstance,
  ): PluginManifest {
    const normalized = validatePluginManifest(manifest);
    this.builtins.set(normalized.id, {
      manifest: normalized,
      create,
    });

    return normalized;
  }

  async close() {
    for (const [pluginId] of this.loaded) {
      await this.stopLoaded(pluginId);
    }
  }

  async refreshDiscovered() {
    try {
      const discovered: DiscoveredPlugin[] = [];

      for (const dir of this.pluginsDirs) {
        discovered.push(...await discoverPlugins(dir));
      }

      this.discovered.clear();

      for (const plugin of discovered) {
        this.discovered.set(plugin.manifest.id, plugin);
      }
    } catch (error) {
      this.logger.warn('cannot scan plugins directory', error);
    }
  }

  list(): PluginView[] {
    const views = new Map<string, PluginView>();

    for (const row of this.rows()) {
      views.set(row.plugin_id, this.viewFromRow(row));
    }

    for (const [pluginId, plugin] of this.availablePlugins()) {
      if (views.has(pluginId)) {
        continue;
      }

      const health = this.health.get(pluginId)
        ?? { status: 'unknown' as PluginHealthStatus, checkedAt: this.nowIso() };

      views.set(pluginId, {
        manifest: plugin.manifest,
        available: true,
        installed: false,
        enabled: false,
        config: defaultPluginConfig(plugin.manifest),
        health,
        lastError: health.status === 'failed' ? health.message ?? null : null,
        installedAt: null,
        updatedAt: null,
      });
    }

    return [...views.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
  }

  get(pluginId: string): PluginView | null {
    return this.list().find(plugin => plugin.manifest.id === pluginId) ?? null;
  }

  audit(limit = 100): PluginAuditRecord[] {
    const rows = this.db
      .prepare(`
        select id, plugin_id, action, status, detail_json, created_at
        from plugin_audit
        order by created_at desc, id desc
        limit ?
      `)
      .all(Math.max(1, Math.min(500, limit))) as Array<{
        id: string;
        plugin_id: string;
        action: string;
        status: string;
        detail_json: string;
        created_at: string;
      }>;

    return rows.map(row => ({
      id: row.id,
      pluginId: row.plugin_id,
      action: row.action,
      status: row.status,
      detail: parseJson<Record<string, unknown>>(row.detail_json, {}),
      createdAt: row.created_at,
    }));
  }

  async install(pluginId: string): Promise<PluginView> {
    const discovered = this.requireDiscovered(pluginId);
    const existing = this.getRow(pluginId);

    if (existing) {
      return this.viewFromRow(existing);
    }

    const timestamp = this.nowIso();
    const config = defaultPluginConfig(discovered.manifest);
    const health: PluginHealth = { status: 'unknown', checkedAt: timestamp };

    this.db
      .prepare(`
        insert into plugin_registry (
          plugin_id, manifest_json, config_json, enabled, health_json, installed_at, updated_at
        )
        values (?, ?, ?, 0, ?, ?, ?)
      `)
      .run(
        pluginId,
        JSON.stringify(discovered.manifest),
        JSON.stringify(config),
        JSON.stringify(health),
        timestamp,
        timestamp,
      );

    this.health.set(pluginId, health);
    this.recordAudit(pluginId, 'install', 'ok', { version: discovered.manifest.version });

    return this.get(pluginId) as PluginView;
  }

  async enable(pluginId: string): Promise<PluginView> {
    const row = this.requireRow(pluginId);

    if (row.enabled === 1) {
      return this.viewFromRow(row);
    }

    try {
      await this.start(pluginId, row);
      const plugin = this.get(pluginId) as PluginView;
      this.recordAudit(
        pluginId,
        'enable',
        plugin.health.status === 'ok' ? 'ok' : plugin.health.status,
      );
      return plugin;
    } catch (error) {
      this.markFailed(pluginId, error);
      this.recordAudit(pluginId, 'enable', 'failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof PluginError
        ? error
        : new PluginError('plugin_failed', error instanceof Error ? error.message : String(error), 500);
    }
  }

  async disable(pluginId: string): Promise<PluginView> {
    const row = this.requireRow(pluginId);

    await this.stopLoaded(pluginId);

    this.db
      .prepare('update plugin_registry set enabled = 0, updated_at = ? where plugin_id = ?')
      .run(this.nowIso(), pluginId);

    this.recordAudit(pluginId, 'disable', 'ok');

    return this.get(pluginId) as PluginView;
  }

  async remove(pluginId: string): Promise<{ removed: boolean }> {
    const row = this.requireRow(pluginId);
    await this.stopLoaded(pluginId);

    this.db.prepare('delete from plugin_registry where plugin_id = ?').run(pluginId);
    this.health.delete(pluginId);
    this.recordAudit(pluginId, 'remove', 'ok', { manifest: row.manifest_json ? 'kept-in-audit-only' : undefined });

    return { removed: true };
  }

  async updateConfig(pluginId: string, rawConfig: unknown): Promise<PluginView> {
    const row = this.requireRow(pluginId);
    const discovered = this.requireDiscovered(pluginId);
    const config = validatePluginConfig(discovered.manifest, rawConfig);

    this.db
      .prepare('update plugin_registry set config_json = ?, updated_at = ? where plugin_id = ?')
      .run(JSON.stringify(config), this.nowIso(), pluginId);

    this.recordAudit(pluginId, 'config', 'ok', { keys: Object.keys(config) });

    if (row.enabled === 1) {
      await this.stopLoaded(pluginId);
      const updatedRow = this.requireRow(pluginId);

      try {
        await this.start(pluginId, updatedRow);
      } catch (error) {
        this.db
          .prepare('update plugin_registry set enabled = 0, updated_at = ? where plugin_id = ?')
          .run(this.nowIso(), pluginId);
        this.markFailed(pluginId, error);
        this.recordAudit(pluginId, 'restart', 'failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return this.get(pluginId) as PluginView;
  }

  async invoke(pluginId: string, action: string, input: unknown): Promise<unknown> {
    const row = this.requireRow(pluginId);

    if (row.enabled !== 1) {
      throw new PluginError('disabled', `plugin is disabled: ${pluginId}`, 409);
    }

    let loaded = this.loaded.get(pluginId);

    if (!loaded) {
      await this.start(pluginId, row);
      loaded = this.loaded.get(pluginId);
    }

    if (!loaded?.instance.invoke) {
      throw new PluginError('plugin_failed', `plugin has no invoke(): ${pluginId}`, 400);
    }

    try {
      const result = await loaded.instance.invoke(action, input, loaded.context);
      this.updateHealth(pluginId, {
        status: 'ok',
        checkedAt: this.nowIso(),
        lastSuccessAt: this.nowIso(),
      });
      this.recordAudit(pluginId, `invoke:${action}`, 'ok');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateHealth(pluginId, {
        status: 'failed',
        message,
        checkedAt: this.nowIso(),
      });
      this.recordAudit(pluginId, `invoke:${action}`, 'failed', { message });
      throw error instanceof PluginError
        ? error
        : new PluginError('plugin_failed', message, 500);
    }
  }

  async checkHealth(pluginId: string): Promise<PluginHealth> {
    const row = this.requireRow(pluginId);

    if (row.enabled !== 1) {
      return this.health.get(pluginId) ?? { status: 'unknown', checkedAt: this.nowIso() };
    }

    const loaded = this.loaded.get(pluginId);

    if (!loaded) {
      return this.health.get(pluginId) ?? { status: 'unknown', checkedAt: this.nowIso() };
    }

    const startedAt = Date.now();

    try {
      const health = loaded.instance.health
        ? await withTimeout(
          Promise.resolve(loaded.instance.health(loaded.context)),
          this.healthTimeoutMs,
          `plugin health: ${pluginId}`,
        )
        : { status: 'ok' as const, checkedAt: this.nowIso() };
      const normalized = normalizeHealth(health, this.nowIso());
      normalized.latencyMs = Date.now() - startedAt;
      this.updateHealth(pluginId, normalized);
      return normalized;
    } catch (error) {
      const health: PluginHealth = {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        checkedAt: this.nowIso(),
        latencyMs: Date.now() - startedAt,
      };
      this.updateHealth(pluginId, health);
      return health;
    }
  }

  summary(): PluginSummary {
    const views = this.list().filter(plugin => plugin.installed);

    return {
      total: this.list().length,
      installed: views.length,
      enabled: views.filter(plugin => plugin.enabled).length,
      healthy: views.filter(plugin => plugin.health.status === 'ok').length,
      degraded: views.filter(plugin => plugin.health.status === 'degraded').length,
      failed: views.filter(plugin => plugin.health.status === 'failed').length,
    };
  }

  private async start(pluginId: string, row: PluginRow) {
    const discovered = this.requireDiscovered(pluginId);
    const config = validatePluginConfig(
      discovered.manifest,
      parseJson<Record<string, unknown>>(row.config_json, {}),
    );
    const existing = this.loaded.get(pluginId);

    if (existing) {
      await this.stopLoaded(pluginId);
    }

    const instance = discovered.create
      ? await discovered.create()
      : discovered.dir
        ? await loadPluginInstance(discovered.dir, discovered.manifest)
        : (() => {
          throw new PluginError('plugin_failed', `plugin has no loadable entry: ${pluginId}`, 500);
        })();
    const context = this.createContext(discovered.manifest, config);

    if (instance.start) {
      await withTimeout(
        Promise.resolve(instance.start(context)),
        this.startTimeoutMs,
        `plugin start: ${pluginId}`,
      );
    }

    this.loaded.set(pluginId, { instance, context });

    const timestamp = this.nowIso();
    const healthStartedAt = Date.now();
    let health: PluginHealth = {
      status: 'ok',
      checkedAt: timestamp,
      lastSuccessAt: timestamp,
    };

    if (instance.health) {
      try {
        health = normalizeHealth(
          await withTimeout(
            Promise.resolve(instance.health(context)),
            this.healthTimeoutMs,
            `plugin health: ${pluginId}`,
          ),
          timestamp,
        );
        health.latencyMs = Date.now() - healthStartedAt;
      } catch (error) {
        health = {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
          checkedAt: timestamp,
          latencyMs: Date.now() - healthStartedAt,
        };
      }
    }

    this.db
      .prepare(`
        update plugin_registry
        set enabled = 1, health_json = ?, updated_at = ?
        where plugin_id = ?
      `)
      .run(JSON.stringify(health), timestamp, pluginId);

    this.health.set(pluginId, health);
  }

  private async stopLoaded(pluginId: string) {
    const loaded = this.loaded.get(pluginId);

    if (!loaded) {
      return;
    }

    this.loaded.delete(pluginId);

    if (loaded.instance.stop) {
      try {
        await withTimeout(
          Promise.resolve(loaded.instance.stop(loaded.context)),
          this.healthTimeoutMs,
          `plugin stop: ${pluginId}`,
        );
      } catch (error) {
        this.logger.warn(`plugin stop failed: ${pluginId}`, error);
      }
    }
  }

  private createContext(manifest: PluginManifest, config: Record<string, unknown>): PluginContext {
    return {
      pluginId: manifest.id,
      config,
      fetch: this.createPermissionedFetch(manifest),
      now: this.now,
      assetsDirs: [...this.assetsDirs],
      ...(this.dataDir ? { dataDir: this.dataDir } : {}),
      emit: event => this.emitFromPlugin(manifest.id, event),
      loadModule: relativePath => this.loadBundledModule(relativePath),
      log: (level: PluginLogLevel, message: string, detail?: unknown) => {
        const target = level === 'error'
          ? this.logger.error
          : level === 'warn'
            ? this.logger.warn
            : this.logger.info;
        target(`[plugin:${manifest.id}] ${message}`, detail);
      },
    };
  }

  private async emitFromPlugin(pluginId: string, event: PluginEvent): Promise<void> {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || !event.payload) {
      throw new PluginError('plugin_failed', `plugin ${pluginId} emitted an invalid event`, 500);
    }

    if (!this.eventSink) {
      throw new PluginError(
        'plugin_failed',
        `plugin ${pluginId} emitted "${event.type}" but no event sink is configured`,
        500,
      );
    }

    try {
      await this.eventSink(pluginId, event);
    } catch (error) {
      this.recordAudit(pluginId, `emit:${event.type}`, 'failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Loads a module that ships with the application. This is how a plugin reaches
   * an adapter or the core package without receiving internal objects: the path
   * is resolved against the app root and may not escape it.
   */
  private async loadBundledModule(relativePath: string): Promise<unknown> {
    const normalized = String(relativePath ?? '').replace(/\\/g, '/').trim();

    if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      throw new PluginError('permission_denied', `module path must be relative: ${relativePath}`, 403);
    }

    if (normalized.split('/').some(part => part === '..' || part === '')) {
      throw new PluginError('permission_denied', `module path may not contain "..": ${relativePath}`, 403);
    }

    const bundled = this.bundledModules?.[normalized];

    if (bundled !== undefined) {
      return bundled;
    }

    if (!this.appRoot) {
      throw new PluginError('plugin_failed', 'app root is not configured; cannot load bundled modules', 500);
    }

    const resolved = path.resolve(this.appRoot, normalized);

    if (resolved !== this.appRoot && !resolved.startsWith(`${this.appRoot}${path.sep}`)) {
      throw new PluginError('permission_denied', `module path escapes the app root: ${relativePath}`, 403);
    }

    try {
      return await import(pathToFileURL(resolved).href);
    } catch (error) {
      throw new PluginError(
        'plugin_failed',
        `cannot load bundled module ${normalized}: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }

  private createPermissionedFetch(manifest: PluginManifest): typeof fetch {
    const networkPermissions = manifest.permissions
      .filter(permission => permission.kind === 'network')
      .map(permission => permission.value);

    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = requestUrl(input);
      let hostname: string;

      try {
        hostname = new URL(rawUrl).hostname.toLowerCase();
      } catch {
        throw new PluginError('permission_denied', `invalid network URL: ${rawUrl}`, 403);
      }

      if (!networkPermissions.some(permission => hostMatches(hostname, permission))) {
        this.recordAudit(manifest.id, 'network', 'denied', { hostname });
        throw new PluginError(
          'permission_denied',
          `network permission denied for ${hostname}`,
          403,
        );
      }

      return this.fetchImpl(input, init);
    }) as typeof fetch;
  }

  private rows(): PluginRow[] {
    return this.db
      .prepare('select * from plugin_registry order by plugin_id asc')
      .all() as PluginRow[];
  }

  private getRow(pluginId: string): PluginRow | undefined {
    return this.db
      .prepare('select * from plugin_registry where plugin_id = ?')
      .get(pluginId) as PluginRow | undefined;
  }

  private requireRow(pluginId: string): PluginRow {
    const row = this.getRow(pluginId);

    if (!row) {
      throw new PluginError('not_installed', `plugin is not installed: ${pluginId}`, 404);
    }

    return row;
  }

  private requireDiscovered(pluginId: string): DiscoveredPlugin {
    const plugin = this.builtins.get(pluginId) ?? this.discovered.get(pluginId);

    if (!plugin) {
      throw new PluginError('not_found', `plugin not found: ${pluginId}`, 404);
    }

    return plugin;
  }

  private availablePlugins(): Map<string, DiscoveredPlugin> {
    return new Map([...this.builtins, ...this.discovered]);
  }

  private viewFromRow(row: PluginRow): PluginView {
    const discovered = this.builtins.get(row.plugin_id) ?? this.discovered.get(row.plugin_id);
    const storedManifest = parseJson<PluginManifest | null>(row.manifest_json, null);
    const manifest = discovered?.manifest
      ?? storedManifest
      ?? {
        id: row.plugin_id,
        name: row.plugin_id,
        version: 'unknown',
        apiVersion: PLUGIN_API_VERSION,
        kind: 'tool' as const,
        entry: '',
        permissions: [],
      };

    const health = this.health.get(row.plugin_id)
      ?? normalizeHealth(parseJson<PluginHealth | undefined>(row.health_json, undefined), this.nowIso());

    return {
      manifest,
      available: Boolean(discovered),
      installed: true,
      enabled: row.enabled === 1,
      config: parseJson<Record<string, unknown>>(row.config_json, {}),
      health,
      lastError: health.status === 'failed' ? health.message ?? null : null,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    };
  }

  private updateHealth(pluginId: string, health: PluginHealth) {
    this.health.set(pluginId, health);
    this.db
      .prepare('update plugin_registry set health_json = ?, updated_at = ? where plugin_id = ?')
      .run(JSON.stringify(health), this.nowIso(), pluginId);
  }

  private markFailed(pluginId: string, error: unknown) {
    this.updateHealth(pluginId, {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      checkedAt: this.nowIso(),
    });
  }

  private recordAudit(
    pluginId: string,
    action: string,
    status: string,
    detail: Record<string, unknown> = {},
  ): PluginAuditRecord {
    const record: PluginAuditRecord = {
      id: randomUUID(),
      pluginId,
      action,
      status,
      detail,
      createdAt: this.nowIso(),
    };

    this.db
      .prepare(`
        insert into plugin_audit (id, plugin_id, action, status, detail_json, created_at)
        values (?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.pluginId,
        record.action,
        record.status,
        JSON.stringify(record.detail),
        record.createdAt,
      );

    return record;
  }

  private nowIso() {
    return this.now().toISOString();
  }
}
