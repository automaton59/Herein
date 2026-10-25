import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion, type LlmConfig } from '../core/llm';

export interface RecommendationDecision {
  shouldRecommend: boolean;
  type?: 'song' | 'video';
  itemId?: string;
  reason?: string;
  moodTag?: string;
  confidence?: number;
}

export interface RecommendationGate {
  now: Date;
  itemId: string;
  lastRecommendedAt?: string | null;
  turnsSinceLast?: number;
  recentItemIds?: string[];
  userMood?: 'neutral' | 'happy' | 'sad' | 'angry' | 'upset' | 'anxious';
  cooldownMinutes?: number;
  minTurnsBetween?: number;
  noRepeatDays?: number;
}

interface CoreRecommendationModule {
  canRecommend: (context: RecommendationGate) => { allowed: boolean; reason: string };
  parseRecommendationDecision: (input: unknown) => RecommendationDecision;
}

let coreModule: Promise<CoreRecommendationModule> | null = null;

function loadCoreRecommendation(): Promise<CoreRecommendationModule> {
  coreModule ??= import('../../packages/core/dist/index.js' as string) as Promise<CoreRecommendationModule>;
  return coreModule;
}

export interface RecommendContentOptions {
  llmConfig: LlmConfig;
  context: string;
  candidates: unknown[];
  taste?: unknown;
  characterName?: string;
  gate?: RecommendationGate;
  promptPath?: string;
  fetchImpl?: typeof fetch;
}

export interface RecommendContentResult {
  decision: RecommendationDecision;
  raw: string;
  latencyMs: number;
  blockedByGate?: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('recommendation response did not contain a JSON object');
  }

  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

function renderPrompt(template: string, options: RecommendContentOptions) {
  const taste = typeof options.taste === 'string' ? options.taste : JSON.stringify(options.taste ?? {});

  return template
    .split('{{character_name}}').join(options.characterName ?? '角色')
    .split('{{context}}').join(options.context)
    .split('{{candidates_json}}').join(JSON.stringify(options.candidates))
    .split('{{taste}}').join(taste);
}

export async function recommendContent(options: RecommendContentOptions): Promise<RecommendContentResult> {
  const core = await loadCoreRecommendation();

  if (options.gate) {
    const gate = core.canRecommend(options.gate);

    if (!gate.allowed) {
      return {
        decision: { shouldRecommend: false },
        raw: '',
        latencyMs: 0,
        blockedByGate: gate.reason,
      };
    }
  }

  const promptPath = options.promptPath
    ?? path.join(process.cwd(), 'private', 'prompts', 'v0', 'content_recommend.md');
  const template = await readFile(promptPath, 'utf8');
  const prompt = renderPrompt(template, options);
  const completion = await chatCompletion(options.llmConfig, [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: '只输出 JSON 决策，不要解释。如果候选都不合适，输出 {"shouldRecommend":false}。',
    },
  ], {
    temperature: 0.3,
    maxTokens: 220,
    fetchImpl: options.fetchImpl,
  });

  const decision = core.parseRecommendationDecision(extractJson(completion.content));

  return {
    decision,
    raw: completion.content,
    latencyMs: completion.latencyMs,
  };
}
