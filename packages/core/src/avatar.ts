import type { AvatarManifest, PresentationEmotion } from './index.js';

export interface AvatarLoadOptions {
  baseDir: string;
  signal?: AbortSignal;
}

export interface AvatarRenderer {
  load(manifest: AvatarManifest, options: AvatarLoadOptions): Promise<void>;
  setExpression(emotion: PresentationEmotion): void;
  playMotion(group: string, index?: number): void;
  setMouthOpen(value: number): void;
  setGaze(x: number, y: number): void;
  setIdle(enabled: boolean): void;
  isReady(): boolean;
  destroy(): void;
}

export type AvatarRendererFactory = (manifest: AvatarManifest) => AvatarRenderer;
