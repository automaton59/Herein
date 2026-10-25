import { randomUUID } from 'node:crypto';
import type {
  CharacterRecord,
  createPhase2Repositories,
  MessageRecord,
} from '../data/repositories';
import type { CompiledPersona } from '../persona/compiler';
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
  attentionBudget: number;
  cooldownMs: number;
  minIdleMs: number;
}

export const DEFAULT_INITIATIVE_POLICY: InitiativePolicy = {
  enabled: true,
  quietHours: { start: '01:30', end: '08:00' },
  dailyLimit: 3,
  attentionBudget: 10,
  cooldownMs: 90 * 60 * 1000,
  minIdleMs: 20 * 60 * 1000,
};

export interface InitiativeMaterialProvider {
  hasFresh: (maxAgeMs?: number) => boolean;
  block: (limit?: number, maxAgeMs?: number) => string;
}

export interface InitiativeGateInput {
  now: Date;
  messages: MessageRecord[];
  policy: InitiativePolicy;
  hasMaterial: boolean;
  attentionSpent?: number;
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
  materials?: InitiativeMaterialProvider;
  personaFor?: (characterId: string) => CompiledPersona | null | undefined;
  notify?: (message: string) => Promise<void> | void;
  onSpoken?: (message: string) => Promise<void> | void;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

export interface InitiativeSchedulerOptions {
  engine: Pick<InitiativeEngine, 'run'>;
  getCharacterId: () => string | null;
  intervalMs?: number;
  startDelayMs?: number;
  onResult?: (result: InitiativeRunResult) => void;
  logger?: {
    warn?: (message: string, detail?: unknown) => void;
  };
}

export class InitiativeScheduler {
  private readonly options: InitiativeSchedulerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;

  constructor(options: InitiativeSchedulerOptions) {
    this.options = options;
  }

