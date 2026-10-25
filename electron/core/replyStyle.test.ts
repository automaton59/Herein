/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { isSilenceRequest, parseAssistantReply } from './replyStyle';

describe('assistant reply style', () => {
  it('keeps a short natural reply as one bubble', () => {
    const reply = parseAssistantReply('嗯，记下了。');

    expect(reply.silent).toBe(false);
    expect(reply.bubbles).toHaveLength(1);
    expect(reply.bubbles[0].text).toBe('嗯，记下了');
    expect(reply.bubbles[0].delayMs).toBeGreaterThanOrEqual(500);
  });

  it('turns a pipe or newline into two bubbles with different delays', () => {
    const reply = parseAssistantReply('诶？|三个都开了呀。');

    expect(reply.bubbles.map(bubble => bubble.text)).toEqual(['诶？', '三个都开了呀']);
    expect(reply.bubbles[1].delayMs).toBeGreaterThan(reply.bubbles[0].delayMs);
    expect(reply.text).toBe('诶？\n三个都开了呀');
  });

  it('drops AI-isms and keeps the useful sentence', () => {
    const reply = parseAssistantReply('作为一个AI，我希望能帮到你。今天几点睡的？');

    expect(reply.silent).toBe(false);
    expect(reply.bubbles).toHaveLength(1);
    expect(reply.bubbles[0].text).toBe('今天几点睡的？');
    expect(reply.text).not.toContain('AI');
  });

  it('drops markdown structure and list markers', () => {
    const reply = parseAssistantReply('## 建议\n- 先睡觉\n- 明天再说');

    expect(reply.bubbles.map(bubble => bubble.text)).toEqual(['建议', '先睡觉 明天再说']);
  });

  it('treats the silent marker as silence', () => {
    expect(parseAssistantReply('<silent/>')).toEqual({
      silent: true,
      text: '',
      bubbles: [],
    });
    expect(parseAssistantReply('[silent]')).toEqual({
      silent: true,
      text: '',
      bubbles: [],
    });
  });

  it('treats an all-AI-ism reply as silence instead of sending filler', () => {
    expect(parseAssistantReply('总的来说，我理解你的感受。').silent).toBe(true);
  });

  it('splits an overlong sentence into two readable bubbles', () => {
    const reply = parseAssistantReply('我今天在楼下看到一只特别胖的橘猫，它蹲在电动车上面一动不动，旁边还有人给它拍照，我看了好久才走。');

    expect(reply.bubbles).toHaveLength(2);
    expect(reply.bubbles.every(bubble => bubble.text.length <= 90)).toBe(true);
  });

  it('recognizes explicit requests for silence', () => {
    expect(isSilenceRequest('别说话了，让我静静')).toBe(true);
    expect(isSilenceRequest('今天有点累')).toBe(false);
  });

  it('honours tuning for bubble count and length', () => {
    const threeLines = '第一句。|第二句。|第三句。';

    expect(parseAssistantReply(threeLines).bubbles).toHaveLength(2);
    expect(parseAssistantReply(threeLines, { maxBubbles: 3 }).bubbles).toHaveLength(3);

    // Raising the char cap keeps a long single line in one bubble.
    const long = '这句真的挺长的，'.repeat(9);
    const untuned = parseAssistantReply(long);
    const tuned = parseAssistantReply(long, { maxBubbleChars: 200 });

    expect(untuned.bubbles.length).toBe(2);
    expect(tuned.bubbles.length).toBe(1);
  });
});
