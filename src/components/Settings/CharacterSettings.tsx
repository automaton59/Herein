import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settings';
import type { CharacterConfig } from '../../services/interfaces';
import { SelectMenu } from '../UI/SelectMenu';
import { CharacterArchiveControls } from './CharacterArchiveControls';

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

function normalizeCharacter(character: CharacterConfig): CharacterConfig {
  return {
    ...character,
    name: character.name.trim(),
    description: character.description.trim(),
    scenario: character.scenario.trim(),
    firstMessage: character.firstMessage.trim(),
    systemPrompt: character.systemPrompt.trim(),
  };
}

function validateCharacter(character: CharacterConfig): string[] {
  const normalized = normalizeCharacter(character);
  const errors: string[] = [];

  if (!normalized.name) {
    errors.push('角色名不能为空');
  }

  if (!normalized.description) {
    errors.push('角色设定不能为空');
  }

  return errors;
}

export function CharacterSettings() {
  const {
    characters,
    activeCharacterId,
    characterConfig,
    setActiveCharacter,
    updateCharacterConfig,
    createCharacter,
    duplicateCharacter,
    deleteCharacter,
  } = useSettingsStore();
  const [localCharacter, setLocalCharacter] = useState(characterConfig);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setLocalCharacter(characterConfig);
  }, [characterConfig]);

  const updateField = (field: keyof CharacterConfig, value: string) => {
    setLocalCharacter({ ...localCharacter, [field]: value });
    setFeedback(null);
  };

  const handleSave = () => {
    const errors = validateCharacter(localCharacter);

    if (errors.length > 0) {
      setFeedback({ type: 'error', message: errors.join('；') });
      return;
    }

    updateCharacterConfig(normalizeCharacter(localCharacter));
    setFeedback({ type: 'success', message: '角色卡已保存' });
  };

  const handleCreate = () => {
    createCharacter();
    setFeedback({ type: 'success', message: '已创建新角色' });
  };

  const handleDuplicate = () => {
    duplicateCharacter(activeCharacterId);
    setFeedback({ type: 'success', message: '已复制当前角色' });
  };

  const handleDelete = () => {
    deleteCharacter(activeCharacterId);
    setFeedback({ type: 'success', message: '角色已删除' });
  };

  return (
    <section className="space-y-5 rounded-2xl border border-rose-100 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#171018]/80 dark:shadow-none">
      <div>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-rose-50">角色卡</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">共 {characters.length} 个角色，当前角色：{characterConfig.name}</p>
      </div>

      {feedback && (
        <div
          className={`border-l-4 px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-500 bg-green-50 text-green-800 dark:bg-emerald-500/10 dark:text-emerald-100'
              : 'border-red-500 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-100'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">选择角色</span>
          <SelectMenu
            value={activeCharacterId}
            onChange={(characterId) => {
              setActiveCharacter(characterId);
              setFeedback(null);
            }}
            options={characters.map((character) => ({
              value: character.id,
              label: character.name,
            }))}
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleCreate}
            className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
          >
            新建
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            className="h-10 rounded-xl border border-rose-100 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-rose-50 dark:border-white/10 dark:bg-white/5 dark:text-rose-100 dark:hover:bg-white/10"
          >
            复制
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={characters.length <= 1}
            className="h-10 rounded-xl border border-red-100 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 dark:border-red-400/20 dark:bg-white/5 dark:text-red-300 dark:hover:bg-red-500/10 dark:disabled:border-white/10 dark:disabled:text-slate-600"
          >
            删除
          </button>
        </div>

        <CharacterArchiveControls characterId={activeCharacterId} />

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">角色名</span>
          <input
            type="text"
            value={localCharacter.name}
            onChange={(event) => updateField('name', event.target.value)}
            className="h-11 w-full rounded-xl border border-rose-100 px-3 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:border-rose-300/60 dark:focus:ring-rose-300/10"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">角色设定</span>
          <textarea
            value={localCharacter.description}
            onChange={(event) => updateField('description', event.target.value)}
            rows={4}
            className="min-h-28 w-full resize-y rounded-xl border border-rose-100 px-3 py-2 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:border-rose-300/60 dark:focus:ring-rose-300/10"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">开场白</span>
          <textarea
            value={localCharacter.firstMessage}
            onChange={(event) => updateField('firstMessage', event.target.value)}
            rows={2}
            className="min-h-20 w-full resize-y rounded-xl border border-rose-100 px-3 py-2 text-slate-950 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 dark:border-white/10 dark:bg-white/5 dark:text-rose-50 dark:focus:border-rose-300/60 dark:focus:ring-rose-300/10"
          />
        </label>

        <button
          type="button"
          onClick={handleSave}
          className="h-11 rounded-xl bg-slate-950 px-4 font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:bg-rose-400 dark:text-[#1b1018] dark:hover:bg-rose-300 dark:focus:ring-rose-300/20"
        >
          保存角色卡
        </button>
      </div>
    </section>
  );
}
