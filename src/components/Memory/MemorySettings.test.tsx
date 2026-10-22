import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { APIProfile, AppConfig } from '../../services/interfaces';
import { MemorySettings } from './MemorySettings';

const profiles: APIProfile[] = [
  {
    id: 'profile-main',
    name: '主模型',
    provider: 'openai',
    model: 'gpt-4o-mini',
    encryptedApiKey: '',
    keyEncoding: 'plain:fallback',
  },
  {
    id: 'profile-memory',
    name: '总结模型',
    provider: 'custom',
    model: 'strict-json-model',
    encryptedApiKey: '',
    keyEncoding: 'plain:fallback',
  },
];

const value: Pick<AppConfig,
  | 'memoryEnabled'
  | 'memoryProfileMode'
  | 'memoryProfileId'
  | 'summaryTriggerMessageCount'
> = {
  memoryEnabled: true,
  memoryProfileMode: 'follow-chat',
  memoryProfileId: null,
  summaryTriggerMessageCount: 20,
};

describe('MemorySettings', () => {
  it('defaults to following the chat model and can switch to a dedicated global profile', () => {
    const onChange = vi.fn();

    render(<MemorySettings value={value} apiProfiles={profiles} onChange={onChange} />);

    expect(screen.getByRole('button', { name: '跟随聊天模型' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '指定 Profile' }));

    expect(onChange).toHaveBeenCalledWith({ memoryProfileMode: 'custom', memoryProfileId: 'profile-main' });
  });

  it('updates thresholds without exposing internal prompt controls', () => {
    const onChange = vi.fn();

    render(<MemorySettings value={{ ...value, memoryProfileMode: 'custom', memoryProfileId: 'profile-memory' }} apiProfiles={profiles} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('总结触发消息数'), { target: { value: '12' } });

    expect(onChange).toHaveBeenCalledWith({ summaryTriggerMessageCount: 12 });
    expect(screen.queryByLabelText('总结 Prompt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('抽取 Prompt')).not.toBeInTheDocument();
  });
});
