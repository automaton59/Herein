import { randomUUID } from 'node:crypto';
import { createPhase2Repositories } from '../data/repositories';
import { buildCoreChatPrompt } from './chatContext';
import type { CoreEventBus } from './eventBus';
import { chatCompletion, loadLlmConfig, type LlmConfig, type LlmMessage } from './llm';
import type { InteractionDispatcher } from './interaction';
import { splitSpeechParts } from './speechStyle';
import { affectPrompt, computeAffect } from './affect';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface VoiceMemoryRunner {
  run(input: { characterId: string; timelineId: string }): Promise<unknown>;
}

export interface VoiceConversationOptions {
  repos: Repositories;
  events: CoreEventBus;
  memoryRunner: VoiceMemoryRunner;
  dispatcher: InteractionDispatcher;
  materials?: {
    contextForText: (text: string) => Promise<{ block: string }>;
  };
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  fetchImpl?: typeof fetch;
  characterId?: string;
  maxTokens?: number;
  waitForSpeechCompletion?: boolean;
  speechTimeoutMs?: number;
  maxSpeechParts?: number;
  interject?: boolean;
  interjectAfterMs?: number;
  backchannel?: boolean;
  backchannelAfterMs?: number;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

interface SpeechWaiter {
  resolve: () => void;
}

export class VoiceConversation {
  private readonly options: VoiceConversationOptions;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly waiters = new Map<string, SpeechWaiter>();
  private readonly completedTurns = new Set<string>();
  private currentParts: string[] = [];
  private currentPartIndex = 0;
  private currentTurnId: string | null = null;
  private pendingResumeNote: string | null = null;
  private lastSpokenText: string | null = null;
  private lastSpokenAt = 0;
  private currentEmotion: string | null = null;
  private userSpeaking = false;
  private interjectTimer: ReturnType<typeof setTimeout> | null = null;
  private backchannelTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VoiceConversationOptions) {
    this.options = options;
  }

  handleTranscript(text: string, turnId?: string) {
    const clean = text.trim().slice(0, 1000);

    if (!clean) {
      return;
    }

    this.options.logger?.info?.('voice transcript', { characters: clean.length });
    const generation = ++this.generation;
    this.queue = this.queue
      .then(() => this.respond(clean, turnId, generation))
      .catch(error => {
        this.options.logger?.warn?.('voice conversation failed', error);
      });
  }

  handleSpeechEvent(event: { type?: string; turnId?: string }) {
    if (event.type !== 'speech.completed' && event.type !== 'speech.failed') {
      return;
    }

    const turnId = typeof event.turnId === 'string' ? event.turnId : '';

    if (!turnId) {
      return;
    }

    this.completedTurns.add(turnId);
    const waiter = this.waiters.get(turnId);

    if (waiter) {
      this.waiters.delete(turnId);
      waiter.resolve();
    }
  }

  handleVad(state: 'start' | 'end') {
    if (state === 'end') {
      this.userSpeaking = false;
      this.clearInterjectTimer();
      this.clearBackchannelTimer();
      return;
    }

    this.userSpeaking = true;
    this.clearInterjectTimer();
    this.clearBackchannelTimer();

    if (this.options.backchannel !== false) {
      const afterMs = this.options.backchannelAfterMs ?? 8_000;
      this.backchannelTimer = setTimeout(() => {
        this.backchannelTimer = null;

        if (!this.userSpeaking) {
          return;
        }

        void this.options.dispatcher.speak({
          text: '嗯',
          source: 'chat',
          priority: 'ambient',
          interruptible: true,
          filler: true,
          turnId: `backchannel:${randomUUID()}`,
        });
      }, afterMs);
      this.backchannelTimer.unref?.();
    }

    if (this.options.interject === false) {
      return;
    }

    const afterMs = this.options.interjectAfterMs ?? 25_000;
    this.interjectTimer = setTimeout(() => {
      this.interjectTimer = null;

      if (!this.userSpeaking) {
        return;
      }

      void this.options.dispatcher.speak({
        text: '等等',
        source: 'chat',
        priority: 'urgent',
        interruptible: false,
        filler: true,
        turnId: `interject:${randomUUID()}`,
      });
    }, afterMs);
    this.interjectTimer.unref?.();
  }

  interrupt() {
    this.clearInterjectTimer();
    this.clearBackchannelTimer();

    if (this.currentTurnId && this.currentParts.length > 0) {
      const part = this.currentParts[this.currentPartIndex]
        ?? this.currentParts[this.currentParts.length - 1]
        ?? '';
      const spoken = this.currentParts.slice(0, this.currentPartIndex).join('');

      this.pendingResumeNote = [
        `你刚才说到${spoken ? `“${spoken}”之后、` : ''}“${part}”时被对方打断了。`,
        '不要从头重复；如果对方只是应了一声，可以接着往下说。',
      ].join('\n');
    } else if (this.lastSpokenText && Date.now() - this.lastSpokenAt < 30_000) {
      this.pendingResumeNote = [
        `你刚才说到“${this.lastSpokenText}”时被对方打断了。`,
        '不要从头重复；如果对方只是应了一声，可以接着往下说。',
      ].join('\n');
    }

    this.currentTurnId = null;
    this.currentParts = [];
    this.currentPartIndex = 0;
    this.generation += 1;
    this.releaseWaiters();
  }

  async stop() {
    this.generation += 1;
    this.userSpeaking = false;
    this.clearInterjectTimer();
    this.clearBackchannelTimer();
    this.releaseWaiters();
    await this.queue;
  }

  async whenIdle() {
    await this.queue;
  }

