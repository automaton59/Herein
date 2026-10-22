import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../stores/settings';
import type { CharacterConfig } from '../../services/interfaces';
import { CharacterSettings } from './CharacterSettings';

const characters: CharacterConfig[] = [
  {
    id: 'char-1',
    name: 'AL-1S',
    description: '一个温柔、机敏、有点俏皮的 AI 女友。',
    scenario: '你和用户正在一个私密、放松的聊天空间里。',
    firstMessage: '我在。今天想从哪里聊起？',
    systemPrompt: '始终以 AL-1S 的身份回应。',
  },
];

afterEach(() => {
  useSettingsStore.setState({
    characters: [],
    activeCharacterId: '',
    characterConfig: characters[0],
  });
});

describe('CharacterSettings', () => {
  it('shows user-facing character fields while hiding scenario and behavior prompt fields', () => {
    useSettingsStore.setState({
      characters,
      activeCharacterId: 'char-1',
      characterConfig: characters[0],
    });

    render(<CharacterSettings />);

    expect(screen.getByText('角色名')).toBeInTheDocument();
    expect(screen.getByText('角色设定')).toBeInTheDocument();
    expect(screen.getByText('开场白')).toBeInTheDocument();
    expect(screen.queryByText('场景')).not.toBeInTheDocument();
    expect(screen.queryByText('行为提示词')).not.toBeInTheDocument();
  });
});
