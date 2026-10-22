import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  storage: {
    read: (fileName: string) => ipcRenderer.invoke('storage:read', fileName),
    write: (fileName: string, data: unknown) => ipcRenderer.invoke('storage:write', fileName, data),
    delete: (fileName: string) => ipcRenderer.invoke('storage:delete', fileName),
  },
  secrets: {
    encrypt: (value: string) => ipcRenderer.invoke('secret:encrypt', value),
    decrypt: (encryptedValue: string, encoding: string) => ipcRenderer.invoke('secret:decrypt', encryptedValue, encoding),
  },
  theme: {
    setSource: (themeMode: string) => ipcRenderer.invoke('theme:set-source', themeMode),
  },
  tts: {
    synthesize: (request: unknown) => ipcRenderer.invoke('tts:synthesize', request),
  },
  phase2: {
    bootstrap: () => ipcRenderer.invoke('phase2:bootstrap'),
    settings: {
      get: (key: string, fallback?: unknown) => ipcRenderer.invoke('phase2:settings:get', key, fallback),
      set: (key: string, value: unknown) => ipcRenderer.invoke('phase2:settings:set', key, value),
    },
    profiles: {
      list: () => ipcRenderer.invoke('phase2:profiles:list'),
      upsert: (profile: unknown) => ipcRenderer.invoke('phase2:profiles:upsert', profile),
      delete: (id: string) => ipcRenderer.invoke('phase2:profiles:delete', id),
    },
    characters: {
      list: () => ipcRenderer.invoke('phase2:characters:list'),
      upsert: (character: unknown) => ipcRenderer.invoke('phase2:characters:upsert', character),
    },
    relationship: {
      get: (characterId: string) => ipcRenderer.invoke('phase2:relationship:get', characterId),
      upsert: (relationship: unknown) => ipcRenderer.invoke('phase2:relationship:upsert', relationship),
    },
    timeline: {
      getPrimary: (characterId: string) => ipcRenderer.invoke('phase2:timeline:get-primary', characterId),
      listMessages: (timelineId: string, limit?: number) => ipcRenderer.invoke('phase2:timeline:list-messages', timelineId, limit),
      appendMessage: (message: unknown) => ipcRenderer.invoke('phase2:timeline:append-message', message),
      syncMessages: (timelineId: string, messages: unknown, title?: string) => ipcRenderer.invoke('phase2:timeline:sync-messages', timelineId, messages, title),
      updateMessage: (messageId: string, patch: unknown) => ipcRenderer.invoke('phase2:timeline:update-message', messageId, patch),
      updateTitle: (timelineId: string, title: string) => ipcRenderer.invoke('phase2:timeline:update-title', timelineId, title),
      deleteAfter: (timelineId: string, messageId: string) => ipcRenderer.invoke('phase2:timeline:delete-after', timelineId, messageId),
      clearMessages: (timelineId: string) => ipcRenderer.invoke('phase2:timeline:clear-messages', timelineId),
    },
    memory: {
      list: (filter?: unknown) => ipcRenderer.invoke('phase2:memory:list', filter),
      create: (memory: unknown) => ipcRenderer.invoke('phase2:memory:create', memory),
      update: (id: string, patch: unknown) => ipcRenderer.invoke('phase2:memory:update', id, patch),
      delete: (id: string) => ipcRenderer.invoke('phase2:memory:delete', id),
    },
    summary: {
      get: (timelineId: string) => ipcRenderer.invoke('phase2:summary:get', timelineId),
      upsert: (summary: unknown) => ipcRenderer.invoke('phase2:summary:upsert', summary),
    },
    assets: {
      importAvatar: (characterId: string, file: unknown) => {
        const sourcePath = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]);
        return ipcRenderer.invoke('phase2:assets:import-avatar', characterId, sourcePath);
      },
      importExpression: (characterId: string, file: unknown, metadata: unknown) => {
        const sourcePath = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]);
        return ipcRenderer.invoke('phase2:assets:import-expression', characterId, sourcePath, metadata);
      },
      importVideo: (characterId: string, file: unknown, metadata: unknown) => {
        const sourcePath = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]);
        return ipcRenderer.invoke('phase2:assets:import-video', characterId, sourcePath, metadata);
      },
      importLive2D: (characterId: string, file: unknown, metadata: unknown) => {
        const sourcePath = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]);
        return ipcRenderer.invoke('phase2:assets:import-live2d', characterId, sourcePath, metadata);
      },
      list: (filter?: unknown) => ipcRenderer.invoke('phase2:assets:list', filter),
      update: (id: string, patch: unknown) => ipcRenderer.invoke('phase2:assets:update', id, patch),
      delete: (id: string) => ipcRenderer.invoke('phase2:assets:delete', id),
      getDataUrl: (assetId: string) => ipcRenderer.invoke('phase2:assets:get-data-url', assetId),
    },
    presentation: {
      getProfile: (characterId: string) => ipcRenderer.invoke('phase2:presentation:get-profile', characterId),
      upsertProfile: (profile: unknown) => ipcRenderer.invoke('phase2:presentation:upsert-profile', profile),
    },
    backup: {
      export: (targetPath?: string, includeSecrets?: boolean) => ipcRenderer.invoke('phase2:backup:export', targetPath, includeSecrets),
      restore: (backupPath: string) => ipcRenderer.invoke('phase2:backup:restore', backupPath),
    },
    characterArchive: {
      export: (characterId: string, mode: string, targetPath?: string) => ipcRenderer.invoke('phase2:character-archive:export', characterId, mode, targetPath),
      import: (archivePath: string) => ipcRenderer.invoke('phase2:character-archive:import', archivePath),
    },
  },
});
