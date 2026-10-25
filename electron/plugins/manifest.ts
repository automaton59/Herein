import path from 'node:path';
import {
  PLUGIN_API_VERSION,
  PluginError,
  type PluginConfigProperty,
  type PluginConfigSchema,
  type PluginKind,
  type PluginManifest,
  type PluginPermission,
  type PluginPermissionKind,
} from './types';

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const PLUGIN_KINDS: PluginKind[] = ['source', 'channel', 'tool', 'agent'];
const PERMISSION_KINDS: PluginPermissionKind[] = [
  'network',
  'credentials',
  'send',
  'install',
  'filesystem',
];
const CONFIG_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
const CONFIG_FORMATS = ['text', 'password', 'url', 'path', 'directory'] as const;

function asHelpUrl(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginError('invalid_manifest', `${field} must be a non-empty string`);
  }

  const trimmed = value.trim();

  // Docs links may be relative (e.g. `docs/PLUGIN-SETUP.md#dsh`) so they keep
  // working in a cloned repository.
  if (!/^https?:\/\//i.test(trimmed) && !/^[a-zA-Z0-9._~\-/]+(#[a-zA-Z0-9._~\-]+)?$/.test(trimmed)) {
    throw new PluginError('invalid_manifest', `${field} must be an http(s) URL or a relative path`);
  }

  return trimmed;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginError('invalid_manifest', `${field} must be a non-empty string`);
  }

  return value.trim();
}

function parsePermission(value: unknown, index: number): PluginPermission {
  if (!isRecord(value)) {
    throw new PluginError('invalid_manifest', `permissions[${index}] must be an object`);
  }

  const kind = value.kind;

  if (typeof kind !== 'string' || !PERMISSION_KINDS.includes(kind as PluginPermissionKind)) {
    throw new PluginError(
      'invalid_manifest',
      `permissions[${index}].kind must be one of ${PERMISSION_KINDS.join(', ')}`,
    );
  }

  const permission: PluginPermission = { kind: kind as PluginPermissionKind };

  if (value.value !== undefined) {
    permission.value = asNonEmptyString(value.value, `permissions[${index}].value`);
  }

  if (value.reason !== undefined) {
    permission.reason = asNonEmptyString(value.reason, `permissions[${index}].reason`);
  }

  if (permission.kind === 'network' && !permission.value) {
    throw new PluginError('invalid_manifest', `permissions[${index}] network permission needs a value`);
  }

  return permission;
}

function isConfigFormat(value: unknown): value is NonNullable<PluginConfigProperty['format']> {
  return typeof value === 'string' && (CONFIG_FORMATS as readonly string[]).includes(value);
}

function parseConfigProperty(value: unknown, key: string): PluginConfigProperty {
  if (!isRecord(value)) {
    throw new PluginError('invalid_manifest', `configSchema.properties.${key} must be an object`);
  }

  const type = value.type;

  if (typeof type !== 'string' || !CONFIG_TYPES.includes(type as PluginConfigProperty['type'])) {
    throw new PluginError(
      'invalid_manifest',
      `configSchema.properties.${key}.type must be one of ${CONFIG_TYPES.join(', ')}`,
    );
  }

  const property: PluginConfigProperty = { type: type as PluginConfigProperty['type'] };

  if (value.title !== undefined) {
    property.title = asNonEmptyString(value.title, `configSchema.properties.${key}.title`);
  }

  if (value.description !== undefined) {
    property.description = asNonEmptyString(value.description, `configSchema.properties.${key}.description`);
  }

  if (value.default !== undefined) {
    property.default = value.default;
  }

  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.some(item => typeof item !== 'string' && typeof item !== 'number')) {
      throw new PluginError('invalid_manifest', `configSchema.properties.${key}.enum must be string/number values`);
    }

    property.enum = value.enum as Array<string | number>;
  }

  if (value.minimum !== undefined) {
    if (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum)) {
      throw new PluginError('invalid_manifest', `configSchema.properties.${key}.minimum must be a number`);
    }

    property.minimum = value.minimum;
  }

  if (value.maximum !== undefined) {
    if (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum)) {
      throw new PluginError('invalid_manifest', `configSchema.properties.${key}.maximum must be a number`);
    }

    property.maximum = value.maximum;
  }

  if (value.placeholder !== undefined) {
    property.placeholder = asNonEmptyString(value.placeholder, `configSchema.properties.${key}.placeholder`);
  }

  if (value.format !== undefined) {
    if (!isConfigFormat(value.format)) {
      throw new PluginError(
        'invalid_manifest',
        `configSchema.properties.${key}.format must be one of ${CONFIG_FORMATS.join(', ')}`,
      );
    }

    property.format = value.format;
  }

  if (value.examples !== undefined) {
    if (!Array.isArray(value.examples)) {
      throw new PluginError('invalid_manifest', `configSchema.properties.${key}.examples must be an array of strings`);
    }

    property.examples = value.examples.map((example, index) => (
      asNonEmptyString(example, `configSchema.properties.${key}.examples[${index}]`)
    ));
  }

  if (value.helpUrl !== undefined) {
    property.helpUrl = asHelpUrl(value.helpUrl, `configSchema.properties.${key}.helpUrl`);
  }

  return property;
}

