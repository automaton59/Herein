import { randomUUID } from 'node:crypto';
import type { LlmConfig } from '../core/llm';
import type { createPhase2Repositories } from '../data/repositories';
import { recommendContent } from './contentRecommender';
import {
  getNeteaseCandidates,
  type NeteaseCandidateSource,
} from './neteaseCandidates';

type Repositories = ReturnType<typeof createPhase2Repositories>;

export interface SharedSong {
  itemId: string;
  title: string;
  creator?: string;
  coverUrl?: string;
  shareLine: string;
}

export interface ProactiveShareResult {
  status: 'shared' | 'skipped' | 'empty' | 'blocked';
  reason?: string;
  song?: SharedSong;
}

export interface ProactiveShareOptions {
  repos: Repositories;
  llmConfig: LlmConfig;
  /**
   * Produces song candidates. When omitted the Core falls back to the built-in
   * read-only NetEase client; the netease plugin is the preferred source.
   */
  fetchCandidates?: () => Promise<unknown[]>;
  promptPath?: string;
  characterName?: string;
  fetchImpl?: typeof fetch;
  publish?: (song: SharedSong) => void;
  notify?: (song: SharedSong) => void | Promise<void>;
  intervalMs?: number;
  now?: () => Date;
}

export class ProactiveShareScheduler {
  private readonly options: ProactiveShareOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(options: ProactiveShareOptions) {
    this.options = options;
  }

  start() {
    if (this.timer) {
      return;
    }

    const interval = this.options.intervalMs ?? 90 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, interval);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<ProactiveShareResult> {
    if (this.ticking) {
      return { status: 'skipped', reason: 'already running' };
    }

    this.ticking = true;

    try {
      const now = (this.options.now ?? (() => new Date()))();
      const last = this.options.repos.recommendationEvents.lastRecommendedAt();

      if (last) {
        const elapsed = now.getTime() - new Date(last).getTime();
        const interval = this.options.intervalMs ?? 90 * 60 * 1000;

        if (Number.isFinite(elapsed) && elapsed < interval) {
          return { status: 'skipped', reason: 'interval not reached' };
        }
      }

      const candidates = await (this.options.fetchCandidates
        ? this.options.fetchCandidates()
        : getNeteaseCandidates({ limit: 3 })) as Array<{
        itemId: string;
        title: string;
        creator?: string;
        coverUrl?: string;
      }>;

      if (candidates.length === 0) {
        return { status: 'empty', reason: 'no candidates' };
      }

      const first = candidates[0];
      const recentItemIds = this.options.repos.recommendationEvents.recentItemIds(
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );
      const feedbackEvents = this.options.repos.recommendationEvents.recent(30);

      const result = await recommendContent({
        llmConfig: this.options.llmConfig,
        context: '你刚刷到一首还不错的歌，想顺手转给对方。从候选里挑一首最合适的，别解释。',
        candidates,
        taste: {
          likedItemIds: feedbackEvents.filter(event => event.feedback === 'like').map(event => event.itemId),
          skippedItemIds: feedbackEvents.filter(event => event.feedback === 'skip').map(event => event.itemId),
        },
        characterName: this.options.characterName ?? '角色',
        gate: {
          now,
          itemId: first.itemId,
          lastRecommendedAt: last,
          recentItemIds,
          turnsSinceLast: 99,
        },
        promptPath: this.options.promptPath,
        fetchImpl: this.options.fetchImpl,
      });

      if (!result.decision.shouldRecommend || !result.decision.itemId) {
        return { status: 'blocked', reason: result.blockedByGate ?? 'model declined' };
      }

      const chosen = candidates.find(item => item.itemId === result.decision.itemId) ?? first;
      const shareLine = (result.decision.reason?.trim() || '这个好听。').slice(0, 40);

      this.options.repos.recommendationEvents.record({
        id: randomUUID(),
        itemId: chosen.itemId,
        itemType: result.decision.type ?? 'song',
        recommendedAt: now.toISOString(),
      });

      const song: SharedSong = {
        itemId: chosen.itemId,
        title: chosen.title,
        creator: chosen.creator,
        coverUrl: chosen.coverUrl,
        shareLine,
      };
      this.options.publish?.(song);

      if (this.options.notify) {
        try {
          await this.options.notify(song);
        } catch {
          // Notification is best-effort; the recommendation is already recorded.
        }
      }

      return { status: 'shared', song };
    } finally {
      this.ticking = false;
    }
  }
}
