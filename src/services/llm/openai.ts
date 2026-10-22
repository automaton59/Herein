import type { LLMService, ChatParams, ChatResponse, LLMConfig, LLMCallOptions, Message } from '../interfaces';
import type { OpenAIChatResponse, OpenAIMessage } from './types';
import { llmFetchJSON } from './http';
import { parseAssistantMetadata } from './metadata';

type ContentExtraction = {
  content: string;
  reasoning: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class OpenAIAdapter implements LLMService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private convertMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }));
  }

  private readText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(item => this.readText(item)).filter(Boolean).join('');
    }

    if (isRecord(value)) {
      return this.readText(value.text ?? value.content ?? value.message ?? value.data);
    }

    return '';
  }

  private extractContent(value: unknown): ContentExtraction {
    if (typeof value === 'string') {
      return { content: value, reasoning: '' };
    }

    if (!Array.isArray(value)) {
      return { content: this.readText(value), reasoning: '' };
    }

    const contentParts: string[] = [];
    const reasoningParts: string[] = [];

    value.forEach(part => {
      if (typeof part === 'string') {
        contentParts.push(part);
        return;
      }

      if (!isRecord(part)) {
        return;
      }

      const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';
      const isThinkingPart = type.includes('thinking') || type.includes('reasoning') || part.thinking !== undefined;

      if (isThinkingPart) {
        reasoningParts.push(this.readText(part.thinking ?? part.text ?? part.content));
        return;
      }

      contentParts.push(this.readText(part.text ?? part.content));
    });

    return {
      content: contentParts.filter(Boolean).join(''),
      reasoning: reasoningParts.filter(Boolean).join('\n\n'),
    };
  }

  private extractReasoningDetails(details: unknown): string {
    if (!Array.isArray(details)) {
      return '';
    }

    return details
      .map(detail => {
        if (!isRecord(detail)) {
          return '';
        }

        const type = typeof detail.type === 'string' ? detail.type.toLowerCase() : '';

        if (type.includes('encrypted')) {
          return '';
        }

        return this.readText(detail.text ?? detail.reasoning ?? detail.content ?? detail.data);
      })
      .filter(Boolean)
      .join('\n\n');
  }

  private extractReasoning(choice: OpenAIChatResponse['choices'][number] | undefined): string {
    if (!choice) {
      return '';
    }

    return this.joinReasoning(
      this.readText(choice.message?.reasoning_content),
      this.readText(choice.message?.reasoning),
      this.extractReasoningDetails(choice.message?.reasoning_details),
      this.readText(choice.delta?.reasoning_content),
      this.readText(choice.delta?.reasoning),
      this.extractReasoningDetails(choice.delta?.reasoning_details),
      this.readText(choice.reasoning),
    );
  }

  private extractInlineThinking(content: string): ContentExtraction {
    const reasoningParts: string[] = [];
    const text = content.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_match, reasoning) => {
      reasoningParts.push(String(reasoning).trim());
      return '';
    });

    return {
      content: text.trim(),
      reasoning: reasoningParts.filter(Boolean).join('\n\n'),
    };
  }

  private joinReasoning(...parts: Array<string | undefined>) {
    const seen = new Set<string>();

    return parts
      .map(part => part?.trim())
      .filter((part): part is string => Boolean(part))
      .filter(part => {
        if (seen.has(part)) {
          return false;
        }

        seen.add(part);
        return true;
      })
      .join('\n\n');
  }

  async chat(params: ChatParams, options: LLMCallOptions = {}): Promise<ChatResponse> {
    try {
      const messages: OpenAIMessage[] = [
        { role: 'system', content: params.systemPrompt },
        ...this.convertMessages(params.messages),
      ];

      const response = await llmFetchJSON<OpenAIChatResponse>(this.config, '/chat/completions', {
        method: 'POST',
        signal: options.signal,
        body: {
          model: this.config.model,
          messages,
          temperature: params.temperature ?? this.config.temperature ?? 0.8,
          max_tokens: params.maxTokens ?? this.config.maxTokens ?? 2000,
          stream: false,
        },
      });

      const choice = response.choices?.[0];
      const extractedContent = this.extractContent(
        choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? '',
      );
      const inlineThinking = this.extractInlineThinking(extractedContent.content);
      const reasoning = this.joinReasoning(
        this.extractReasoning(choice),
        extractedContent.reasoning,
        inlineThinking.reasoning,
      );

      if (!inlineThinking.content && !reasoning) {
        throw new Error('API returned no message content. Check the model name and Base URL.');
      }

      const { text, emotion, voiceInstruct } = parseAssistantMetadata(inlineThinking.content);

      return {
        content: text,
        emotion,
        voiceInstruct,
        reasoning: reasoning || undefined,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`LLM API call failed: ${this.formatError(error)}`);
    }
  }

  async *streamChat(params: ChatParams): AsyncIterableIterator<string> {
    const response = await this.chat(params);
    yield response.content;
  }

  private formatError(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const maybeError = error as {
        status?: number;
        code?: string;
        message?: string;
        body?: string;
        error?: { message?: string };
      };
      const status = maybeError.status ? `${maybeError.status} ` : '';
      const code = maybeError.code ? `${maybeError.code}: ` : '';
      return `${status}${code}${maybeError.error?.message || maybeError.message || maybeError.body || 'Unknown error'}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error';
  }
}
