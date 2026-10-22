import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, Eye, EyeOff, Pencil, Pin, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { ConversationSummary, MemoryItem, MemoryKind, MemoryScope } from '../../services/phase2/types';
import { createPhase2Client } from '../../services/phase2/client';

const KIND_LABELS: Record<MemoryKind, string> = {
  state: '状态',
  event: '事件',
  preference: '偏好',
  relationship: '关系',
  profile: '资料',
};

const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: '全局',
  character: '当前角色',
  timeline: '当前聊天',
};

const KIND_OPTIONS: Array<{ value: MemoryKind; label: string }> = [
  { value: 'event', label: KIND_LABELS.event },
  { value: 'state', label: KIND_LABELS.state },
  { value: 'preference', label: KIND_LABELS.preference },
  { value: 'relationship', label: KIND_LABELS.relationship },
  { value: 'profile', label: KIND_LABELS.profile },
];

const SCOPE_OPTIONS: Array<{ value: MemoryScope; label: string }> = [
  { value: 'character', label: SCOPE_LABELS.character },
  { value: 'global', label: SCOPE_LABELS.global },
  { value: 'timeline', label: SCOPE_LABELS.timeline },
];

interface MemoryPanelProps {
  characterId: string;
  characterName: string;
  summary?: ConversationSummary | null;
  memories?: MemoryItem[];
  onUpdateSummary?: (summary: ConversationSummary) => void | Promise<void>;
  onCreateMemory?: (memory: MemoryItem) => void | Promise<void>;
  onUpdateMemory?: (id: string, patch: Partial<MemoryItem>) => void | Promise<void>;
  onDeleteMemory?: (id: string) => void | Promise<void>;
  onClose?: () => void;
}

interface MemoryDraft {
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
}

type MemoryView = 'context' | 'all' | 'disabled';

type MemoryWithTimestamps = MemoryItem & {
  createdAt?: string;
  updatedAt?: string;
};

const emptyDraft: MemoryDraft = {
  kind: 'event',
  scope: 'character',
  content: '',
};

