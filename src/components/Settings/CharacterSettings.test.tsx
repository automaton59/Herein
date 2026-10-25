import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../stores/settings';
import type { CharacterConfig } from '../../services/interfaces';
import { CharacterSettings } from './CharacterSettings';

const characters: CharacterConfig[] = [
  {
    id: 'haishixiang',
    name: '海拾香',
    description: '人格核心',
    scenario: '',
    firstMessage: '',
    systemPrompt: '',
  },
];

afterEach(() => {
  useSettingsStore.setState({
    characters,
    activeCharacterId: 'haishixiang',
    characterConfig: characters[0],
  });
});

describe('CharacterSettings', () => {
  it('shows the fixed persona without character create/duplicate/delete controls', () => {
    useSettingsStore.setState({
      characters,
      activeCharacterId: 'haishixiang',
      characterConfig: characters[0],
    });

    render(<CharacterSettings />);

    expect(screen.getByText('海拾香')).toBeInTheDocument();
    expect(screen.getByText('固定人格')).toBeInTheDocument();
    expect(screen.getByText('本地开场白')).toBeInTheDocument();
    expect(screen.queryByText('选择角色')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '复制' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('saves the local opening line without changing the persona identity', () => {
    useSettingsStore.setState({
      characters,
      activeCharacterId: 'haishixiang',
      characterConfig: characters[0],
    });

    render(<CharacterSettings />);

    fireEvent.change(screen.getByPlaceholderText('可选，留空则不显示'), {
      target: { value: '我醒着。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存开场白' }));

    expect(useSettingsStore.getState().characterConfig.firstMessage).toBe('我醒着。');
    expect(useSettingsStore.getState().characterConfig.name).toBe('海拾香');
  });

  it('allows clearing the opening line without inventing a default greeting', () => {
    useSettingsStore.setState({
      characters,
      activeCharacterId: 'haishixiang',
      characterConfig: characters[0],
    });

    render(<CharacterSettings />);

    fireEvent.change(screen.getByPlaceholderText('可选，留空则不显示'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存开场白' }));

    expect(useSettingsStore.getState().characterConfig.firstMessage).toBe('');
    expect(screen.getByText('已清空，聊天页不会显示开场白')).toBeInTheDocument();
    expect(screen.getByText(/留空时聊天页不显示开场白/)).toBeInTheDocument();
  });
});
