export type PresenceEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'shy'
  | 'excited'
  | 'worried'
  | 'playful'
  | 'serious';

export interface PresenceLive2DAvatar {
  kind: 'live2d';
  modelUrl: string;
  coreUrl: string | null;
  cubism: 2 | 4;
  expressionMap: Partial<Record<PresenceEmotion, string | null>>;
  scale: number;
  offsetX: number;
  offsetY: number;
  label?: string;
}

export interface PresenceVideoAvatar {
  kind: 'video';
  src: string;
  label?: string;
}

export interface PresenceImageAvatar {
  kind: 'image';
  src: string;
  label?: string;
}

export type PresenceAvatar = PresenceLive2DAvatar | PresenceVideoAvatar | PresenceImageAvatar;

export interface DesktopPresenceState {
  character: {
    id: string;
    name: string;
    nickname: string | null;
    relation: string | null;
    avatarSrc: string | null;
  };
  avatar: PresenceAvatar | null;
  emotion: PresenceEmotion;
  online: boolean;
  hosting: boolean;
  mainWindowVisible: boolean;
  updatedAt: string;
  notice: string | null;
}

export interface DesktopShellState {
  presenceEnabled: boolean;
  presenceVisible: boolean;
  alwaysOnTop: boolean;
  closeToHosting: boolean;
  launchAtLogin: boolean;
  hosting: boolean;
  mainWindowVisible: boolean;
}

export interface DesktopShellApi {
  presence: {
    getState: () => Promise<DesktopPresenceState | null>;
    getShellState: () => Promise<DesktopShellState>;
    refresh: () => Promise<boolean>;
    openChat: (messageId?: string) => Promise<boolean>;
    showContextMenu: () => Promise<boolean>;
    getBounds: () => Promise<{ x: number; y: number } | null>;
    moveTo: (x: number, y: number) => void;
    hide: () => Promise<boolean>;
    onState: (callback: (state: DesktopPresenceState) => void) => () => void;
    onShellState: (callback: (state: DesktopShellState) => void) => () => void;
  };
  app: {
    showMain: () => Promise<boolean>;
    setPresenceEnabled: (value: boolean) => Promise<DesktopShellState>;
    setAlwaysOnTop: (value: boolean) => Promise<DesktopShellState>;
    setCloseToHosting: (value: boolean) => Promise<DesktopShellState>;
    setLaunchAtLogin: (value: boolean) => Promise<DesktopShellState>;
    onOpenChat: (callback: (messageId?: string) => void) => () => void;
    quit: () => Promise<boolean>;
  };
  /** Native pickers for settings forms (desktop build only). */
  dialog?: {
    pickFile: (options?: { title?: string; mode?: 'file' | 'directory' }) => Promise<string | null>;
    openExternal: (target: string) => Promise<boolean>;
  };
}

export function getDesktopShell(): DesktopShellApi | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.hereinShell ?? null;
}