function makeMemoryId() {
  return `memory_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function isContextMemory(memory: MemoryItem) {
  return memory.status !== 'disabled' && memory.includeInContext !== false;
}

function memoryTitle(memory: MemoryItem) {
  return memory.currentValue?.trim() || memory.content;
}

function memoryTimestamp(memory: MemoryWithTimestamps) {
  return Date.parse(memory.updatedAt ?? memory.createdAt ?? memory.sourceTime ?? '') || 0;
}

function sortMemories(memories: MemoryItem[]) {
  return [...memories].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }

    const leftActive = left.status !== 'disabled';
    const rightActive = right.status !== 'disabled';
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }

    const leftInContext = isContextMemory(left);
    const rightInContext = isContextMemory(right);
    if (leftInContext !== rightInContext) {
      return leftInContext ? -1 : 1;
    }

    return memoryTimestamp(right as MemoryWithTimestamps) - memoryTimestamp(left as MemoryWithTimestamps);
  });
}

function draftFromMemory(memory: MemoryItem): MemoryDraft {
  return {
    kind: memory.kind,
    scope: memory.scope,
    content: memory.content,
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function badgeClass(memory: MemoryItem) {
  if (memory.status === 'disabled') {
    return 'border-slate-200 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400';
  }

  if (isContextMemory(memory)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100';
  }

  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100';
}

export function MemoryPanel({
  characterId,
  characterName,
  summary,
  memories,
  onUpdateSummary,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory,
  onClose,
}: MemoryPanelProps) {
  const [loadedSummary, setLoadedSummary] = useState<ConversationSummary | null>(summary ?? null);
  const [loadedMemories, setLoadedMemories] = useState<MemoryItem[]>(memories ?? []);
  const [timelineId, setTimelineId] = useState(summary?.timelineId ?? memories?.[0]?.timelineId ?? null);
  const [newDraft, setNewDraft] = useState<MemoryDraft>(emptyDraft);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MemoryDraft>(emptyDraft);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(summary?.content ?? '');
  const [memoryView, setMemoryView] = useState<MemoryView>('context');

  useEffect(() => {
    if (summary !== undefined) {
      setLoadedSummary(summary);
      setTimelineId(current => summary?.timelineId ?? current);
      if (!editingSummary) {
        setSummaryDraft(summary?.content ?? '');
      }
    }
  }, [editingSummary, summary]);

  useEffect(() => {
    if (memories !== undefined) {
      setLoadedMemories(memories);
      setTimelineId(current => current ?? memories[0]?.timelineId ?? null);
    }
  }, [memories]);

  useEffect(() => {
    if (summary !== undefined || memories !== undefined || !window.electron?.phase2) {
      return;
    }

    let cancelled = false;

    async function loadMemory() {
      const client = createPhase2Client();
      const timeline = await client.timeline.getPrimary(characterId);

      if (!timeline || cancelled) {
        return;
      }

      const [nextSummary, nextMemories] = await Promise.all([
        client.summary.get(timeline.id),
        client.memory.list({ characterId, timelineId: timeline.id, activeOnly: false }),
      ]);

      if (!cancelled) {
        setTimelineId(timeline.id);
        setLoadedSummary(nextSummary);
        setLoadedMemories(nextMemories);
      }
    }

    void loadMemory().catch(error => setFeedback(error instanceof Error ? error.message : '读取记忆失败'));

    return () => {
      cancelled = true;
    };
  }, [characterId, memories, summary]);

  const structuredMemories = useMemo(
    () => sortMemories(loadedMemories),
    [loadedMemories],
  );

  const contextMemories = useMemo(
    () => structuredMemories.filter(isContextMemory),
    [structuredMemories],
  );
  const disabledMemories = useMemo(
    () => structuredMemories.filter(memory => memory.status === 'disabled'),
    [structuredMemories],
  );
  const visibleMemories = useMemo(() => {
    if (memoryView === 'context') {
      return contextMemories;
    }

    if (memoryView === 'disabled') {
      return disabledMemories;
    }

    return structuredMemories;
  }, [contextMemories, disabledMemories, memoryView, structuredMemories]);

  const updateMemory = async (id: string, patch: Partial<MemoryItem>) => {
    if (onUpdateMemory) {
      await onUpdateMemory(id, patch);
    } else if (window.electron?.phase2) {
      await createPhase2Client().memory.update(id, patch);
    }

    setLoadedMemories(current => current.map(memory => memory.id === id ? { ...memory, ...patch } : memory));
  };

  const startEditingSummary = () => {
    setFeedback(null);
    setSummaryOpen(true);
    setEditingSummary(true);
    setSummaryDraft(loadedSummary?.content ?? '');
  };

  const saveSummary = async () => {
    const content = summaryDraft.trim();
    if (!content) {
      setFeedback('请先写入总结内容');
      return;
    }

    const nextTimelineId = loadedSummary?.timelineId ?? timelineId;
    if (!nextTimelineId) {
      setFeedback('还没有可保存总结的聊天时间线');
      return;
    }

    const nextSummary: ConversationSummary = {
      id: loadedSummary?.id ?? `summary_${nextTimelineId}`,
      timelineId: nextTimelineId,
      content,
      messageCount: loadedSummary?.messageCount ?? 0,
      tokenEstimate: loadedSummary?.tokenEstimate,
      sourceMessageIds: loadedSummary?.sourceMessageIds ?? [],
      status: loadedSummary?.status,
    };

    if (onUpdateSummary) {
      await onUpdateSummary(nextSummary);
    } else if (window.electron?.phase2) {
      await createPhase2Client().summary.upsert(nextSummary);
    }

    setLoadedSummary(nextSummary);
    setEditingSummary(false);
    setFeedback('总结已更新');
  };

  const deleteMemory = async (id: string) => {
    if (onDeleteMemory) {
      await onDeleteMemory(id);
    } else if (window.electron?.phase2) {
      await createPhase2Client().memory.delete(id);
    }

    setLoadedMemories(current => current.filter(memory => memory.id !== id));
    if (editingMemoryId === id) {
      setEditingMemoryId(null);
    }
  };

  const startEditing = (memory: MemoryItem) => {
    setFeedback(null);
    setEditingMemoryId(memory.id);
    setEditDraft(draftFromMemory(memory));
  };

  const saveEditingMemory = async () => {
    if (!editingMemoryId) {
      return;
    }

    const content = editDraft.content.trim();
    if (!content) {
      setFeedback('请先写入记忆内容');
      return;
    }

    // 用户编辑只关心内容、类型、范围。currentValue/previousValue/historicalNote
    // 是自动抽取的状态生命周期字段，编辑面板不暴露，保持既有值不变。
    const existing = loadedMemories.find(memory => memory.id === editingMemoryId);
    const currentValue =
      existing?.kind === 'state'
        ? nullableText(content) ?? existing.currentValue ?? null
        : existing?.currentValue ?? null;

    await updateMemory(editingMemoryId, {
      kind: editDraft.kind,
      scope: editDraft.scope,
      content,
      currentValue,
    });
    setEditingMemoryId(null);
    setFeedback('记忆已更新');
  };

  const handleCreateMemory = async () => {
    const content = newDraft.content.trim();

    if (!content) {
      setFeedback('请先写入记忆内容');
      return;
    }

    const memory: MemoryItem = {
      id: makeMemoryId(),
      characterId: newDraft.scope === 'global' ? null : characterId,
      timelineId: timelineId ?? loadedSummary?.timelineId ?? null,
      scope: newDraft.scope,
      kind: newDraft.kind,
      content,
      // 手动新增不设生命周期字段：currentValue/previousValue/historicalNote
      // 属于自动抽取的状态轨迹，用户手动添加时只关心"记下这件事"。
      currentValue: null,
      previousValue: null,
      historicalNote: null,
      origin: 'manual',
      status: 'active',
      pinned: false,
      includeInContext: true,
    };

    if (onCreateMemory) {
      await onCreateMemory(memory);
    } else if (window.electron?.phase2) {
      await createPhase2Client().memory.create(memory);
    }

    setLoadedMemories(current => [memory, ...current]);
    setNewDraft(emptyDraft);
    setComposerOpen(false);
    setFeedback('记忆已保存');
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-white/70 bg-white/80 text-slate-900 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#07131f]/85 dark:text-sky-50">
      <div className="shrink-0 border-b border-sky-100 px-4 py-3 dark:border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">记忆</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{characterName}</p>
          </div>
          {onClose && (
            <button
              type="button"
              aria-label="关闭"
              title="关闭"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-sky-100"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {feedback && (
          <div className="border-l-4 border-sky-400 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-400/10 dark:text-sky-100">
            {feedback}
          </div>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">当前总结</h3>
            <div className="flex items-center gap-1">
              {!editingSummary && (
                <button
                  type="button"
                  aria-label="编辑当前总结"
                  title="编辑当前总结"
                  onClick={startEditingSummary}
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-sky-100"
                >
                  <Pencil size={14} />
                </button>
              )}
              <button
                type="button"
                aria-label={summaryOpen ? '收起当前总结' : '展开当前总结'}
                onClick={() => setSummaryOpen(open => !open)}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-sky-100"
              >
                {summaryOpen ? '收起' : '展开'}
              </button>
            </div>
          </div>
          {summaryOpen && (
            editingSummary ? (
              <div className="grid gap-2 rounded-lg border border-sky-100 bg-white p-3 dark:border-white/10 dark:bg-white/5">
                <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  编辑当前总结内容
                  <textarea
                    value={summaryDraft}
                    onChange={(event) => {
                      setSummaryDraft(event.target.value);
                      setFeedback(null);
                    }}
                    rows={5}
                    className="min-h-32 resize-y rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveSummary()}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300"
                  >
                    <Check size={15} />
                    保存总结
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSummary(false);
                      setSummaryDraft(loadedSummary?.content ?? '');
                      setFeedback(null);
                    }}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-sky-100 px-3 text-sm font-medium text-slate-500 hover:bg-sky-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    <X size={15} />
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                {loadedSummary?.content || '还没有生成总结。'}
              </p>
            )
          )}
        </section>

        <section aria-label="结构化记忆" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">结构化记忆</h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">{visibleMemories.length} / {structuredMemories.length} 条</span>
          </div>

          <div className="grid grid-cols-3 rounded-lg border border-sky-100 bg-white/70 p-1 text-xs font-medium dark:border-white/10 dark:bg-white/5">
            {([
              ['context', '下次参考'],
              ['all', '全部'],
              ['disabled', '已禁用'],
            ] as const).map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-pressed={memoryView === view}
                onClick={() => setMemoryView(view)}
                className={`h-8 rounded-md px-2 transition ${
                  memoryView === view
                    ? 'bg-sky-700 text-white shadow-sm dark:bg-sky-300 dark:text-[#04101a]'
                    : 'text-slate-500 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-sky-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {visibleMemories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-sky-100 px-3 py-3 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
              {memoryView === 'context'
                ? '暂无会进入下次回复的记忆。'
                : memoryView === 'disabled'
                  ? '暂无已禁用记忆。'
                  : '暂无结构化记忆。'}
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleMemories.map(memory => {
                const isEditing = editingMemoryId === memory.id;
                const inContext = isContextMemory(memory);

                return (
                  <article key={memory.id} className="space-y-2 rounded-lg border border-sky-100 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium text-sky-700 dark:text-sky-200">{KIND_LABELS[memory.kind]}</span>
                      <span className="text-slate-400 dark:text-slate-500">{SCOPE_LABELS[memory.scope]}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${badgeClass(memory)}`}>
                        {memory.status === 'disabled' ? '已禁用' : inContext ? '进入上下文' : '不进上下文'}
                      </span>

                      {!isEditing && (
                        <div className="ml-auto flex flex-row items-center gap-0.5">
                          <button
                            type="button"
                            aria-label="编辑记忆"
                            title="编辑记忆"
                            onClick={() => startEditing(memory)}
                            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-sky-100"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={memory.pinned ? '取消置顶' : '置顶'}
                            title={memory.pinned ? '取消置顶' : '置顶'}
                            onClick={() => void updateMemory(memory.id, { pinned: !memory.pinned })}
                            className={`grid h-6 w-6 place-items-center rounded-md hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-white/10 dark:hover:text-sky-100 ${memory.pinned ? 'text-sky-700 dark:text-sky-200' : 'text-slate-400 dark:text-slate-400'}`}
                          >
                            <Pin size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={inContext ? '不进入上下文' : '加入上下文'}
                            title={inContext ? '不进入上下文' : '加入上下文'}
                            onClick={() => void updateMemory(memory.id, inContext
                              ? { includeInContext: false }
                              : { status: 'active', includeInContext: true })}
                            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-sky-100"
                          >
                            {inContext ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <button
                            type="button"
                            aria-label={memory.status === 'disabled' ? '启用记忆' : '禁用记忆'}
                            title={memory.status === 'disabled' ? '启用记忆' : '禁用记忆'}
                            onClick={() => void updateMemory(memory.id, memory.status === 'disabled'
                              ? { status: 'active', includeInContext: true }
                              : { status: 'disabled', includeInContext: false })}
                            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-sky-100"
                          >
                            {memory.status === 'disabled' ? <RotateCcw size={13} /> : <Ban size={13} />}
                          </button>
                          <button
                            type="button"
                            aria-label="删除记忆"
                            title="删除记忆"
                            onClick={() => void deleteMemory(memory.id)}
                            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                            类型
                            <select
                              value={editDraft.kind}
                              onChange={(event) => setEditDraft(current => ({ ...current, kind: event.target.value as MemoryKind }))}
                              className="h-9 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
                            >
                              {KIND_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                            范围
                            <select
                              value={editDraft.scope}
                              onChange={(event) => setEditDraft(current => ({ ...current, scope: event.target.value as MemoryScope }))}
                              className="h-9 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
                            >
                              {SCOPE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                          编辑内容
                          <textarea
                            value={editDraft.content}
                            onChange={(event) => setEditDraft(current => ({ ...current, content: event.target.value }))}
                            rows={3}
                            className="min-h-20 resize-y rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void saveEditingMemory()}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300"
                          >
                            <Check size={15} />
                            保存修改
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingMemoryId(null)}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-sky-100 px-3 text-sm font-medium text-slate-500 hover:bg-sky-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <X size={15} />
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="break-words text-sm text-slate-800 dark:text-slate-100">{memoryTitle(memory)}</p>
                        {memory.currentValue && memory.currentValue !== memory.content && (
                          <p className="break-words text-xs text-slate-500 dark:text-slate-400">内容：{memory.content}</p>
                        )}
                        {memory.previousValue && (
                          <p className="break-words text-xs text-slate-500 dark:text-slate-400">之前：{memory.previousValue}</p>
                        )}
                        {memory.historicalNote && (
                          <p className="break-words text-xs text-slate-500 dark:text-slate-400">脉络：{memory.historicalNote}</p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-sky-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_-4px_rgba(244,63,94,0.18)] dark:border-white/15 dark:bg-[#07131f]/95 dark:shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.5)]">
        {composerOpen ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                类型
                <select
                  value={newDraft.kind}
                  onChange={(event) => setNewDraft(current => ({ ...current, kind: event.target.value as MemoryKind }))}
                  className="h-10 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
                >
                  {KIND_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                范围
                <select
                  value={newDraft.scope}
                  onChange={(event) => setNewDraft(current => ({ ...current, scope: event.target.value as MemoryScope }))}
                  className="h-10 rounded-lg border border-sky-100 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
                >
                  {SCOPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              新增内容
              <textarea
                value={newDraft.content}
                onChange={(event) => {
                  setNewDraft(current => ({ ...current, content: event.target.value }));
                  setFeedback(null);
                }}
                rows={3}
                className="min-h-24 resize-y rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:ring-sky-300/10"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCreateMemory()}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300"
              >
                <Plus size={16} />
                保存记忆
              </button>
              <button
                type="button"
                onClick={() => { setComposerOpen(false); setNewDraft(emptyDraft); }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-100 px-3 text-sm font-medium text-slate-500 hover:bg-sky-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
              >
                <X size={16} />
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-sky-200 bg-white/60 text-sm font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-300/30 dark:bg-white/5 dark:text-sky-200 dark:hover:bg-white/10"
          >
            <Plus size={16} />
            添加记忆
          </button>
        )}
      </div>
    </aside>
  );
}
