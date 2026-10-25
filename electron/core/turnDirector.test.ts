/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { directTurn } from './turnDirector';

const now = new Date('2026-10-24T12:00:00.000Z');

describe('turn director', () => {
  it('stays silent when the user explicitly asks for quiet', () => {
    const decision = directTurn({ userText: '别说话了，让我静静。', now });

    expect(decision.act).toBe('silent');
    expect(decision.maxTokens).toBe(0);
    expect(decision.reason).toContain('silence');
  });

  it('stays silent for a bare acknowledgement right after a reply', () => {
    const decision = directTurn({
      userText: '嗯',
      now,
      lastAssistantAt: '2026-10-24T11:59:30.000Z',
    });

    expect(decision.act).toBe('silent');
  });

  it('answers a question', () => {
    const decision = directTurn({ userText: '你明天有空吗？', now });

    expect(decision.act).toBe('reply');
    expect(decision.maxTokens).toBeGreaterThan(60);
  });

  it('elaborates when the user asks for analysis', () => {
    const decision = directTurn({ userText: '帮我分析一下这个方案', now });

    expect(decision.act).toBe('elaborate');
    expect(decision.maxTokens).toBeGreaterThan(200);
  });

  it('listens instead of talking over a long vent', () => {
    const decision = directTurn({
      userText: '今天真的烦死了，老板从早上开始就一直在挑毛病，我改了一版又一版，最后他还是说不行，我真的不知道该怎么办了，感觉自己做什么都不对，特别难受。',
      now,
    });

    expect(decision.act).toBe('silent');
    expect(decision.reason).toContain('vent');
  });

  it('reacts briefly to an emotional statement', () => {
    const decision = directTurn({ userText: '今天累死了', now });

    expect(decision.act).toBe('react');
    expect(decision.maxTokens).toBeLessThanOrEqual(60);
  });

  it('shortens replies when energy is low', () => {
    const high = directTurn({ userText: '今天发生了什么', now, affect: { energy: 1 } });
    const low = directTurn({ userText: '今天发生了什么', now, affect: { energy: 0.2 } });

    expect(low.maxTokens).toBeLessThan(high.maxTokens);
  });

  it('honours tuning overrides', () => {
    // A 90-char vent is silent by default (threshold 60); raising the
    // threshold past its length downgrades it to a light reaction.
    const longVent = '累死'.repeat(30);
    expect(directTurn({ userText: longVent, now }).act).toBe('silent');

    const tuned = directTurn({ userText: longVent, now }, { ventLongChars: 200 });
    expect(tuned.act).toBe('react');

    // maxTokens bases are tunable.
    const question = directTurn({ userText: '今晚吃什么', now });
    expect(question.maxTokens).toBe(220);

    const tunedQuestion = directTurn(
      { userText: '今晚吃什么', now },
      { maxTokens: { question: 999 } },
    );
    expect(tunedQuestion.maxTokens).toBe(999);

    // Recent-reply window can be shortened so bare acks get a reaction again.
    const justNow = new Date(now.getTime() - 10_000);
    const bare = { userText: '嗯', now, lastAssistantAt: justNow.toISOString() };
    expect(directTurn(bare).act).toBe('silent');
    expect(directTurn(bare, { recentReplyWindowMs: 5_000 }).act).toBe('react');
  });
});
