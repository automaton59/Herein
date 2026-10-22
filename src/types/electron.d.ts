export {};

import type { LocalTtsSynthesisRequest, LocalTtsSynthesisResult } from '../services/interfaces';
import type { Phase2PreloadAPI } from '../services/phase2/types';

declare global {
  interface Window {
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
