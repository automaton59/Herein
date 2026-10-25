export type PluginKind = 'source' | 'channel' | 'tool' | 'agent';

/**
 * Bumped only when the `PluginContext` surface or the event payloads change in a
 * way that breaks existing plugins. A plugin declares the version it was written
 * against; the host refuses to load a newer contract instead of failing at call
 * time with an unreadable TypeError.
 */
export const PLUGIN_API_VERSION = 1;

export type PluginPermissionKind =
  | 'network'
  | 'credentials'
  | 'send'
  | 'install'
  | 'filesystem';

export interface PluginPermission {
  kind: PluginPermissionKind;
  /** For network permissions this is a hostname or a `*.example.com` suffix. */
  value?: string;
  reason?: string;
}

export type PluginConfigPropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array';

export interface PluginConfigProperty {
  type: PluginConfigPropertyType;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  /** Placeholder shown in the settings form. */
  placeholder?: string;
  /**
   * Hint for the settings form. `password` masks the value, `path` renders a
   * file picker button next to the input.
   */
  format?: 'text' | 'password' | 'url' | 'path' | 'directory';
  /** Sample values shown as chips under the field. */
  examples?: string[];
  /** Link to the setup documentation for this field. */
  helpUrl?: string;
}

export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Plugin contract version this manifest was written against. */
  apiVersion: number;
  kind: PluginKind;
  description?: string;
  entry: string;
  permissions: PluginPermission[];
  configSchema?: PluginConfigSchema;
  /** Short manual-setup instructions rendered in the plugin card. */
  setup?: string;
  /** Link to this plugin's section in the setup documentation. */
  helpUrl?: string;
}

export type PluginHealthStatus = 'ok' | 'degraded' | 'failed' | 'unknown';

export interface PluginHealth {
  status: PluginHealthStatus;
  message?: string;
  checkedAt: string;
  lastSuccessAt?: string;
  latencyMs?: number;
}

export type PluginLogLevel = 'info' | 'warn' | 'error';

/**
 * Events a plugin may push to the Core. This is the only outbound channel: a
 * plugin reports what it observed or received, and the Core decides whether and
 * how to persist it. Plugins never get a database handle.
 */
export type PluginEventType = 'observation' | 'channel.message';

export interface PluginEvent {
  type: PluginEventType;
  /** Shape is validated by the Core per `type`; unknown fields are ignored. */
  payload: Record<string, unknown>;
}

export interface PluginContext {
  pluginId: string;
  config: Record<string, unknown>;
  fetch: typeof fetch;
  now: () => Date;
  log: (level: PluginLogLevel, message: string, detail?: unknown) => void;
  /**
   * Local directories served by Core at `/assets/<relative-path>`, in priority
   * order. Plugins that read local files should resolve them under one of these
   * roots so the returned URLs actually work in the UI.
   */
  assetsDirs?: string[];
  /** The user data directory (SQLite database and runtime files live here). */
  dataDir?: string;
  /**
   * Push an event to the Core. Resolves once the Core has handled it, so a
   * plugin can await delivery before acknowledging the upstream protocol.
   */
  emit: (event: PluginEvent) => Promise<void>;
  /**
   * Load a module shipped with the application (an adapter package, the core
   * package) by a path relative to the app root. Paths may not escape the root.
   */
  loadModule: (relativePath: string) => Promise<unknown>;
}

export interface PluginInstance {
  start?: (context: PluginContext) => Promise<void> | void;
  stop?: (context: PluginContext) => Promise<void> | void;
  health?: (context: PluginContext) => Promise<PluginHealth> | PluginHealth;
  invoke?: (
    action: string,
    input: unknown,
    context: PluginContext,
  ) => Promise<unknown>;
}

export interface PluginModule {
  createPlugin?: () => Promise<PluginInstance> | PluginInstance;
  default?:
    | PluginInstance
    | (() => Promise<PluginInstance> | PluginInstance)
    | { createPlugin?: () => Promise<PluginInstance> | PluginInstance };
}

export interface PluginView {
  manifest: PluginManifest;
  available: boolean;
  installed: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  health: PluginHealth;
  lastError: string | null;
  installedAt?: string | null;
  updatedAt?: string | null;
}

export interface PluginSummary {
  total: number;
  installed: number;
  enabled: number;
  healthy: number;
  degraded: number;
  failed: number;
}

export interface PluginAuditRecord {
  id: string;
  pluginId: string;
  action: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export type PluginErrorCode =
  | 'invalid_manifest'
  | 'invalid_config'
  | 'not_found'
  | 'not_installed'
  | 'disabled'
  | 'permission_denied'
  | 'plugin_failed';

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  readonly status: number;

  constructor(code: PluginErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.status = status;
  }
}
