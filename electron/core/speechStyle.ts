const LEADING_CONNECTORS = /^(那么|然后|其实|总的来说|首先|其次|总之|所以说|不过呢)[，,：:\s]+/;
const SPEECH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[`*#]/g, ''],
  [/——/g, '，'],
  [/；/g, '。'],
  [/、/g, '，'],
];

function cleanForSpeech(text: string): string {
  let result = text.replace(/\r\n/g, '\n').trim();

  for (const [pattern, replacement] of SPEECH_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  return result
    .split('\n')
    .map(line => line.trim().replace(LEADING_CONNECTORS, ''))
    .filter(Boolean)
    .join('。')
    .replace(/。{2,}/g, '。')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) {
    return [sentence];
  }

  const parts: string[] = [];
  let rest = sentence;

  while (rest.length > maxChars && parts.length < 4) {
    const window = rest.slice(0, maxChars);
    const cut = Math.max(
      window.lastIndexOf('，'),
      window.lastIndexOf('。'),
      window.lastIndexOf('？'),
      window.lastIndexOf('！'),
    );

    if (cut <= 4) {
      break;
    }

    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }

  if (rest) {
    parts.push(rest);
  }

  return parts;
}

export function toSpeechStyle(text: string): string {
  return cleanForSpeech(text);
}

export function splitSpeechParts(text: string, maxParts = 3, maxChars = 42): string[] {
  const clean = toSpeechStyle(text);

  if (!clean) {
    return [];
  }

  const sentences = clean.match(/[^。！？!?…\n]+[。！？!?…]?/g) ?? [clean];
  const parts: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    if (!trimmed) {
      continue;
    }

    parts.push(...splitLongSentence(trimmed, maxChars));
  }

  if (parts.length <= maxParts) {
    return parts.filter(Boolean);
  }

  return [
    ...parts.slice(0, maxParts - 1),
    parts.slice(maxParts - 1).join(''),
  ].filter(Boolean);
}