  start() {
    if (this.timer) {
      return;
    }

    const interval = this.options.intervalMs ?? 10 * 60 * 1000;
    const startDelay = this.options.startDelayMs ?? 5000;

    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.tick();
    }, startDelay);
    this.startTimer.unref?.();

    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.timer.unref?.();
  }

  stop() {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }

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

  if ((input.attentionSpent ?? 0) >= policy.attentionBudget) {
    return { ...base, allowed: false, reason: 'attention budget reached' };
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

function buildPersonaBlock(
  character: CharacterRecord,
  persona: CompiledPersona | null,
): string {
  if (persona) {
    return [
      persona.identity,
      persona.relationship,
      character.speakingStyle && `说话方式：\n${character.speakingStyle}`,
    ].filter(Boolean).join('\n\n');
  }

  return [
    `你是${character.name}。`,
    character.description,
    character.personalityCore && `人格：${character.personalityCore}`,
    character.speakingStyle && `说话方式：${character.speakingStyle}`,
    character.valuesText && `价值观：${character.valuesText}`,
    character.boundaries && `边界：${character.boundaries}`,
  ].filter(Boolean).join('\n');
}

function buildInitiativePrompt(input: {
  now: Date;
  character: CharacterRecord;
  persona: CompiledPersona | null;
  messages: MessageRecord[];
  summary: string | null;
  experiences: Array<{ title: string; reaction: string; summary: string }>;
  materialBlock: string;
  openLoops: Array<{ text: string; createdAt: string }>;
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
  const lastAt = input.messages[input.messages.length - 1]?.timestamp;
  const idleMinutes = lastAt && Number.isFinite(Date.parse(lastAt))
    ? Math.max(0, Math.round((input.now.getTime() - Date.parse(lastAt)) / 60_000))
    : null;
  const localTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(input.now);

  return [
    '你在替她判断“现在是否值得主动发一条消息”，以及发什么。下面的身份、关系和说话方式是她本人的；你写出的消息必须是她会亲手发的那种，不是通用助手的播报。',
    '',
    '【你是谁】',
    buildPersonaBlock(input.character, input.persona),
    '',
    '【现在】',
    `现在：${input.now.toISOString()}（当地 ${localTime}）`,
    idleMinutes === null ? '' : `距上次对话：${idleMinutes} 分钟`,
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
    '她最近看到的（系统刚替她查的，不是用户说的）：',
    input.materialBlock || '（无）',
    '',
    '没接住的线头：',
    input.openLoops.length
      ? input.openLoops.map(loop => `- ${loop.text}（${loop.createdAt.slice(0, 10)}）`).join('\n')
      : '（无）',
    '',
    '规则：',
    '- 默认不说。只有具体时机、未收尾的承接、她自己的经历或念头值得分享时才说。',
    '- 如果有线头且已经过了至少半天，优先承接；同一个线头不要反复提。',
    '- 如果距上次对话超过 4 小时，且有具体材料，可以主动说一条；优先承接上次没说完的事。',
    '- 如果“她最近看到的”里有具体内容，就挑一条说具体的，不要泛泛说“看到一个视频/听到一首歌”。',
    '- 也可以只是单纯想说话：不用等插件材料，给一个具体的、低风险的由头（刚在做什么、突然想到什么、刚才遇到的小事）。不要为了起头编造可验证的现实事件。',
    '- 不要把“想说话”写成索取注意力：不用“在”“在吗”“干嘛呢”“理理我”这类单字或试探句。',
    '- 不要在消息里播报列表；一次只挑一条。',
    '- 不要催促回复；不要客服式关心；不要内疚话术。',
    '- 主动消息优先用陈述句，给对方留不回复的空间；问句最多三成。',
    '- 一条短消息，1–2 句，像随手发来的；用她自己的语气，不要变成播报或客服。',
    '- 如果用户刚说过话、在忙、在难过但不需要打扰，或确实没有具体内容，就不说。',
    '',
    '只返回一个 JSON 对象，不要 markdown：',
    '{"shouldSpeak":true|false,"reason":"一句话原因","message":"要发的话，不说就空字符串"}',
  ].join('\n');
}

function parseDecision(raw: string): { shouldSpeak: boolean; reason: string; message: string } | null {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate) as unknown;
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
  private readonly materials?: InitiativeMaterialProvider;
  private readonly personaFor?: InitiativeEngineOptions['personaFor'];
  private readonly notify?: InitiativeEngineOptions['notify'];
  private readonly onSpoken?: InitiativeEngineOptions['onSpoken'];
  private readonly logger: InitiativeEngineOptions['logger'];

  constructor(options: InitiativeEngineOptions) {
    this.repos = options.repos;
    this.events = options.events;
    this.llmConfig = options.llmConfig;
    this.llmConfigPath = options.llmConfigPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.materials = options.materials;
    this.personaFor = options.personaFor;
    this.notify = options.notify;
    this.onSpoken = options.onSpoken;
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
      const persona = this.personaFor?.(input.characterId) ?? null;
      const messages = this.repos.messages.listRecent(timeline.id, 200);

      if (messages.length === 0) {
        return { status: 'skipped', reason: 'no conversation yet' };
      }

      const summary = this.repos.summaries.getByTimeline(timeline.id);
      const experiences = this.repos.experiences.listRecent(5);
      const openLoops = this.repos.openLoops.listOpen(input.characterId, 5);
      const materialBlock = this.materials?.block(6) ?? '';
      this.repos.initiativeBids.markStaleIgnored(input.characterId);
      const recentBids = this.repos.initiativeBids.listRecent(input.characterId, 30);
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const spent = recentBids
        .filter(bid => bid.createdAt >= dayStart && bid.status === 'sent')
        .reduce((sum, bid) => sum + (bid.channel === 'text' ? 2 : bid.channel === 'voice' ? 4 : bid.channel === 'push' ? 3 : 0), 0);
      const recentIgnored = recentBids.filter(bid => bid.outcome === 'ignored').slice(0, 3).length;

      if (recentIgnored >= 3) {
        return { status: 'skipped', reason: 'recent proactive messages were ignored' };
      }

      const gate = evaluateInitiativeGate({
        now,
        messages,
        policy: this.policy,
        hasMaterial: messages.length > 0 || experiences.length > 0 || Boolean(materialBlock),
        attentionSpent: spent,
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
            character,
            persona,
            messages,
            summary: summary?.content ?? null,
            experiences: experiences.map(experience => ({
              title: experience.title,
              reaction: experience.reaction,
              summary: experience.summary,
            })),
            materialBlock,
            openLoops: openLoops.map(loop => ({
              text: loop.text,
              createdAt: loop.createdAt,
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
      this.repos.initiativeBids.create({
        id: `bid_${randomUUID()}`,
        characterId: input.characterId,
        timelineId: timeline.id,
        kind: openLoops.length > 0 ? 'continuation' : materialBlock ? 'share' : 'idle_thought',
        channel: 'text',
        score: 1,
        status: 'sent',
        createdAt: timestamp,
      });
      this.events.publish('assistant.proactive', {
        characterId: input.characterId,
        timelineId: timeline.id,
        message,
        reason: decision.reason,
      });

      try {
        await this.notify?.(decision.message);
      } catch {
        // Notification is best-effort; the message is already in the timeline.
      }

      try {
        await this.onSpoken?.(decision.message);
      } catch {
        // Interaction delivery is best-effort; text is already in the timeline.
      }

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
