// Core message type
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  emotion?: string;
  voiceInstruct?: string;
  reasoning?: string;
  status?: 'pending' | 'sent' | 'failed';
}

export interface Conversation {
  id: string;
  title: string;
  contactRemark?: string | null;
  /**
   * Legacy Phase 1/early Phase 2 name for the local contact remark.
   * New UI should read and write contactRemark instead.
   */
  customTitle?: string | null;
  characterId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

// LLM Service
export interface ChatParams {
  messages: Message[];
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCallOptions {
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  emotion?: string;
  voiceInstruct?: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMService {
  chat(params: ChatParams, options?: LLMCallOptions): Promise<ChatResponse>;
  streamChat(params: ChatParams): AsyncIterableIterator<string>;
}

// Configuration types
export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'deepseek' | 'custom';
  apiKey: string;
  model: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMModelInfo {
  id: string;
  name?: string;
  ownedBy?: string;
}

export type APIKeyEncoding = 'safe:v1' | 'plain:fallback';

export interface APIProfile {
  id: string;
  name: string;
  provider: LLMConfig['provider'];
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  encryptedApiKey: string;
  keyEncoding: APIKeyEncoding;
  lastConnectedAt?: string;
}

export type ConnectionStatus = 'unconfigured' | 'checking' | 'online' | 'offline' | 'typing';
export type ThemeMode = 'system' | 'light' | 'dark';

export type VoiceProvider = 'system' | 'gpt-sovits' | 'qwen3-tts' | 'qwen3-tts-clone';

export interface GptSovitsVoiceReference {
  refAudioPath: string;
  promptText: string;
  textLang?: string;
  promptLang?: string;
}

export interface VoiceConfig {
  provider: VoiceProvider;
  fallbackToSystem: boolean;
  gptSovits: {
    endpoint: string;
    textLang: string;
    promptLang: string;
    textSplitMethod: string;
    batchSize: number;
    speedFactor: number;
    streamingMode: boolean;
    references: Record<string, GptSovitsVoiceReference>;
  };
  qwen3Tts: {
    endpoint: string;
    language: string;
    speaker: string;
    defaultInstruct: string;
    emotionInstructs: Record<string, string>;
  };
  qwen3VoiceClone: {
    endpoint: string;
    language: string;
    xVectorOnlyMode: boolean;
    references: Record<string, GptSovitsVoiceReference>;
  };
}

export interface LocalTtsSynthesisRequest {
  endpoint: string;
  body: Record<string, unknown>;
}

export interface LocalTtsSynthesisResult {
  ok: boolean;
  status: number;
  statusText: string;
  contentType?: string;
  bytes?: Uint8Array | number[];
  body?: string;
}

export interface CharacterConfig {
  id: string;
  name: string;
  description: string;
  scenario: string;
  firstMessage: string;
  systemPrompt: string;
  avatarAssetId?: string | null;
}

export interface AppConfig {
  llm: LLMConfig;
  characters: CharacterConfig[];
  activeCharacterId: string;
  activeProfileId?: string | null;
  themeMode: ThemeMode;
  voice: VoiceConfig;
  memoryEnabled: boolean;
  memoryProfileMode: 'follow-chat' | 'custom';
  memoryProfileId?: string | null;
  summaryTriggerMessageCount: number;
}
