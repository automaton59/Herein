export interface ReplyBubble {
  text: string;
  delayMs: number;
}

export interface ShapedAssistantReply {
  silent: boolean;
  text: string;
  bubbles: ReplyBubble[];
}

const SILENT_MARKERS = [
  /<\s*silent\s*\/?\s*>/i,
  /\[\s*silent\s*\]/i,
  /（\s*silent\s*）/i,
];

export const SILENCE_REQUEST = /别说话|闭嘴|安静点|让我静静|让我一个人|不想说话|先别回|别回我/;

const AI_ISM = [
  /作为一个?(?:AI|人工智能|语言模型)/i,
  /我只是一个?(?:AI|人工智能|语言模型)/i,
  /希望(?:能|可以)?(?:对你)?(?:有所)?帮助/,
  /总的来说|综上所述|总而言之|总之/,
  /首先|其次|最后一点/,
  /值得注意的是|不难发现|不妨|或许你可以尝试/,
  /我理解你的感受|你已经很棒了|我陪着你|我听着|先别硬撑/,
  /有什么我可以帮/,
];

const TRAILING_PERIOD = /。$/;
const MAX_BUBBLES = 2;
const MAX_BUBBLE_CHARS = 46;

function silent(): ShapedAssistantReply {
  return { silent: true, text: '', bubbles: [] };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[a-zA-Z]*\s*/g, '')
    .replace(/```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.、)]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function filterAiIsh(text: string): string {
  const cleaned = stripMarkdown(text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!cleaned) {
    return '';
  }

  const lines = cleaned
    .split('\n')
    .map(line => {
      const sentences = line.match(/[^。！？!?\n]+[。！？!?]?/g) ?? [];

      return sentences
        .map(sentence => sentence.trim())
        .filter(Boolean)
        .filter(sentence => !AI_ISM.some(pattern => pattern.test(sentence)))
        .join('')
        .trim();
    })
    .filter(Boolean);

  return lines.join('\n').trim();
}

function splitLongBubble(text: string): [string, string] | null {
  if (text.length <= MAX_BUBBLE_CHARS) {
    return null;
  }

  const middle = Math.floor(text.length / 2);
  const candidates = ['。', '！', '？', '；', '，']
    .flatMap(mark => {
      const indexes: number[] = [];
      let from = 0;

      while (from < text.length) {
        const index = text.indexOf(mark, from);

        if (index < 0) {
          break;
        }

        indexes.push(index + 1);
        from = index + 1;
      }

      return indexes;
    })
    .filter(index => index > 4 && index < text.length - 4)
    .sort((left, right) => Math.abs(left - middle) - Math.abs(right - middle));

  const splitAt = candidates[0];

  if (!splitAt) {
    return null;
  }

  return [text.slice(0, splitAt).trim(), text.slice(splitAt).trim()];
}

function normalizeBubble(text: string): string {
  let bubble = text.replace(/\s+/g, ' ').trim();

  if (!bubble || /^[。！？!?…\s]+$/.test(bubble)) {
    return '';
  }

  if (bubble.length <= 30) {
    bubble = bubble.replace(TRAILING_PERIOD, '');
  }

  if (bubble.length > 90) {
    bubble = `${bubble.slice(0, 88)}…`;
  }

  return bubble;
}

function splitIntoBubbles(text: string): string[] {
  const parts = text
    .split(/\n+|\s*[|｜]\s*/)
    .map(normalizeBubble)
    .filter(Boolean);

  if (parts.length === 0) {
    return [];
  }

  let bubbles = parts.slice(0, MAX_BUBBLES);

  if (parts.length > MAX_BUBBLES) {
    bubbles = [parts[0], parts.slice(1).join(' ')];
  }

  if (bubbles.length === 1) {
    const split = splitLongBubble(bubbles[0]);

    if (split) {
      bubbles = [normalizeBubble(split[0]), normalizeBubble(split[1])].filter(Boolean);
    }
  }

  return bubbles;
}

function delayFor(text: string, index: number): number {
  const base = index === 0 ? 650 : 1400;
  const cap = index === 0 ? 2600 : 3800;

  return Math.max(500, Math.min(cap, Math.round(base + text.length * 45)));
}

export function isSilenceRequest(text: string): boolean {
  return SILENCE_REQUEST.test(text);
}

export function parseAssistantReply(raw: string): ShapedAssistantReply {
  const trimmed = raw.trim();

  if (!trimmed || SILENT_MARKERS.some(pattern => pattern.test(trimmed))) {
    return silent();
  }

  const filtered = filterAiIsh(trimmed);
  const bubbles = splitIntoBubbles(filtered);

  if (bubbles.length === 0) {
    return silent();
  }

  return {
    silent: false,
    text: bubbles.join('\n'),
    bubbles: bubbles.map((text, index) => ({
      text,
      delayMs: delayFor(text, index),
    })),
  };
}
