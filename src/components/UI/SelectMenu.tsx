import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  className = '',
  buttonClassName = '',
}: SelectMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find(option => option.value === value);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const handleSelect = (option: SelectMenuOption) => {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setIsOpen(open => !open)}
        className={`flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-sky-100 bg-white px-3 text-left text-slate-950 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-sky-50 dark:focus:border-sky-300/60 dark:focus:ring-sky-300/10 dark:disabled:text-slate-600 ${buttonClassName}`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {selectedOption?.label || placeholder}
          </span>
          {selectedOption?.description && (
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
              {selectedOption.description}
            </span>
          )}
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-sky-100 bg-white p-1 shadow-xl shadow-sky-100/60 dark:border-white/10 dark:bg-[#0b1b2b] dark:shadow-black/30"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              没有可选项
            </div>
          ) : (
            options.map(option => {
              const isSelected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onClick={() => handleSelect(option)}
                  className={`flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    isSelected
                      ? 'bg-sky-50 text-sky-800 dark:bg-sky-300/15 dark:text-sky-100'
                      : 'text-slate-700 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-sky-100'
                  }`}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center">
                    {isSelected && <Check size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.description && (
                      <span className="mt-0.5 block truncate text-xs opacity-70">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
