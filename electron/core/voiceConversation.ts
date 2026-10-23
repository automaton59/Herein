import { randomUUID } from 'node:crypto';
import { createPhase2Repositories } from '../data/repositories';
import { buildCoreChatPrompt } from './chatContext';
import type { CoreEventBus } from './eventBus';
import { chatCompletion, loadLlmConfig, type LlmConfig, type LlmMessage } from './llm';
import type { CoreMemoryRunner } from './memory';
import type { InteractionDispatcher } from './interaction';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface VoiceConversationOptions {
  repos: Repositories;
  events: CoreEventBus;
  memoryRunner: CoreMemoryRunner;
  dispatcher: InteractionDispatcher;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  fetchImpl?: typeof fetch;
  characterId?: string;
  maxTokens?: number;
  logger?: {
    info?: (message: string, detail?: unknown) => void;
    warn?: (message: string, detail?: unknown) => void;
  };
}

export class VoiceConversation {
  private readonly options: VoiceConversationOptions;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(options: VoiceConversationOptions) {
    this.options = options;
  }

  handleTranscript(text: string, turnId?: string) {
    const clean = text.trim().slice(0, 1000);

    if (!clean) {
      return;
    }

    const generation = ++this.generation;
    this.queue = this.queue
      .then(() => this.respond(clean, turnId, generation))
      .catch(error => {
        this.options.logger?.warn?.('voice conversation failed', error);
      });
  }

  interrupt() {
    this.generation += 1;
  }

  async stop() {
    this.generation += 1;
    await this.queue;
  }

  async whenIdle() {
    await this.queue;
  }

  private async respond(text: string, turnId: string | undefined, generation: number) {
    const character = this.options.characterId
      ? this.options.repos.characters.get(this.options.characterId)
      : this.options.repos.characters.list()[0];

    if (!character) {
      throw new Error('no character is available for voice conversation');
    }

    const timeline = this.options.repos.timelines.getPrimaryForCharacter(character.id)
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
    const systemPrompt = buildCoreChatPrompt({
      repos: this.options.repos,
      character,
      timeline,
      audience: 'private',
    });
    const completion = await chatCompletion(config, [
      { role: 'system', content: systemPrompt },
      ...llmMessages,
    ], {
      maxTokens: this.options.maxTokens,
      fetchImpl: this.options.fetchImpl,
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
    });
    void this.options.memoryRunner.run({
      characterId: character.id,
      timelineId: timeline.id,
    });

    if (generation !== this.generation) {
      return;
    }

    await this.options.dispatcher.speak({
      text: completion.content.slice(0, 500),
      source: 'chat',
      priority: 'normal',
      interruptible: true,
      turnId,
    });
  }
}
