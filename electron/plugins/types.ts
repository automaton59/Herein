export type PluginKind = 'source' | 'channel' | 'tool' | 'agent';

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
  kind: PluginKind;
  description?: string;
  entry: string;
  permissions: PluginPermission[];
  configSchema?: PluginConfigSchema;
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

export interface PluginContext {
  pluginId: string;
  config: Record<string, unknown>;
  fetch: typeof fetch;
  now: () => Date;
  log: (level: PluginLogLevel, message: string, detail?: unknown) => void;
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
