import { randomUUID } from 'node:crypto';
import type { createPhase2Repositories, MessageRecord } from '../data/repositories';
import type { CoreEventBus } from './eventBus';
import {
  chatCompletion,
  loadLlmConfig,
  type LlmConfig,
} from './llm';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface InitiativeQuietHours {
  start: string;
  end: string;
}

export interface InitiativePolicy {
  enabled: boolean;
  quietHours: InitiativeQuietHours;
  dailyLimit: number;
  cooldownMs: number;
  minIdleMs: number;
}

export const DEFAULT_INITIATIVE_POLICY: InitiativePolicy = {
  enabled: true,
  quietHours: { start: '23:30', end: '08:00' },
  dailyLimit: 3,
  cooldownMs: 90 * 60 * 1000,
  minIdleMs: 20 * 60 * 1000,
};

export interface InitiativeGateInput {
  now: Date;
  messages: MessageRecord[];
  policy: InitiativePolicy;
  hasMaterial: boolean;
}

export interface InitiativeGateResult {
  allowed: boolean;
  reason: string;
  proactiveToday: number;
  lastProactiveAt: string | null;
  lastUserMessageAt: string | null;
}

export interface InitiativeRunInput {
  characterId: string;
}

export type InitiativeRunResult =
  | { status: 'spoke'; message: string; reason: string; timelineId: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export interface InitiativeEngineOptions {
  repos: Repositories;
  events: CoreEventBus;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  fetchImpl?: typeof fetch;
  policy?: Partial<InitiativePolicy>;
  now?: () => Date;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

export interface InitiativeSchedulerOptions {
  engine: Pick<InitiativeEngine, 'run'>;
  getCharacterId: () => string | null;
  intervalMs?: number;
  onResult?: (result: InitiativeRunResult) => void;
  logger?: {
    warn?: (message: string, detail?: unknown) => void;
  };
}

export class InitiativeScheduler {
  private readonly options: InitiativeSchedulerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(options: InitiativeSchedulerOptions) {
    this.options = options;
  }

  start() {
    if (this.timer) {
      return;
    }

    const interval = this.options.intervalMs ?? 30 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<InitiativeRunResult> {
    if (this.ticking) {
      return { status: 'skipped', reason: 'initiative tick already running' };
    }

    this.ticking = true;

    try {
      const characterId = this.options.getCharacterId();

      if (!characterId) {
        return { status: 'skipped', reason: 'no character available' };
      }

      const result = await this.options.engine.run({ characterId });
      this.options.onResult?.(result);

      if (result.status === 'failed') {
        this.options.logger?.warn?.('initiative scheduler tick failed', result.error);
      }

      return result;
    } finally {
      this.ticking = false;
    }
  }
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function isQuietHours(now: Date, quietHours: InitiativeQuietHours) {
  const start = parseClock(quietHours.start);
  const end = parseClock(quietHours.end);

  if (start === null || end === null || start === end) {
    return false;
  }

  const current = now.getHours() * 60 + now.getMinutes();

  if (start < end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
}

function isProactiveMessage(message: MessageRecord) {
  return message.role === 'assistant' && message.sourceConversationId === 'initiative';
}

export function evaluateInitiativeGate(input: InitiativeGateInput): InitiativeGateResult {
  const { now, messages, policy } = input;
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const proactive = messages.filter(isProactiveMessage);
  const proactiveToday = proactive.filter(message => {
    const timestamp = new Date(message.timestamp).getTime();
    return Number.isFinite(timestamp) && timestamp >= startOfDay;
  }).length;
  const lastProactive = proactive.length > 0 ? proactive[proactive.length - 1] : null;
  const lastUser = [...messages].reverse().find(message => message.role === 'user') ?? null;
  const lastProactiveAt = lastProactive?.timestamp ?? null;
  const lastUserMessageAt = lastUser?.timestamp ?? null;

  const base = {
    proactiveToday,
    lastProactiveAt,
    lastUserMessageAt,
  };

  if (!policy.enabled) {
    return { ...base, allowed: false, reason: 'initiative is disabled' };
  }

  if (isQuietHours(now, policy.quietHours)) {
    return { ...base, allowed: false, reason: 'quiet hours' };
  }

  if (proactiveToday >= policy.dailyLimit) {
    return { ...base, allowed: false, reason: 'daily limit reached' };
  }

  if (lastProactiveAt) {
    const elapsed = now.getTime() - new Date(lastProactiveAt).getTime();

    if (Number.isFinite(elapsed) && elapsed < policy.cooldownMs) {
      return { ...base, allowed: false, reason: 'cooldown' };
    }
  }

  if (lastUserMessageAt) {
    const elapsed = now.getTime() - new Date(lastUserMessageAt).getTime();

    if (Number.isFinite(elapsed) && elapsed < policy.minIdleMs) {
      return { ...base, allowed: false, reason: 'user is active' };
    }
  }

  if (!input.hasMaterial) {
    return { ...base, allowed: false, reason: 'nothing worth saying' };
  }

  return { ...base, allowed: true, reason: 'allowed' };
}

function buildInitiativePrompt(input: {
  now: Date;
  messages: MessageRecord[];
  summary: string | null;
  experiences: Array<{ title: string; reaction: string; summary: string }>;
}) {
  const transcript = input.messages
    .slice(-16)
    .map(message => `${message.role}: ${message.content.slice(0, 1200)}`)
    .join('\n');
  const experiences = input.experiences.length
    ? input.experiences
      .map(experience => `- ${experience.title}：${experience.reaction || experience.summary}`)
      .join('\n')
    : '- 无';

  return [
    '你是“蓝蓝”的主动性层，不是聊天角色。你只判断“现在是否值得主动发一条消息”，以及发什么。',
    `现在：${input.now.toISOString()}`,
    '',
    '最近对话：',
    transcript || '（空）',
    '',
    '当前总结：',
    input.summary || '（无）',
    '',
    '她自己的生活/最近经历：',
    experiences,
    '',
    '规则：',
    '- 默认不说。只有具体时机、未收尾的承接、她自己的经历值得分享时才说。',
    '- 不要“在吗”“干嘛呢”这类索取注意力的句子；不要催促回复；不要客服式关心。',
    '- 一条短消息，1–2 句，像随手发来的。',
    '- 如果用户刚说过话、在忙、在难过但不需要打扰，或没有新内容，就不说。',
    '',
    '只返回一个 JSON 对象，不要 markdown：',
    '{"shouldSpeak":true|false,"reason":"一句话原因","message":"要发的话，不说就空字符串"}',
  ].join('\n');
}

function parseDecision(raw: string): { shouldSpeak: boolean; reason: string; message: string } | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const shouldSpeak = record.shouldSpeak === true;
  const reason = typeof record.reason === 'string' ? record.reason.trim().slice(0, 200) : '';
  const message = typeof record.message === 'string'
    ? record.message.replace(/\s+/g, ' ').trim().slice(0, 160)
    : '';

  return {
    shouldSpeak: shouldSpeak && Boolean(message),
    reason,
    message,
  };
}

export class InitiativeEngine {
  private readonly repos: Repositories;
  private readonly events: CoreEventBus;
  private readonly llmConfig?: LlmConfig;
  private readonly llmConfigPath?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly policy: InitiativePolicy;
  private readonly now: () => Date;
  private readonly logger: InitiativeEngineOptions['logger'];

  constructor(options: InitiativeEngineOptions) {
    this.repos = options.repos;
    this.events = options.events;
    this.llmConfig = options.llmConfig;
    this.llmConfigPath = options.llmConfigPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.policy = {
      ...DEFAULT_INITIATIVE_POLICY,
      ...options.policy,
      quietHours: {
        ...DEFAULT_INITIATIVE_POLICY.quietHours,
        ...options.policy?.quietHours,
      },
    };
    this.logger = options.logger;
  }

  async run(input: InitiativeRunInput): Promise<InitiativeRunResult> {
    try {
      const character = this.repos.characters.get(input.characterId);

      if (!character) {
        return { status: 'skipped', reason: `character not found: ${input.characterId}` };
      }

      const timeline = this.repos.timelines.getPrimaryForCharacter(input.characterId);

      if (!timeline) {
        return { status: 'skipped', reason: 'no primary timeline' };
      }

      const now = this.now();
      const messages = this.repos.messages.listRecent(timeline.id, 200);
      const summary = this.repos.summaries.getByTimeline(timeline.id);
      const experiences = this.repos.experiences.listRecent(5);
      const gate = evaluateInitiativeGate({
        now,
        messages,
        policy: this.policy,
        hasMaterial: messages.length > 0 || experiences.length > 0,
      });

      if (!gate.allowed) {
        return { status: 'skipped', reason: gate.reason };
      }

      const config = await this.resolveConfig();

      if (!config) {
        return { status: 'skipped', reason: 'LLM is not configured' };
      }

      const completion = await chatCompletion(
        config,
        [{
          role: 'user',
          content: buildInitiativePrompt({
            now,
            messages,
            summary: summary?.content ?? null,
            experiences: experiences.map(experience => ({
              title: experience.title,
              reaction: experience.reaction,
              summary: experience.summary,
            })),
          }),
        }],
        {
          temperature: 0.7,
          maxTokens: 300,
          fetchImpl: this.fetchImpl,
        },
      );

      const decision = parseDecision(completion.content);

      if (!decision) {
        return { status: 'failed', error: 'initiative output was not valid JSON' };
      }

      if (!decision.shouldSpeak) {
        return { status: 'skipped', reason: decision.reason || 'model declined' };
      }

      const timestamp = now.toISOString();
      const message: MessageRecord = {
        id: `initiative_${randomUUID()}`,
        timelineId: timeline.id,
        role: 'assistant',
        content: decision.message,
        timestamp,
        sourceConversationId: 'initiative',
        status: 'sent',
      };

      this.repos.messages.append(message);
      this.events.publish('assistant.proactive', {
        characterId: input.characterId,
        timelineId: timeline.id,
        message,
        reason: decision.reason,
      });
      this.logger?.info?.('initiative spoke', {
        characterId: input.characterId,
        timelineId: timeline.id,
      });

      return {
        status: 'spoke',
        message: decision.message,
        reason: decision.reason,
        timelineId: timeline.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.('initiative failed', error);
      return { status: 'failed', error: message };
    }
  }

  private async resolveConfig(): Promise<LlmConfig | null> {
    if (this.llmConfig) {
      return this.llmConfig;
    }

    try {
      return await loadLlmConfig(this.llmConfigPath);
    } catch {
      return null;
    }
  }
}
