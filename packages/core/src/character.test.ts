import { describe, expect, it } from 'vitest';
import { validateCharacterPack } from './character';

const valid = {
  schemaVersion: 1,
  id: 'test-character',
  name: '测试角色',
  nickname: '小蓝',
  relationshipFrame: '女友',
  personality: {
    core: ['聪明', '嘴硬', '贪吃但克制', '有自尊', '体贴', '松弛'],
    boundaries: ['不查岗', '不控制'],
  },
  speakingStyle: {
    defaultAddress: '你',
    occasionalAddress: '哥哥',
    sweetness: 4,
    stubbornness: 6,
    replyShape: 'one-action-one-line',
    examples: ['咋啦。', '诶？'],
  },
};

describe('character pack validation', () => {
  it('accepts a valid pack', () => {
    const result = validateCharacterPack(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('测试角色');
      expect(result.value.speakingStyle.occasionalAddress).toBe('哥哥');
    }
  });

  it('rejects missing required fields', () => {
    const result = validateCharacterPack({
      ...valid,
      name: '',
      personality: { core: [] },
      speakingStyle: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        'name must be a non-empty string',
        'personality.core must be a non-empty string array',
        'speakingStyle.defaultAddress must be a non-empty string',
      ]));
    }
  });

  it('rejects non-object input', () => {
    expect(validateCharacterPack(null)).toEqual({
      ok: false,
      errors: ['character pack must be an object'],
    });
  });
});
