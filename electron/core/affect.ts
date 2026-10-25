import type { AffectStateRecord } from '../data/repositories';

export interface AffectInput {
  characterId: string;
  now: Date;
  recent: Array<{ role: string; content: string }>;
  previous?: AffectStateRecord | null;
}

const POSITIVE = /开心|高兴|喜欢|不错|顺利|好棒|笑死|哈哈|可爱|舒服|搞定|惊喜|期待/;
const NEGATIVE = /累|烦|难受|崩溃|生气|难过|吵架|压力|焦虑|失眠|被骂|委屈|不开心|孤独|失望/;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function baseEnergy(hour: number): number {
  if (hour < 6) {
    return 0.22;
  }

  if (hour < 8) {
    return 0.45;
  }

  if (hour < 12) {
    return 0.85;
  }

  if (hour < 14) {
    return 0.6;
  }

  if (hour < 19) {
    return 0.8;
  }

  if (hour < 23) {
    return 0.7;
  }

  return 0.4;
}

function sentiment(recent: AffectInput['recent']): number {
  let delta = 0;

  for (const message of recent.slice(-6)) {
    if (message.role !== 'user') {
      continue;
    }

    if (NEGATIVE.test(message.content)) {
      delta -= 0.22;
    }

    if (POSITIVE.test(message.content)) {
      delta += 0.16;
    }
  }

  return delta;
}

export function computeAffect(input: AffectInput): AffectStateRecord {
  const previous = input.previous;
  const hour = input.now.getHours();
  const energyBase = baseEnergy(hour);
  const energy = clamp((previous?.energy ?? energyBase) * 0.6 + energyBase * 0.4, 0.05, 1);
  const mood = clamp((previous?.mood ?? 0) * 0.6 + sentiment(input.recent), -2, 2);
  const busyBase = hour >= 9 && hour < 18 ? 0.3 : 0.15;
  const busy = clamp((previous?.busy ?? busyBase) * 0.8 + busyBase * 0.2, 0, 1);
  const patience = clamp(0.5 + energy * 0.3 + mood * 0.08, 0.1, 1);

  return {
    characterId: input.characterId,
    mood,
    energy,
    busy,
    patience,
    updatedAt: input.now.toISOString(),
  };
}

function energyLabel(value: number) {
  if (value < 0.3) {
    return '很低';
  }

  if (value < 0.5) {
    return '低';
  }

  if (value < 0.75) {
    return '正常';
  }

  return '高';
}

function moodLabel(value: number) {
  if (value < -0.8) {
    return '差';
  }

  if (value < 0) {
    return '有点低';
  }

  if (value < 0.8) {
    return '平稳';
  }

  return '好';
}

function busyLabel(value: number) {
  if (value > 0.7) {
    return '在忙';
  }

  if (value > 0.4) {
    return '有点忙';
  }

  return '闲';
}

export function affectPrompt(state: AffectStateRecord): string {
  const energy = energyLabel(state.energy);
  const mood = moodLabel(state.mood);
  const busy = busyLabel(state.busy);
  const patience = state.patience < 0.35 ? '没耐心' : state.patience < 0.65 ? '一般' : '有耐心';

  return [
    '【现在的你】',
    `精力：${energy}；心情：${mood}；状态：${busy}；耐心：${patience}。`,
    '精力低时句子更短、更慢；心情低时少用“！”，不主动开玩笑；在忙时可以晚点回。',
  ].join('\n');
}
