import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, MemoryItem } from '../../services/phase2/types';
import { MemoryPanel } from './MemoryPanel';

const summary: ConversationSummary = {
  id: 'summary-1',
  timelineId: 'timeline-1',
  content: '用户正在准备搬家，和 AL-1S 讨论了打包安排。',
  messageCount: 12,
  sourceMessageIds: ['msg-1'],
};

const memories: MemoryItem[] = [
  {
    id: 'mem-1',
    characterId: 'char-1',
    timelineId: 'timeline-1',
    scope: 'character',
    kind: 'state',
    content: '用户下周要搬去上海。',
    currentValue: '下周搬去上海',
    previousValue: '最近在杭州',
    status: 'active',
    includeInContext: true,
  },
  {
    id: 'mem-2',
    characterId: 'char-1',
    timelineId: 'timeline-1',
    scope: 'character',
    kind: 'preference',
    content: '用户不喜欢重复确认。',
    status: 'disabled',
    includeInContext: false,
  },
  {
    id: 'mem-3',
    characterId: 'char-1',
    timelineId: 'timeline-1',
    scope: 'timeline',
    kind: 'relationship',
    content: '用户和 AL-1S 约定睡前说晚安。',
    currentValue: '睡前互道晚安',
    status: 'active',
    includeInContext: false,
  },
];

describe('MemoryPanel', () => {
  it('uses one structured-memory list with segmented views for next context, all, and disabled memories', () => {
    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={memories}
      />,
    );

    expect(screen.getByText('用户正在准备搬家，和 AL-1S 讨论了打包安排。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '下次回复会参考' })).not.toBeInTheDocument();

    const structuredMemories = screen.getByRole('region', { name: '结构化记忆' });
    expect(screen.getByRole('button', { name: '下次参考' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(structuredMemories).getByText('下周搬去上海')).toBeInTheDocument();
    expect(within(structuredMemories).queryByText('用户不喜欢重复确认。')).not.toBeInTheDocument();
    expect(within(structuredMemories).queryByText('睡前互道晚安')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(structuredMemories).getByText('下周搬去上海')).toBeInTheDocument();
    expect(within(structuredMemories).getByText('用户不喜欢重复确认。')).toBeInTheDocument();
    expect(within(structuredMemories).getByText('睡前互道晚安')).toBeInTheDocument();
    const disabledMemory = within(structuredMemories).getByText('用户不喜欢重复确认。').closest('article');
    expect(disabledMemory).not.toBeNull();
    expect(within(disabledMemory as HTMLElement).getByText('已禁用')).toBeInTheDocument();
    expect(within(structuredMemories).getByText('不进上下文')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '已禁用' }));
    expect(within(structuredMemories).queryByText('下周搬去上海')).not.toBeInTheDocument();
    expect(within(structuredMemories).getByText('用户不喜欢重复确认。')).toBeInTheDocument();
    expect(within(structuredMemories).queryByText('睡前互道晚安')).not.toBeInTheDocument();
  });

  it('can collapse and restore the current summary', () => {
    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={memories}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起当前总结' }));
    expect(screen.queryByText('用户正在准备搬家，和 AL-1S 讨论了打包安排。')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开当前总结' }));
    expect(screen.getByText('用户正在准备搬家，和 AL-1S 讨论了打包安排。')).toBeInTheDocument();
  });

  it('edits the current summary', () => {
    const onUpdateSummary = vi.fn();

    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={memories}
        onUpdateSummary={onUpdateSummary}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑当前总结' }));
    fireEvent.change(screen.getByLabelText('编辑当前总结内容'), {
      target: { value: '用户晚上主动问候，关系表现出亲近和关心。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));

    expect(onUpdateSummary).toHaveBeenCalledWith(expect.objectContaining({
      id: 'summary-1',
      timelineId: 'timeline-1',
      content: '用户晚上主动问候，关系表现出亲近和关心。',
    }));
    expect(screen.getByText('用户晚上主动问候，关系表现出亲近和关心。')).toBeInTheDocument();
  });

  it('submits a manual memory item', () => {
    const onCreateMemory = vi.fn();

    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={[]}
        onCreateMemory={onCreateMemory}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加记忆' }));
    fireEvent.change(screen.getByLabelText('新增内容'), {
      target: { value: '8 月 3 日晚上用户送过礼物。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }));

    expect(onCreateMemory).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 'char-1',
      timelineId: 'timeline-1',
      kind: 'event',
      scope: 'character',
      content: '8 月 3 日晚上用户送过礼物。',
      origin: 'manual',
      status: 'active',
      includeInContext: true,
    }));
  });

  it('edits a structured memory item', () => {
    const onUpdateMemory = vi.fn();

    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={memories}
        onUpdateMemory={onUpdateMemory}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '编辑记忆' })[0]);
    fireEvent.change(screen.getByLabelText('编辑内容'), {
      target: { value: '用户下周会从杭州搬去上海。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(onUpdateMemory).toHaveBeenCalledWith('mem-1', expect.objectContaining({
      content: '用户下周会从杭州搬去上海。',
      // state 类型记忆的 currentValue 跟随编辑后的内容更新
      currentValue: '用户下周会从杭州搬去上海。',
    }));
  });

  it('deletes a structured memory item', () => {
    const onDeleteMemory = vi.fn();

    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={memories}
        onDeleteMemory={onDeleteMemory}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: '删除记忆' })[0]);

    expect(onDeleteMemory).toHaveBeenCalledWith('mem-1');
  });

  it('toggles whether a memory is included in the next reply context', () => {
    const onUpdateMemory = vi.fn();

    render(
      <MemoryPanel
        characterId="char-1"
        characterName="AL-1S"
        summary={summary}
        memories={memories}
        onUpdateMemory={onUpdateMemory}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getAllByRole('button', { name: '加入上下文' })[0]);

    expect(onUpdateMemory).toHaveBeenCalledWith('mem-3', expect.objectContaining({
      includeInContext: true,
      status: 'active',
    }));
  });
});
