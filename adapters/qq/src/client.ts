import type {
  QQAccessToken,
  QQBotClientOptions,
  QQBotConfig,
  QQGatewayResponse,
  QQSendResult,
} from './types.js';

const DEFAULT_API_BASE = 'https://api.sgroup.qq.com';
const DEFAULT_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';

export class QQBotApiError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(status: number, message: string, code?: number) {
    super(message);
    this.name = 'QQBotApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class QQBotClient {
  private readonly config: QQBotConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly tokenUrl: string;
  private readonly now: () => number;
  private token: QQAccessToken | null = null;

  constructor(options: QQBotClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.now = options.now ?? (() => Date.now());
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 30_000) {
      return this.token.accessToken;
    }

    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: this.config.appId,
        clientSecret: this.config.appSecret,
      }),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new QQBotApiError(response.status, text.slice(0, 300) || `HTTP ${response.status}`);
    }

    const parsed = JSON.parse(text) as unknown;
    // QQ 的 token 接口在凭据错误时仍返回 HTTP 200，错误只体现在 code 字段。
    if (isRecord(parsed) && typeof parsed.code === 'number' && parsed.code !== 0) {
      const message = typeof parsed.message === 'string' ? parsed.message : 'unknown error';
      throw new QQBotApiError(
        response.status,
        `code ${parsed.code}: ${message}`,
        parsed.code,
      );
    }

    if (!isRecord(parsed) || typeof parsed.access_token !== 'string') {
      throw new QQBotApiError(-1, 'token response is missing access_token');
    }

    const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 7200;
    this.token = {
      accessToken: parsed.access_token,
      expiresAt: this.now() + expiresIn * 1000,
    };
    return this.token.accessToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        authorization: `QQBot ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();

    if (!response.ok) {
      throw new QQBotApiError(response.status, text.slice(0, 300) || `HTTP ${response.status}`);
    }

    const parsed = (text ? JSON.parse(text) : {}) as unknown;

    // 部分接口同样是 HTTP 200 + code 报错，需要在成功分支里再判一次。
    if (isRecord(parsed) && typeof parsed.code === 'number' && parsed.code !== 0) {
      const message = typeof parsed.message === 'string' ? parsed.message : 'unknown error';
      throw new QQBotApiError(response.status, `code ${parsed.code}: ${message}`, parsed.code);
    }

    return parsed as T;
  }

  getGateway(): Promise<QQGatewayResponse> {
    return this.request<QQGatewayResponse>('/gateway');
  }

  sendGroupMessage(groupOpenId: string, content: string, msgId?: string): Promise<QQSendResult> {
    return this.request<QQSendResult>(`/v2/groups/${encodeURIComponent(groupOpenId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        msg_type: 0,
        ...(msgId ? { msg_id: msgId } : {}),
      }),
    });
  }

  sendC2CMessage(openId: string, content: string, msgId?: string): Promise<QQSendResult> {
    return this.request<QQSendResult>(`/v2/users/${encodeURIComponent(openId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        msg_type: 0,
        ...(msgId ? { msg_id: msgId } : {}),
      }),
    });
  }

  async uploadGroupVoice(groupOpenId: string, url: string): Promise<string> {
    const result = await this.request<{ file_info?: string }>(
      `/v2/groups/${encodeURIComponent(groupOpenId)}/files`,
      {
        method: 'POST',
        body: JSON.stringify({ file_type: 3, url, srv_send_msg: false }),
      },
    );

    if (!result.file_info) {
      throw new QQBotApiError(-1, 'voice upload did not return file_info');
    }

    return result.file_info;
  }

  sendGroupVoice(groupOpenId: string, fileInfo: string, msgId?: string): Promise<QQSendResult> {
    return this.request<QQSendResult>(`/v2/groups/${encodeURIComponent(groupOpenId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        msg_type: 7,
        media: { file_info: fileInfo },
        ...(msgId ? { msg_id: msgId } : {}),
      }),
    });
  }

  async uploadC2CVoice(openId: string, url: string): Promise<string> {
    const result = await this.request<{ file_info?: string }>(
      `/v2/users/${encodeURIComponent(openId)}/files`,
      {
        method: 'POST',
        body: JSON.stringify({ file_type: 3, url, srv_send_msg: false }),
      },
    );

    if (!result.file_info) {
      throw new QQBotApiError(-1, 'voice upload did not return file_info');
    }

    return result.file_info;
  }

  sendC2CVoice(openId: string, fileInfo: string, msgId?: string): Promise<QQSendResult> {
    return this.request<QQSendResult>(`/v2/users/${encodeURIComponent(openId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        msg_type: 7,
        media: { file_info: fileInfo },
        ...(msgId ? { msg_id: msgId } : {}),
      }),
    });
  }
}
