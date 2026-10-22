import React from 'react';
import { Live2DStage } from '../components/Avatar/Live2DStage';
import { CORE_URL_KEY } from '../services/chatHistory';

const EMOTIONS = ['neutral', 'happy', 'shy', 'sad', 'angry', 'playful'] as const;

export function Live2DDemo() {
  const [coreUrl, setCoreUrl] = React.useState(() => {
    try {
      return (localStorage.getItem(CORE_URL_KEY) ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
    } catch {
      return 'http://127.0.0.1:8787';
    }
  });
  const [draft, setDraft] = React.useState(coreUrl);
  const [emotion, setEmotion] = React.useState<string>('neutral');

  return (
    <div className="flex h-[100dvh] flex-col bg-[#130d14] text-rose-50">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs outline-none"
        />
        <button
          onClick={() => {
            const next = draft.trim().replace(/\/+$/, '');
            setCoreUrl(next);
            localStorage.setItem(CORE_URL_KEY, next);
          }}
          className="rounded-xl bg-rose-300 px-3 py-2 text-xs font-semibold text-[#2a1420]"
        >
          加载
        </button>
      </header>

      <main className="min-h-0 flex-1">
        <Live2DStage
          coreUrl={`${coreUrl}/assets/live2d/core/live2d.min.js?v=129056`}
          modelUrl={`${coreUrl}/assets/live2d/shizuku/shizuku.model.json?v=1`}
          emotion={emotion}
        />
      </main>

      <footer className="flex shrink-0 flex-wrap justify-center gap-2 border-t border-white/10 px-3 py-3">
        {EMOTIONS.map(item => (
          <button
            key={item}
            onClick={() => setEmotion(item)}
            className={`rounded-xl px-3 py-2 text-xs ${
              emotion === item ? 'bg-rose-300 text-[#2a1420]' : 'bg-white/10 text-rose-100'
            }`}
          >
            {item}
          </button>
        ))}
      </footer>
    </div>
  );
}
