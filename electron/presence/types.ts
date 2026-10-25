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

export type PresenceAvatar =
  | PresenceLive2DAvatar
  | PresenceVideoAvatar
  | PresenceImageAvatar;

export interface PresenceCharacter {
  id: string;
  name: string;
  nickname: string | null;
  relation: string | null;
  avatarSrc: string | null;
}

export interface DesktopPresenceState {
  character: PresenceCharacter;
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