  private releaseWaiters() {
    for (const waiter of this.waiters.values()) {
      waiter.resolve();
    }

    this.waiters.clear();
  }

  private clearInterjectTimer() {
    if (this.interjectTimer) {
      clearTimeout(this.interjectTimer);
      this.interjectTimer = null;
    }
  }

  private clearBackchannelTimer() {
    if (this.backchannelTimer) {
      clearTimeout(this.backchannelTimer);
      this.backchannelTimer = null;
    }
  }

  private waitForCompletion(turnId: string): Promise<void> {
    if (this.completedTurns.delete(turnId)) {
      return Promise.resolve();
    }

    const timeoutMs = this.options.speechTimeoutMs ?? 20_000;

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.waiters.delete(turnId);
        resolve();
      }, timeoutMs);
      timer.unref?.();

      this.waiters.set(turnId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  private async speakParts(parts: string[], turnId: string | undefined, generation: number) {
    const baseTurnId = turnId ?? randomUUID();
    this.currentTurnId = baseTurnId;
    this.currentParts = parts;
    this.currentPartIndex = 0;

    for (let index = 0; index < parts.length; index += 1) {
      if (generation !== this.generation) {
        return;
      }

      this.currentPartIndex = index;
      const partTurnId = `${baseTurnId}:${index}`;
      this.lastSpokenText = parts[index];
      this.lastSpokenAt = Date.now();
      const result = await this.options.dispatcher.speak({
        text: parts[index],
        emotion: this.currentEmotion,
        source: 'chat',
        priority: 'normal',
        interruptible: true,
        turnId: partTurnId,
      });

      if (!result.ok || this.options.waitForSpeechCompletion === false) {
        if (!result.ok) {
          this.options.logger?.warn?.('voice speech failed', result.error);
        }
        continue;
      }

      await this.waitForCompletion(partTurnId);

      if (generation !== this.generation) {
        return;
      }
    }

    this.currentTurnId = null;
    this.currentParts = [];
    this.currentPartIndex = 0;
  }

  private async respond(text: string, turnId: string | undefined, generation: number) {
    const character = this.options.characterId
      ? this.options.repos.characters.get(this.options.characterId)
      : this.options.repos.characters.list()[0];

    if (!character) {
      throw new Error('no character is available for voice conversation');
    }

    const timeline = this.options.repos.timelines.getVoiceForCharacter?.(character.id)
      ?? this.options.repos.timelines.ensureVoiceForCharacter?.(
        character.id,
        `${character.name} · 语音`,
      )
      ?? this.options.repos.timelines.getPrimaryForCharacter(character.id)
      ?? this.options.repos.timelines.ensurePrimaryForCharacter(character.id, character.name);
    const history = this.options.repos.messages
      .listRecent(timeline.id, 20)
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .map(message => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));
    const llmMessages: LlmMessage[] = [
      ...history,
      { role: 'user', content: text },
    ];
    const config = this.options.llmConfig
      ?? await loadLlmConfig(this.options.llmConfigPath);
    let materialBlock: string | undefined;

    if (this.options.materials) {
      try {
        materialBlock = (await this.options.materials.contextForText(text)).block || undefined;
      } catch (error) {
        this.options.logger?.warn?.('voice material context failed', error);
      }
    }
    const affect = computeAffect({
      characterId: character.id,
      now: new Date(),
      recent: [...history, { role: 'user', content: text }],
      previous: this.options.repos.affectState?.get(character.id) ?? null,
    });
    this.currentEmotion = affect.mood > 0.5
      ? 'happy'
      : affect.mood < -0.5
        ? 'sad'
        : 'neutral';
    this.options.repos.affectState?.upsert(affect);
    const systemPrompt = buildCoreChatPrompt({
      repos: this.options.repos,
      character,
      timeline,
      audience: 'private',
      materialBlock,
    });
    const resumeNote = this.pendingResumeNote;
    this.pendingResumeNote = null;
    const voicePrompt = `${systemPrompt}\n\n${affectPrompt(affect)}${
      resumeNote ? `\n\n【刚才】\n${resumeNote}` : ''
    }\n\n【语音】只回一到两句，像真人刚开口；不要列表、标题、加粗，不要解释你在做什么。`;
    const completion = await chatCompletion(config, [
      { role: 'system', content: voicePrompt },
      ...llmMessages,
    ], {
      maxTokens: this.options.maxTokens,
      fetchImpl: this.options.fetchImpl,
    });
    this.options.logger?.info?.('voice reply', {
      characters: completion.content.length,
      model: completion.model,
    });

    const timestamp = new Date().toISOString();
    this.options.repos.messages.append({
      id: randomUUID(),
      timelineId: timeline.id,
      role: 'user',
      content: text,
      timestamp,
      status: 'sent',
    });
    this.options.repos.messages.append({
      id: randomUUID(),
      timelineId: timeline.id,
      role: 'assistant',
      content: completion.content,
      timestamp: new Date(Date.now() + 1).toISOString(),
      status: 'sent',
    });
    this.options.events.publish('chat.completed', {
      characterId: character.id,
      timelineId: timeline.id,
      model: completion.model,
      source: 'voice',
      emotion: affect.mood > 0.5 ? 'happy' : affect.mood < -0.5 ? 'sad' : 'neutral',
    });
    void this.options.memoryRunner.run({
      characterId: character.id,
      timelineId: timeline.id,
    });

    if (generation !== this.generation) {
      return;
    }

    const maxParts = this.options.maxSpeechParts ?? 3;
    const parts = splitSpeechParts(completion.content, maxParts).slice(0, maxParts);

    if (parts.length === 0) {
      return;
    }

    await this.speakParts(parts, turnId, generation);
  }
}
