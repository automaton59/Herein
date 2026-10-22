export interface CoreClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface CoreTimelineMessage {
  id: string;
  timelineId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  status?: string | null;
}

export interface CoreTimeline {
  id: string;
  characterId: string;
  title: string;
}

export interface CoreChatResult {
  message: {
    role: 'assistant';
    content: string;
  };
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  persisted: boolean;
  timelineId: string;
}

export interface CoreRecommendationDecision {
  shouldRecommend: boolean;
  type?: 'song' | 'video';
  itemId?: string;
  reason?: string;
  moodTag?: string;
  confidence?: number;
}

export interface CoreRecommendationResult {
  decision: CoreRecommendationDecision;
  raw: string;
  latencyMs: number;
  blockedByGate?: string;
}

export interface CoreStatusComponent {
  status: 'ok' | 'degraded' | 'unavailable' | 'unconfigured' | 'unknown';
  message?: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

export interface CoreStatus {
  ok: boolean;
  degraded: boolean;
  version: string;
  startedAt: string;
  uptimeMs: number;
  now: string;
  components: {
    core: CoreStatusComponent;
    db: CoreStatusComponent;
    llm: CoreStatusComponent;
    tts: CoreStatusComponent;
    plugins: CoreStatusComponent;
    agents: CoreStatusComponent;
    relay: CoreStatusComponent;
    interaction: CoreStatusComponent;
  };
}

export interface CorePluginManifest {
  id: string;
  name: string;
  version: string;
  kind: 'source' | 'channel' | 'tool' | 'agent';
  description?: string;
  entry: string;
  permissions: Array<{
    kind: 'network' | 'credentials' | 'send' | 'install' | 'filesystem';
    value?: string;
    reason?: string;
  }>;
  configSchema?: {
    type: 'object';
    properties: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      title?: string;
      description?: string;
      default?: unknown;
      enum?: Array<string | number>;
      minimum?: number;
      maximum?: number;
    }>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface CorePluginHealth {
  status: 'ok' | 'degraded' | 'failed' | 'unknown';
  message?: string;
  checkedAt: string;
  lastSuccessAt?: string;
  latencyMs?: number;
}

export interface CorePluginView {
  manifest: CorePluginManifest;
  available: boolean;
  installed: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  health: CorePluginHealth;
  lastError: string | null;
  installedAt?: string | null;
  updatedAt?: string | null;
}

export interface CorePluginSummary {
  total: number;
  installed: number;
  enabled: number;
  healthy: number;
  degraded: number;
  failed: number;
}

export interface CorePluginAudit {
  id: string;
  pluginId: string;
  action: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CoreCharacterSummary {
  id: string;
  name: string;
}

export interface CoreInitiativeResult {
  status: 'spoke' | 'skipped' | 'failed';
  reason?: string;
  message?: string;
  timelineId?: string;
  error?: string;
}

export interface CoreAgentHealth {
  status: 'ok' | 'degraded' | 'failed' | 'unknown';
  message?: string;
  checkedAt: string;
}

export interface CoreAgentProvider {
  id: string;
  name: string;
  health: CoreAgentHealth;
}

export interface CoreAgentCapability {
  providerId: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: Array<{
    kind: 'network' | 'credentials' | 'send' | 'install' | 'filesystem';
    value?: string;
    reason?: string;
  }>;
  health: CoreAgentHealth;
  installed?: boolean;
  enabled?: boolean;
  actions?: string[];
}

export interface CoreAgentList {
  providers: CoreAgentProvider[];
  capabilities: CoreAgentCapability[];
}

export interface CoreAgentOperation {
  providerId: string;
  capabilityId: string;
  status: 'applied' | 'restart-required' | 'failed';
  message?: string;
  detail?: Record<string, unknown>;
}

export class CoreHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CoreHttpError';
    this.status = status;
  }
}

export class CoreClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CoreClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    this.token = options.token?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.baseUrl) {
      throw new Error('Core base URL is required');
    }
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();

    if (!response.ok) {
      throw new CoreHttpError(response.status, text.slice(0, 500) || `HTTP ${response.status}`);
    }

    return JSON.parse(text) as T;
  }

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('/health');
  }

  listMessages(characterId: string, limit = 100): Promise<{
    timeline: CoreTimeline;
    messages: CoreTimelineMessage[];
  }> {
    return this.request(`/v1/timeline/${encodeURIComponent(characterId)}/messages?limit=${limit}`);
  }

  syncMessages(
    characterId: string,
    messages: Array<Omit<CoreTimelineMessage, 'timelineId'> & { timelineId?: string }>,
    title?: string,
  ): Promise<{ timeline: CoreTimeline; result: { inserted: number; updated: number; deleted: number } }> {
    return this.request(`/v1/timeline/${encodeURIComponent(characterId)}/sync`, {
      method: 'POST',
      body: JSON.stringify({
        messages: messages.map(message => ({ ...message, timelineId: message.timelineId ?? 'pending' })),
        title,
      }),
    });
  }

  applyTimeline(
    characterId: string,
    input: {
      upserts: Array<Omit<CoreTimelineMessage, 'timelineId'> & { timelineId?: string }>;
      deletes?: string[];
      title?: string;
    },
  ): Promise<{ timeline: CoreTimeline; result: { inserted: number; updated: number; deleted: number } }> {
    return this.request(`/v1/timeline/${encodeURIComponent(characterId)}/apply`, {
      method: 'POST',
      body: JSON.stringify({
        upserts: input.upserts.map(message => ({ ...message, timelineId: message.timelineId ?? 'pending' })),
        deletes: input.deletes ?? [],
        title: input.title,
      }),
    });
  }

  chat(
    characterId: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options: { maxTokens?: number; temperature?: number; persist?: boolean } = {},
  ): Promise<CoreChatResult> {
    return this.request('/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        characterId,
        messages,
        ...options,
      }),
    });
  }

  neteaseCandidates(query?: string, limit = 10): Promise<{ candidates: unknown[] }> {
    return this.request('/v1/netease/candidates', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    });
  }

  recommend(input: {
    context: string;
    candidates: unknown[];
    taste?: unknown;
    characterName?: string;
    gate?: {
      now: string;
      itemId: string;
      turnsSinceLast?: number;
      lastRecommendedAt?: string | null;
      recentItemIds?: string[];
    };
  }): Promise<CoreRecommendationResult> {
    return this.request('/v1/recommend', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  status(): Promise<CoreStatus> {
    return this.request('/v1/status');
  }

  listPlugins(): Promise<{ plugins: CorePluginView[]; summary: CorePluginSummary }> {
    return this.request('/v1/plugins');
  }

  installPlugin(id: string): Promise<{ plugin: CorePluginView }> {
    return this.request('/v1/plugins/install', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  enablePlugin(id: string): Promise<{ plugin: CorePluginView }> {
    return this.request(`/v1/plugins/${encodeURIComponent(id)}/enable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  disablePlugin(id: string): Promise<{ plugin: CorePluginView }> {
    return this.request(`/v1/plugins/${encodeURIComponent(id)}/disable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  updatePluginConfig(id: string, config: Record<string, unknown>): Promise<{ plugin: CorePluginView }> {
    return this.request(`/v1/plugins/${encodeURIComponent(id)}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ config }),
    });
  }

  invokePlugin<T = unknown>(
    id: string,
    action: string,
    input?: unknown,
  ): Promise<{ result: T }> {
    return this.request(`/v1/plugins/${encodeURIComponent(id)}/invoke`, {
      method: 'POST',
      body: JSON.stringify({ action, input }),
    });
  }

  removePlugin(id: string): Promise<{ removed: boolean }> {
    return this.request(`/v1/plugins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  pluginAudit(limit = 100): Promise<{ audit: CorePluginAudit[] }> {
    return this.request(`/v1/plugins/audit?limit=${limit}`);
  }

  listCharacters(): Promise<{ characters: CoreCharacterSummary[] }> {
    return this.request('/v1/characters');
  }

  getReadState(characterId: string): Promise<{
    readState: {
      characterId: string;
      lastReadMessageId: string | null;
      lastReadAt: string | null;
      updatedAt: string | null;
    };
  }> {
    return this.request(`/v1/read-state/${encodeURIComponent(characterId)}`);
  }

  markRead(characterId: string, lastReadMessageId: string): Promise<unknown> {
    return this.request(`/v1/read-state/${encodeURIComponent(characterId)}`, {
      method: 'POST',
      body: JSON.stringify({ lastReadMessageId }),
    });
  }

  runInitiative(characterId?: string): Promise<CoreInitiativeResult> {
    return this.request('/v1/initiative/run', {
      method: 'POST',
      body: JSON.stringify(characterId ? { characterId } : {}),
    });
  }

  listAgents(): Promise<CoreAgentList> {
    return this.request('/v1/agents');
  }

  installAgent(providerId: string, capabilityId: string): Promise<CoreAgentOperation> {
    return this.request(`/v1/agents/${encodeURIComponent(providerId)}/${encodeURIComponent(capabilityId)}/install`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  enableAgent(providerId: string, capabilityId: string): Promise<CoreAgentOperation> {
    return this.request(`/v1/agents/${encodeURIComponent(providerId)}/${encodeURIComponent(capabilityId)}/enable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  disableAgent(providerId: string, capabilityId: string): Promise<CoreAgentOperation> {
    return this.request(`/v1/agents/${encodeURIComponent(providerId)}/${encodeURIComponent(capabilityId)}/disable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  removeAgent(providerId: string, capabilityId: string): Promise<CoreAgentOperation> {
    return this.request(`/v1/agents/${encodeURIComponent(providerId)}/${encodeURIComponent(capabilityId)}/remove`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  rollbackAgent(providerId: string, capabilityId: string): Promise<CoreAgentOperation> {
    return this.request(`/v1/agents/${encodeURIComponent(providerId)}/${encodeURIComponent(capabilityId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  invokeAgent<T = unknown>(
    providerId: string,
    capabilityId: string,
    action: string,
    input?: unknown,
  ): Promise<{ result: T }> {
    return this.request(`/v1/agents/${encodeURIComponent(providerId)}/${encodeURIComponent(capabilityId)}/invoke`, {
      method: 'POST',
      body: JSON.stringify({ action, input }),
    });
  }
}
