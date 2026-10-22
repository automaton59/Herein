import { afterEach, describe, expect, it } from 'vitest';
import { useCallStore } from './call';

afterEach(() => {
  useCallStore.getState().endCall();
});

describe('useCallStore', () => {
  it('manages one active in-app call session', () => {
    useCallStore.getState().startCall({ characterId: 'char-a', timelineId: 'timeline-a' });

    expect(useCallStore.getState().session).toEqual(expect.objectContaining({
      characterId: 'char-a',
      timelineId: 'timeline-a',
      host: 'in-app',
      mode: 'windowed',
      isOpen: true,
    }));

    useCallStore.getState().minimizeCall();
    expect(useCallStore.getState().session?.mode).toBe('mini');

    useCallStore.getState().restoreCall();
    expect(useCallStore.getState().session?.mode).toBe('windowed');

    useCallStore.getState().setLastSubtitleMessageId('msg-1');
    expect(useCallStore.getState().session?.lastSubtitleMessageId).toBe('msg-1');

    useCallStore.getState().endCall();
    expect(useCallStore.getState().session).toBeNull();
  });

  it('guards starting a second call for another character', () => {
    useCallStore.getState().startCall({ characterId: 'char-a', timelineId: 'timeline-a' });

    expect(useCallStore.getState().canStartCall('char-a')).toEqual({ ok: true });
    expect(useCallStore.getState().canStartCall('char-b')).toEqual({
      ok: false,
      activeCharacterId: 'char-a',
    });
  });
});
