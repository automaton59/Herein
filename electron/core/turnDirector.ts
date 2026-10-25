export type TurnAct = 'silent' | 'hold' | 'react' | 'reply' | 'elaborate';

export interface TurnDirectorInput {
  userText: string;
  recent?: Array<{ role: string; content: string; timestamp?: string | null }>;
  now?: Date;
  affect?: {
    mood?: number;
    energy?: number;
    busy?: number;
    patience?: number;
  };
  lastAssistantAt?: string | null;
}

export interface TurnDecision {
  act: TurnAct;
  reason: string;
  maxTokens: number;
  allowModelSilence: boolean;
}

const QUESTION = /[？?]|吗|呢|怎么|为什么|什么|哪|谁|几点|多少|要不要|能不能|可以吗|好不好/;
const ANALYSIS = /分析|建议|怎么办|帮我想|讲讲|展开|详细|解释|教我|方案/;
const EXPLICIT_ANALYSIS = /帮我分析|给我建议|怎么解决|教我|展开说说|详细说说/;
const VENT = /累死|烦死|难受|崩溃|想哭|吵架|生气|焦虑|压力|委屈|不开心|失眠|被骂|分手|孤独/;
const BARE_ACK = /^(嗯|哦|好|行|知道了|知道了。|ok|okay|OK|收到)[。.!！]?$/;
const EXPLICIT_SILENCE = /别说话|闭嘴|安静点|让我静静|让我一个人|不想说话|先别回|别回我/;

export interface TurnDirectorTuning {
  ventLongChars?: number;
  shortChars?: number;
  lowPatience?: number;
  recentReplyWindowMs?: number;
  maxTokens?: {
    elaborate?: number;
    question?: number;
    ordinary?: number;
    react?: number;
  };
}

const DEFAULT_MAX_TOKENS = {
  elaborate: 480,
  question: 220,
  ordinary: 180,
  react: 60,
};

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function recentAssistantWasJustNow(input: TurnDirectorInput, now: Date, windowMs: number): boolean {
  const timestamp = input.lastAssistantAt
    ?? [...(input.recent ?? [])].reverse().find(message => message.role === 'assistant')?.timestamp;

  if (!timestamp) {
    return false;
  }

  const at = Date.parse(timestamp);
  return Number.isFinite(at) && now.getTime() - at < windowMs;
}

export function directTurn(input: TurnDirectorInput, tuning?: TurnDirectorTuning): TurnDecision {
  const now = input.now ?? new Date();
  const text = input.userText.trim();
  const question = QUESTION.test(text);
  const analysis = ANALYSIS.test(text);
  const explicitAnalysis = EXPLICIT_ANALYSIS.test(text);
  const vent = VENT.test(text);
  const energy = input.affect?.energy ?? 1;
  const patience = input.affect?.patience ?? 1;
  const ventLongChars = clampNumber(tuning?.ventLongChars, 60, 10, 500);
  const shortChars = clampNumber(tuning?.shortChars, 6, 1, 100);
  const lowPatience = clampNumber(tuning?.lowPatience, 0.4, 0, 1);
  const recentReplyWindowMs = clampNumber(tuning?.recentReplyWindowMs, 60_000, 0, 600_000);
  const maxTokens = { ...DEFAULT_MAX_TOKENS, ...(tuning?.maxTokens ?? {}) };

  if (EXPLICIT_SILENCE.test(text)) {
    return {
      act: 'silent',
      reason: 'explicit silence request',
      maxTokens: 0,
      allowModelSilence: true,
    };
  }

  if (BARE_ACK.test(text) && recentAssistantWasJustNow(input, now, recentReplyWindowMs)) {
    return {
      act: 'silent',
      reason: 'bare acknowledgement right after a reply',
      maxTokens: 0,
      allowModelSilence: true,
    };
  }

  if (vent && text.length >= ventLongChars && !explicitAnalysis) {
    return {
      act: 'silent',
      reason: 'long vent, listen first',
      maxTokens: 0,
      allowModelSilence: true,
    };
  }

  if (analysis || explicitAnalysis) {
    return {
      act: 'elaborate',
      reason: 'user asked for analysis or a longer reply',
      maxTokens: Math.round(maxTokens.elaborate * Math.max(0.5, energy)),
      allowModelSilence: true,
    };
  }

  if (question) {
    return {
      act: 'reply',
      reason: 'user asked a question',
      maxTokens: Math.round(maxTokens.question * Math.max(0.5, energy)),
      allowModelSilence: true,
    };
  }

  if (vent || text.length <= shortChars || patience < lowPatience) {
    return {
      act: 'react',
      reason: vent ? 'emotional statement, react first' : 'short statement, keep it light',
      maxTokens: maxTokens.react,
      allowModelSilence: true,
    };
  }

  return {
    act: 'reply',
    reason: 'ordinary statement',
    maxTokens: Math.round(maxTokens.ordinary * Math.max(0.5, energy)),
    allowModelSilence: true,
  };
}
