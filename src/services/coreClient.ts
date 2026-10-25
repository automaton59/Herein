export interface CoreClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface CoreSticker {
  id: string;
  name: string;
  url: string;
  pack?: string;
  emotion?: string;
}

export interface CoreMaterial {
  id: string;
  kind: 'video' | 'song';
  source: 'bilibili' | 'netease';
  title: string;
  creator: string | null;
  url: string | null;
  coverUrl: string | null;
}

export interface CoreTimelineMessage {
  id: string;
  timelineId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  emotion?: string | null;
  voiceInstruct?: string | null;
  sticker?: CoreSticker | null;
  material?: CoreMaterial | null;
  status?: string | null;
}

export interface CoreTimeline {
  id: string;
  characterId: string;
  title: string;
}

export interface CoreReplyBubble {
  text: string;
  delayMs?: number;
}

export interface CoreChatResult {
  message?: {
    id?: string;
    role: 'assistant';
    content: string;
    emotion?: string | null;
    voiceInstruct?: string | null;
    sticker?: CoreSticker | null;
    material?: CoreMaterial | null;
    bubbles?: CoreReplyBubble[];
  } | null;
  silent?: boolean;
  presence?: {
    emotion?: string | null;
    notice?: string | null;
  };
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs?: number;
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
  /** Short manual-setup instructions rendered above the config fields. */
  setup?: string;
  /** Link to this plugin's section in the setup docs (http(s) or repo-relative). */
  helpUrl?: string;
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
      placeholder?: string;
      format?: 'text' | 'password' | 'url' | 'path' | 'directory';
      examples?: string[];
      helpUrl?: string;
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
    // Bind the platform fetch to its global receiver. Calling an extracted
    // `window.fetch` as a method (this.fetchImpl(...)) makes Chromium throw
    // "Failed to execute 'fetch' on 'Window': Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);

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

  clearTimeline(characterId: string): Promise<{ ok: boolean; deleted: number }> {
    return this.request(`/v1/timeline/${encodeURIComponent(characterId)}/messages`, {
      method: 'DELETE',
    });
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
    options: { maxTokens?: number; temperature?: number; persist?: boolean; signal?: AbortSignal } = {},
  ): Promise<CoreChatResult> {
    return this.request('/v1/chat', {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({
        characterId,
        messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        persist: options.persist,
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

  checkPluginHealth(id: string): Promise<{ plugin: CorePluginView }> {
    return this.request(`/v1/plugins/${encodeURIComponent(id)}/health`, {
      method: 'POST',
      body: JSON.stringify({}),
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

}
