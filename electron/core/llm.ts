import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmCompletion {
  content: string;
  model: string;
  usage?: LlmUsage;
  latencyMs: number;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function chatCompletionsUrl(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, '');

  if (base.endsWith('/chat/completions')) {
    return base;
  }

  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }

  return `${base}/v1/chat/completions`;
}

export async function loadLlmConfig(filePath?: string): Promise<LlmConfig> {
  const resolved = path.resolve(
    filePath ?? process.env.HEREIN_LLM_CONFIG ?? path.join(process.cwd(), 'private', 'credentials', 'llm.json'),
  );
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(resolved, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read LLM config at ${resolved}: ${error instanceof Error ? error.message : error}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('LLM config must be a JSON object');
  }

  for (const key of ['baseUrl', 'apiKey', 'model'] as const) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
      throw new Error(`LLM config field "${key}" must be a non-empty string`);
    }
  }

  return {
    baseUrl: parsed.baseUrl as string,
    apiKey: parsed.apiKey as string,
    model: parsed.model as string,
    temperature: typeof parsed.temperature === 'number' ? parsed.temperature : undefined,
    maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
  };
}

function usageFrom(value: unknown): LlmUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    promptTokens: typeof value.prompt_tokens === 'number' ? value.prompt_tokens : undefined,
    completionTokens: typeof value.completion_tokens === 'number' ? value.completion_tokens : undefined,
    totalTokens: typeof value.total_tokens === 'number' ? value.total_tokens : undefined,
  };
}

export async function chatCompletion(
  config: LlmConfig,
  messages: LlmMessage[],
  options: ChatCompletionOptions = {},
): Promise<LlmCompletion> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = chatCompletionsUrl(config.baseUrl);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? config.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? config.maxTokens ?? 256,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`LLM returned non-JSON response: ${text.slice(0, 300)}`);
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.choices) || !isRecord(parsed.choices[0])) {
      throw new Error('LLM response is missing choices[0]');
    }

    const choice = parsed.choices[0];
    const message = choice.message;

    if (!isRecord(message) || typeof message.content !== 'string') {
      throw new Error('LLM response is missing choices[0].message.content');
    }

    return {
      content: message.content,
      model: typeof parsed.model === 'string' ? parsed.model : config.model,
      usage: usageFrom(parsed.usage),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}
