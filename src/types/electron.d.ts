export {};

import type { LocalTtsSynthesisRequest, LocalTtsSynthesisResult } from '../services/interfaces';
import type { Phase2PreloadAPI } from '../services/phase2/types';
import type { DesktopShellApi } from '../services/desktopPresence';

declare global {
  interface Window {
    hereinCore?: {
      url: string;
      token: string;
    };
    hereinShell?: DesktopShellApi;
    hereinVoice?: {
      transcribe: (pcm: Uint8Array, turnId?: string) => Promise<{ text: string; elapsedMs?: number; rejected?: string }>;
      cancel: () => Promise<unknown>;
      status: () => Promise<{ ready: { asr: boolean; tts: boolean } }>;
      onPcm: (callback: (payload: unknown) => void) => () => void;
      onCancel: (callback: (payload: unknown) => void) => () => void;
      onPtt: (callback: () => void) => () => void;
    };
    electron?: {
      platform: string;
      storage?: {
        read: (fileName: string) => Promise<unknown | null>;
        write: (fileName: string, data: unknown) => Promise<boolean>;
        delete: (fileName: string) => Promise<boolean>;
      };
      secrets?: {
        encrypt: (value: string) => Promise<{ encoding: string; value: string }>;
        decrypt: (encryptedValue: string, encoding: string) => Promise<string>;
      };
      theme?: {
        setSource: (themeMode: string) => Promise<'light' | 'dark'>;
      };
      tts?: {
        synthesize: (request: LocalTtsSynthesisRequest) => Promise<LocalTtsSynthesisResult>;
      };
      phase2?: Phase2PreloadAPI;
    };
  }
}
