import { create } from 'zustand';
import type { CallSessionState } from '../services/phase2/types';

interface CallStore {
  session: CallSessionState | null;
  startCall: (input: { characterId: string; timelineId: string }) => void;
  minimizeCall: () => void;
  restoreCall: () => void;
  endCall: () => void;
  canStartCall: (characterId: string) => { ok: true } | { ok: false; activeCharacterId: string };
  setLastSubtitleMessageId: (messageId: string | null) => void;
}

export const useCallStore = create<CallStore>((set, get) => ({
  session: null,

  startCall: ({ characterId, timelineId }) => {
    set({
      session: {
        characterId,
        timelineId,
        host: 'in-app',
        mode: 'windowed',
        isOpen: true,
        startedAt: new Date().toISOString(),
        lastSubtitleMessageId: null,
      },
    });
  },

  minimizeCall: () => {
    const { session } = get();

    if (session) {
      set({ session: { ...session, mode: 'mini' } });
    }
  },

  restoreCall: () => {
    const { session } = get();

    if (session) {
      set({ session: { ...session, mode: 'windowed' } });
    }
  },

  endCall: () => {
    set({ session: null });
  },

  canStartCall: (characterId) => {
    const { session } = get();

    if (!session || session.characterId === characterId) {
      return { ok: true };
    }

    return { ok: false, activeCharacterId: session.characterId };
  },

  setLastSubtitleMessageId: (messageId) => {
    const { session } = get();

    if (session) {
      set({ session: { ...session, lastSubtitleMessageId: messageId } });
    }
  },
}));
