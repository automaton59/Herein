import type { Phase2PreloadAPI } from './types';

function getPhase2Api(): Phase2PreloadAPI {
  const api = window.electron?.phase2;

  if (!api) {
    throw new Error('Phase 2 storage requires the Electron app. Please start Herein with npm start.');
  }

  return api;
}

export function createPhase2Client(): Phase2PreloadAPI {
  return {
    bootstrap: async () => getPhase2Api().bootstrap(),
    settings: {
      get: async (key, fallback) => getPhase2Api().settings.get(key, fallback),
      set: async (key, value) => getPhase2Api().settings.set(key, value),
    },
    profiles: {
      list: async () => getPhase2Api().profiles.list(),
      upsert: async profile => getPhase2Api().profiles.upsert(profile),
      delete: async id => getPhase2Api().profiles.delete(id),
    },
    characters: {
      list: async () => getPhase2Api().characters.list(),
      upsert: async character => getPhase2Api().characters.upsert(character),
    },
    relationship: {
      get: async characterId => getPhase2Api().relationship.get(characterId),
      upsert: async relationship => getPhase2Api().relationship.upsert(relationship),
    },
    timeline: {
      getPrimary: async characterId => getPhase2Api().timeline.getPrimary(characterId),
      listMessages: async (timelineId, limit) => getPhase2Api().timeline.listMessages(timelineId, limit),
      appendMessage: async message => getPhase2Api().timeline.appendMessage(message),
      syncMessages: async (timelineId, messages, title) => getPhase2Api().timeline.syncMessages(timelineId, messages, title),
      updateMessage: async (messageId, patch) => getPhase2Api().timeline.updateMessage(messageId, patch),
      updateTitle: async (timelineId, title) => getPhase2Api().timeline.updateTitle(timelineId, title),
      deleteAfter: async (timelineId, messageId) => getPhase2Api().timeline.deleteAfter(timelineId, messageId),
      clearMessages: async timelineId => getPhase2Api().timeline.clearMessages(timelineId),
    },
    memory: {
      list: async filter => getPhase2Api().memory.list(filter),
      create: async memory => getPhase2Api().memory.create(memory),
      update: async (id, patch) => getPhase2Api().memory.update(id, patch),
      delete: async id => getPhase2Api().memory.delete(id),
    },
    summary: {
      get: async timelineId => getPhase2Api().summary.get(timelineId),
      upsert: async summary => getPhase2Api().summary.upsert(summary),
    },
    assets: {
      importAvatar: async (characterId, file) => getPhase2Api().assets.importAvatar(characterId, file),
      importExpression: async (characterId, file, metadata) => getPhase2Api().assets.importExpression(characterId, file, metadata),
      importVideo: async (characterId, file, metadata) => getPhase2Api().assets.importVideo(characterId, file, metadata),
      importLive2D: async (characterId, file, metadata) => getPhase2Api().assets.importLive2D(characterId, file, metadata),
      list: async filter => getPhase2Api().assets.list(filter),
      update: async (id, patch) => getPhase2Api().assets.update(id, patch),
      delete: async id => getPhase2Api().assets.delete(id),
      getDataUrl: async assetId => getPhase2Api().assets.getDataUrl(assetId),
    },
    presentation: {
      getProfile: async characterId => getPhase2Api().presentation.getProfile(characterId),
      upsertProfile: async profile => getPhase2Api().presentation.upsertProfile(profile),
    },
    backup: {
      export: async (targetPath, includeSecrets) => getPhase2Api().backup.export(targetPath, includeSecrets),
      restore: async backupPath => getPhase2Api().backup.restore(backupPath),
    },
    characterArchive: {
      export: async (characterId, mode, targetPath) => getPhase2Api().characterArchive.export(characterId, mode, targetPath),
      import: async archivePath => getPhase2Api().characterArchive.import(archivePath),
    },
  };
}

export const phase2Client = createPhase2Client();
