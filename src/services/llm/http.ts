import type { LLMConfig } from '../interfaces';
import { getLLMEndpointURL } from './endpoints';

interface LLMFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export class LLMHTTPError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`${status} ${statusText}${body ? ` ${body}` : ''}`);
    this.name = 'LLMHTTPError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

type CoreBridge = {
  url: string;
  token: string;
};

/**
 * The Electron preload exposes the embedded core endpoint. Requests are routed
 * through it because the renderer CSP only allows connect-src 'self' and
 * http://127.0.0.1:*: calling a provider directly from the page is blocked by
 * the browser before any packet leaves the machine.
 */
function getCoreBridge(): CoreBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const core = window.hereinCore;

  if (!core?.url || !core.token) {
    return null;
  }

  return { url: core.url.replace(/\/+$/, ''), token: core.token };
}

function shouldUseLocalProxy() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.location.protocol.startsWith('http')
    && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  );
}

async function readResponseBody(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function directFetch(url: string, options: LLMFetchOptions, headers: Record<string, string>) {
  return fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

function coreFetch(
  core: CoreBridge,
  url: string,
  options: LLMFetchOptions,
  headers: Record<string, string>,
) {
  return fetch(`${core.url}/v1/llm-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${core.token}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      url,
      method: options.method || 'GET',
      headers,
      body: options.body,
    }),
  });
}

export async function llmFetch(config: LLMConfig, path: string, options: LLMFetchOptions = {}) {
  const url = getLLMEndpointURL(config, path);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${config.apiKey.trim()}`,
    ...options.headers,
  };

  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const core = getCoreBridge();

  if (core) {
    try {
      return await coreFetch(core, url, options, headers);
    } catch {
      // The core could not be reached at all (it may be remote); fall through
      // to the dev proxy or a direct request instead of failing outright.
    }
  }

  if (shouldUseLocalProxy()) {
    const proxyResponse = await fetch('/api/llm-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        url,
        method: options.method || 'GET',
        headers,
        body: options.body,
      }),
    });

    if (proxyResponse.status !== 502) {
      return proxyResponse;
    }

    try {
      return await directFetch(url, options, headers);
    } catch {
      return proxyResponse;
    }
  }

  return directFetch(url, options, headers);
}

export async function llmFetchJSON<T>(config: LLMConfig, path: string, options: LLMFetchOptions = {}) {
  const response = await llmFetch(config, path, options);
  const text = await readResponseBody(response);

  if (!response.ok) {
    throw new LLMHTTPError(response.status, response.statusText, text.slice(0, 1000));
  }

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API 返回的不是 JSON：${text.slice(0, 300)}`);
  }
}