function parseConfigSchema(value: unknown): PluginConfigSchema | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value) || value.type !== 'object') {
    throw new PluginError('invalid_manifest', 'configSchema must be an object schema');
  }

  if (!isRecord(value.properties)) {
    throw new PluginError('invalid_manifest', 'configSchema.properties must be an object');
  }

  const properties: Record<string, PluginConfigProperty> = {};

  for (const [key, property] of Object.entries(value.properties)) {
    properties[key] = parseConfigProperty(property, key);
  }

  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some(item => typeof item !== 'string')) {
      throw new PluginError('invalid_manifest', 'configSchema.required must be an array of strings');
    }
  }

  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') {
    throw new PluginError('invalid_manifest', 'configSchema.additionalProperties must be a boolean');
  }

  return {
    type: 'object',
    properties,
    ...(value.required ? { required: value.required as string[] } : {}),
    ...(typeof value.additionalProperties === 'boolean'
      ? { additionalProperties: value.additionalProperties }
      : {}),
  };
}

export function validatePluginManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) {
    throw new PluginError('invalid_manifest', 'plugin manifest must be an object');
  }

  const id = asNonEmptyString(raw.id, 'id');

  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new PluginError('invalid_manifest', 'id must match ^[a-z0-9][a-z0-9._-]{1,63}$');
  }

  const name = asNonEmptyString(raw.name, 'name');
  const version = asNonEmptyString(raw.version, 'version');
  const kind = asNonEmptyString(raw.kind, 'kind');

  const apiVersion = raw.apiVersion === undefined ? PLUGIN_API_VERSION : Number(raw.apiVersion);

  if (!Number.isInteger(apiVersion) || apiVersion < 1) {
    throw new PluginError('invalid_manifest', 'apiVersion must be a positive integer');
  }

  if (apiVersion > PLUGIN_API_VERSION) {
    throw new PluginError(
      'invalid_manifest',
      `plugin requires plugin API v${apiVersion}, this build provides v${PLUGIN_API_VERSION};`
      + ' update Herein to use it',
    );
  }

  if (!PLUGIN_KINDS.includes(kind as PluginKind)) {
    throw new PluginError('invalid_manifest', `kind must be one of ${PLUGIN_KINDS.join(', ')}`);
  }

  const entry = asNonEmptyString(raw.entry, 'entry');

  if (path.isAbsolute(entry) || entry.includes('..')) {
    throw new PluginError('invalid_manifest', 'entry must be a relative path inside the plugin directory');
  }

  if (!/\.(js|mjs|cjs)$/i.test(entry)) {
    throw new PluginError('invalid_manifest', 'entry must be a JavaScript module (.js, .mjs or .cjs)');
  }

  if (!Array.isArray(raw.permissions)) {
    throw new PluginError('invalid_manifest', 'permissions must be an array');
  }

  const permissions = raw.permissions.map(parsePermission);

  return {
    id,
    name,
    version,
    apiVersion,
    kind: kind as PluginKind,
    ...(raw.description !== undefined
      ? { description: asNonEmptyString(raw.description, 'description') }
      : {}),
    entry,
    permissions,
    ...(raw.setup !== undefined ? { setup: asNonEmptyString(raw.setup, 'setup') } : {}),
    ...(raw.helpUrl !== undefined ? { helpUrl: asHelpUrl(raw.helpUrl, 'helpUrl') } : {}),
    ...(raw.configSchema !== undefined ? { configSchema: parseConfigSchema(raw.configSchema) } : {}),
  };
}

function typeMatches(type: PluginConfigProperty['type'], value: unknown) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      return false;
  }
}

export function defaultPluginConfig(manifest: PluginManifest): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  for (const [key, property] of Object.entries(manifest.configSchema?.properties ?? {})) {
    if (property.default !== undefined) {
      config[key] = property.default;
    }
  }

  return config;
}

export function validatePluginConfig(
  manifest: PluginManifest,
  raw: unknown,
): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    return defaultPluginConfig(manifest);
  }

  if (!isRecord(raw)) {
    throw new PluginError('invalid_config', 'config must be an object');
  }

  const schema = manifest.configSchema;

  if (!schema) {
    return { ...raw };
  }

  const config: Record<string, unknown> = {
    ...defaultPluginConfig(manifest),
    ...raw,
  };

  for (const [key, value] of Object.entries(config)) {
    const property = schema.properties[key];

    if (!property) {
      if (schema.additionalProperties !== true) {
        throw new PluginError('invalid_config', `unknown config key: ${key}`);
      }

      continue;
    }

    if (!typeMatches(property.type, value)) {
      throw new PluginError(
        'invalid_config',
        `config.${key} must be ${property.type}`,
      );
    }

    if (property.enum && !property.enum.includes(value as string | number)) {
      throw new PluginError(
        'invalid_config',
        `config.${key} must be one of ${property.enum.join(', ')}`,
      );
    }

    if (property.type === 'number') {
      const numberValue = value as number;

      if (property.minimum !== undefined && numberValue < property.minimum) {
        throw new PluginError('invalid_config', `config.${key} must be >= ${property.minimum}`);
      }

      if (property.maximum !== undefined && numberValue > property.maximum) {
        throw new PluginError('invalid_config', `config.${key} must be <= ${property.maximum}`);
      }
    }
  }

  for (const required of schema.required ?? []) {
    if (config[required] === undefined) {
      throw new PluginError('invalid_config', `config.${required} is required`);
    }
  }

  return config;
}

export function resolvePluginEntry(pluginDir: string, entry: string) {
  const root = path.resolve(pluginDir);
  const target = path.resolve(root, entry);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new PluginError('invalid_manifest', 'entry resolves outside the plugin directory');
  }

  return target;
}
