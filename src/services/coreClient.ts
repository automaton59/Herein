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
}
