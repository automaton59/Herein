import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';

interface InputBarProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function InputBar({ onSend, disabled = false }: InputBarProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="shrink-0 border-t border-[#E6E5F0] bg-[#FFFFFF]/90 p-3 dark:border-white/10 dark:bg-[#0E1424]/90 sm:p-4">
      <div className="flex items-end gap-2 rounded-3xl border border-[#E6E5F0] bg-[#FFFFFF] p-2 shadow-[0_10px_30px_-24px_rgba(59,68,116,0.45)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={disabled}
          className="min-h-11 max-h-40 flex-1 resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-4 py-2 text-slate-950 outline-none placeholder:text-slate-400 disabled:text-slate-400 dark:text-sky-50 dark:placeholder:text-slate-500 dark:disabled:text-slate-500"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-700 font-medium text-white shadow-sm shadow-sky-200 hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:bg-sky-400 dark:text-[#04101a] dark:hover:bg-sky-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          title="发送"
        >
          <SendHorizontal size={19} />
        </button>
      </div>
    </form>
  );
}
