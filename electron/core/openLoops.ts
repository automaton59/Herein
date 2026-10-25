const LOOP_PATTERNS = [
  /(?:回头|晚点|明天|白天|之后|到时候|改天|下周|过几天).{0,24}(?:再说|再看|再聊|告诉你|找你|看情况|看看|说)/,
  /(?:记得|别忘了).{0,30}/,
  /(?:我|我们).{0,12}(?:再|回头).{0,12}(?:说|聊|看)/,
];

const MAX_LOOP_LENGTH = 80;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractOpenLoops(text: string): string[] {
  const clean = normalize(text);
  const loops: string[] = [];

  for (const pattern of LOOP_PATTERNS) {
    const match = clean.match(pattern);

    if (!match) {
      continue;
    }

    const loop = match[0].trim().slice(0, MAX_LOOP_LENGTH);

    if (loop.length < 4) {
      continue;
    }

    if (loops.some(existing => existing.includes(loop) || loop.includes(existing))) {
      continue;
    }

    loops.push(loop);
  }

  return loops;
}
