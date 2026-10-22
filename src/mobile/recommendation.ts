export interface RecentRecommendation {
  itemId: string;
  at: string;
}

const INTENT = /想听|听歌|推荐.{0,4}歌|好无聊|有什么歌|来首歌|放首歌|music|song/i;
const UPSET = /难过|难受|烦死|生气|想哭|崩溃|焦虑|吵架|不开心|累死|压力好大/;

export function wantsRecommendation(text: string) {
  return INTENT.test(text);
}

export function isUpsetText(text: string) {
  return UPSET.test(text);
}

export function shouldProactivelyShare(input: {
  now: Date;
  text: string;
  lastRecommendedAt?: string | null;
  random?: () => number;
  cooldownMinutes?: number;
  probability?: number;
}) {
  if (isUpsetText(input.text) || input.text.length > 60) {
    return false;
  }

  const cooldownMinutes = input.cooldownMinutes ?? 75;
  if (input.lastRecommendedAt) {
    const last = new Date(input.lastRecommendedAt).getTime();
    if (Number.isFinite(last) && input.now.getTime() - last < cooldownMinutes * 60_000) {
      return false;
    }
  }

  return (input.random ?? Math.random)() < (input.probability ?? 0.18);
}

export function pickSongQuery(text: string): string | undefined {
  if (/夜|睡|晚|失眠/.test(text)) {
    return '夜晚';
  }

  if (/累|烦|放松|安静/.test(text)) {
    return '放松';
  }

  if (/雨/.test(text)) {
    return '雨天';
  }

  return undefined;
}

export function canShowRecommendation(input: {
  now: Date;
  itemId: string;
  lastRecommendedAt?: string | null;
  recent?: RecentRecommendation[];
  cooldownMinutes?: number;
  noRepeatDays?: number;
}): boolean {
  const cooldownMinutes = input.cooldownMinutes ?? 45;

  if (input.lastRecommendedAt) {
    const last = new Date(input.lastRecommendedAt).getTime();

    if (Number.isFinite(last) && input.now.getTime() - last < cooldownMinutes * 60_000) {
      return false;
    }
  }

  const cutoff = input.now.getTime() - (input.noRepeatDays ?? 7) * 24 * 60 * 60_000;

  return !(input.recent ?? []).some(item => (
    item.itemId === input.itemId && new Date(item.at).getTime() >= cutoff
  ));
}
