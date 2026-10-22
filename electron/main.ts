import { randomUUID } from 'crypto';
import { app, BrowserWindow, Menu, ipcMain, nativeTheme, safeStorage } from 'electron';
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { openPhase2Database, type Phase2Database } from './data/database';
import { migratePhase1JsonData } from './data/migratePhase1';
import { createPhase2Repositories } from './data/repositories';
import {
  exportCharacterArchive,
  exportFullBackup,
  importCharacterArchive,
  restoreFullBackup,
} from './data/archive';
import { APP_DISPLAY_NAME, APP_USER_DATA_DIR_NAME } from './appIdentity';

const isDev = process.env.NODE_ENV === 'development';
const shouldOpenDevTools = process.env.OPEN_DEVTOOLS === '1' || process.env.OPEN_DEVTOOLS === 'true';
const ALLOWED_DATA_FILES = new Set(['config.json', 'chat-history.json', 'api-profiles.json']);

let phase2Db: Phase2Database | null = null;

app.setName(APP_DISPLAY_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_USER_DATA_DIR_NAME));

function getUserDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function getDataPath(fileName: string) {
  if (!ALLOWED_DATA_FILES.has(fileName)) {
    throw new Error(`Unsupported data file: ${fileName}`);
  }

  return path.join(getUserDataDir(), fileName);
}

async function ensureDataDir() {
  await mkdir(getUserDataDir(), { recursive: true });
}

function getPhase2Database() {
  if (!phase2Db) {
    phase2Db = openPhase2Database(path.join(getUserDataDir(), 'app.db'));
  }

  return phase2Db;
}

function getPhase2Repositories() {
  return createPhase2Repositories(getPhase2Database());
}

function ensureDefaultCharacter() {
  const repos = getPhase2Repositories();
  const characters = repos.characters.list();

  if (characters.length === 0) {
    repos.characters.upsert({
      id: 'herein-default',
      name: '新角色',
      description: '一个温柔、机敏、有点俏皮的 AI 女友。',
      scenario: '',
      firstMessage: '我在。今天想从哪里聊起？',
      systemPrompt: '',
      personalityCore: '温柔、机敏、有陪伴感。',
      speakingStyle: '自然、具体、轻松。',
      valuesText: '重视真实陪伴、尊重用户边界。',
      boundaries: '不展示思维过程，不替用户做危险决定。',
    });
    repos.timelines.ensurePrimaryForCharacter('herein-default', '新角色');
    repos.settings.set('activeCharacterId', 'herein-default');
    repos.settings.set('themeMode', 'system');
  }
}

function bootstrapPhase2() {
  const db = getPhase2Database();
  migratePhase1JsonData({ db, dataDir: getUserDataDir() });
  ensureDefaultCharacter();

  const repos = getPhase2Repositories();

  return {
    settings: {
      activeCharacterId: repos.settings.get('activeCharacterId', null),
      activeProfileId: repos.settings.get('activeProfileId', null),
      themeMode: repos.settings.get('themeMode', 'system'),
      voiceConfig: repos.settings.get('voiceConfig', null),
      memoryEnabled: repos.settings.get('memoryEnabled', true),
      memoryProfileMode: repos.settings.get('memoryProfileMode', 'follow-chat'),
      memoryProfileId: repos.settings.get('memoryProfileId', null),
      summaryTriggerMessageCount: repos.settings.get('summaryTriggerMessageCount', 20),
    },
    profiles: repos.apiProfiles.list(),
    characters: repos.characters.list(),
  };
}

function getMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.png') {
    return 'image/png';
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }

  if (ext === '.webp') {
    return 'image/webp';
  }

  if (ext === '.gif') {
    return 'image/gif';
  }

  if (ext === '.mp4') {
    return 'video/mp4';
  }

  if (ext === '.webm') {
    return 'video/webm';
  }

  if (ext === '.ogg' || ext === '.ogv') {
    return 'video/ogg';
  }

  if (ext === '.json') {
    return 'application/json';
  }

  return 'application/octet-stream';
}

function getSafeAssetExtension(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? ext : '.bin';
}

function isSupportedExpressionExtension(filePath: string) {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filePath).toLowerCase());
}

function isSupportedVideoExtension(filePath: string) {
  return ['.mp4', '.webm', '.ogg', '.ogv'].includes(path.extname(filePath).toLowerCase());
}

function isSupportedLive2DEntry(filePath: string) {
  return path.basename(filePath).toLowerCase().endsWith('.model3.json');
}

function resolveDataRelativePath(relativePath: string) {
  const dataDir = path.resolve(getUserDataDir());
  const resolved = path.resolve(getUserDataDir(), relativePath);

  if (resolved !== dataDir && !resolved.startsWith(`${dataDir}${path.sep}`)) {
    throw new Error(`Asset path escapes data directory: ${relativePath}`);
  }

  return resolved;
}

async function importImageAsset(input: {
  characterId: string;
  sourcePath: string;
  kind: 'avatar' | 'expression';
  label: string;
  metadata?: Record<string, unknown>;
}) {
  const { characterId, sourcePath, kind, label, metadata } = input;
  if (!path.isAbsolute(sourcePath)) {
    throw new Error('Asset source path must be absolute');
  }

  if (kind === 'expression' && !isSupportedExpressionExtension(sourcePath)) {
    throw new Error('Expression assets support png, jpg, jpeg, and webp files.');
  }

  const repos = getPhase2Repositories();
  const character = repos.characters.get(characterId);

  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const assetId = randomUUID();
  const extension = getSafeAssetExtension(sourcePath);
  const relativePath = path.posix.join('assets', characterId, `${kind}-${assetId}${extension}`);
  const targetPath = path.join(getUserDataDir(), relativePath);
  const buffer = await readFile(sourcePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);

  repos.assets.create({
    id: assetId,
    characterId,
    kind,
    relativePath,
    mimeType: getMimeType(sourcePath),
    label,
    metadata: metadata ?? {},
  });

  if (kind === 'avatar') {
    repos.characters.upsert({
      ...character,
      avatarAssetId: assetId,
    });
  }

  return { assetId, relativePath };
}

async function importAvatarAsset(characterId: string, sourcePath: string) {
  return await importImageAsset({
    characterId,
    sourcePath,
    kind: 'avatar',
    label: '头像',
  });
}

async function importExpressionAsset(
  characterId: string,
  sourcePath: string,
  metadata: Record<string, unknown> = {},
) {
  const { label, ...assetMetadata } = metadata;

  return await importImageAsset({
    characterId,
    sourcePath,
    kind: 'expression',
    label: typeof label === 'string' && label.trim() ? label.trim() : '表情',
    metadata: assetMetadata,
  });
}

async function importVideoAsset(
  characterId: string,
  sourcePath: string,
  metadata: Record<string, unknown> = {},
) {
  if (!path.isAbsolute(sourcePath)) {
    throw new Error('Asset source path must be absolute');
  }

  if (!isSupportedVideoExtension(sourcePath)) {
    throw new Error('Video avatar assets support mp4, webm, ogg, and ogv files.');
  }

  const repos = getPhase2Repositories();
  const character = repos.characters.get(characterId);

  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const { label, ...assetMetadata } = metadata;
  const assetId = randomUUID();
  const extension = path.extname(sourcePath).toLowerCase();
  const relativePath = path.posix.join('assets', characterId, `video-${assetId}${extension}`);
  const targetPath = path.join(getUserDataDir(), relativePath);
  const buffer = await readFile(sourcePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);

  repos.assets.create({
    id: assetId,
    characterId,
    kind: 'video',
    relativePath,
    mimeType: getMimeType(sourcePath),
    label: typeof label === 'string' && label.trim() ? label.trim() : '动态形象',
    metadata: {
      renderer: 'video',
      loop: true,
      muted: true,
      ...assetMetadata,
    },
  });

  return { assetId, relativePath };
}

async function importLive2DAsset(
  characterId: string,
  sourcePath: string,
  metadata: Record<string, unknown> = {},
) {
  if (!path.isAbsolute(sourcePath)) {
    throw new Error('Asset source path must be absolute');
  }

  if (!isSupportedLive2DEntry(sourcePath)) {
    throw new Error('Live2D import expects a .model3.json entry file.');
  }

  const repos = getPhase2Repositories();
  const character = repos.characters.get(characterId);

  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const { label, entry, ...assetMetadata } = metadata;
  const assetId = randomUUID();
  const entryFileName = typeof entry === 'string' && entry.trim()
    ? path.basename(entry.trim())
    : path.basename(sourcePath);
  const sourceDir = path.dirname(sourcePath);
  const relativeRoot = path.posix.join('assets', characterId, `live2d-${assetId}`);
  const relativePath = path.posix.join(relativeRoot, entryFileName);
  const targetRoot = path.join(getUserDataDir(), relativeRoot);

  await mkdir(path.dirname(targetRoot), { recursive: true });
  await cp(sourceDir, targetRoot, { recursive: true });

  repos.assets.create({
    id: assetId,
    characterId,
    kind: 'live2d',
    relativePath,
    mimeType: 'application/json',
    label: typeof label === 'string' && label.trim() ? label.trim() : 'Live2D',
    metadata: {
      renderer: 'live2d',
      entry: entryFileName,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      ...assetMetadata,
    },
  });

  return { assetId, relativePath };
}

async function readAssetDataUrl(assetId: string) {
  const asset = getPhase2Repositories().assets.get(assetId);

  if (!asset) {
    return null;
  }

  const buffer = await readFile(path.join(getUserDataDir(), asset.relativePath));
  const mimeType = asset.mimeType || 'application/octet-stream';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function registerPhase2Handlers() {
  ipcMain.handle('phase2:bootstrap', () => bootstrapPhase2());

  ipcMain.handle('phase2:settings:get', (_event, key: string, fallback: unknown) => {
    return getPhase2Repositories().settings.get(key, fallback);
  });

  ipcMain.handle('phase2:settings:set', (_event, key: string, value: unknown) => {
    getPhase2Repositories().settings.set(key, value as never);
    return true;
  });

  ipcMain.handle('phase2:profiles:list', () => getPhase2Repositories().apiProfiles.list());
  ipcMain.handle('phase2:profiles:upsert', (_event, profile: Parameters<ReturnType<typeof createPhase2Repositories>['apiProfiles']['upsert']>[0]) => {
    getPhase2Repositories().apiProfiles.upsert(profile);
    return true;
  });
  ipcMain.handle('phase2:profiles:delete', (_event, id: string) => {
    getPhase2Repositories().apiProfiles.delete(id);
    return true;
  });

  ipcMain.handle('phase2:characters:list', () => getPhase2Repositories().characters.list());
  ipcMain.handle('phase2:characters:upsert', (_event, character: Parameters<ReturnType<typeof createPhase2Repositories>['characters']['upsert']>[0]) => {
    getPhase2Repositories().characters.upsert(character);
    getPhase2Repositories().timelines.ensurePrimaryForCharacter(character.id, character.name);
    return true;
  });

  ipcMain.handle('phase2:relationship:get', (_event, characterId: string) => {
    return getPhase2Repositories().relationships.get(characterId);
  });
  ipcMain.handle('phase2:relationship:upsert', (_event, relationship: Parameters<ReturnType<typeof createPhase2Repositories>['relationships']['upsert']>[0]) => {
    getPhase2Repositories().relationships.upsert(relationship);
    return true;
  });

  ipcMain.handle('phase2:timeline:get-primary', (_event, characterId: string) => {
    const repos = getPhase2Repositories();
    const character = repos.characters.get(characterId);
    return repos.timelines.getPrimaryForCharacter(characterId)
      ?? repos.timelines.ensurePrimaryForCharacter(characterId, character?.name ?? '新聊天');
  });
  ipcMain.handle('phase2:timeline:list-messages', (_event, timelineId: string, limit = 100) => {
    return getPhase2Repositories().messages.listRecent(timelineId, limit);
  });
  ipcMain.handle('phase2:timeline:append-message', (_event, message: Parameters<ReturnType<typeof createPhase2Repositories>['messages']['append']>[0]) => {
    getPhase2Repositories().messages.append(message);
    return true;
  });
  ipcMain.handle('phase2:timeline:sync-messages', (
    _event,
    timelineId: string,
    messages: Parameters<ReturnType<typeof createPhase2Repositories>['messages']['sync']>[1],
    title?: string,
  ) => {
    return getPhase2Repositories().messages.sync(timelineId, messages, title);
  });
  ipcMain.handle('phase2:timeline:update-message', (_event, messageId: string, patch: Parameters<ReturnType<typeof createPhase2Repositories>['messages']['update']>[1]) => {
    getPhase2Repositories().messages.update(messageId, patch);
    return true;
  });
  ipcMain.handle('phase2:timeline:update-title', (_event, timelineId: string, title: string) => {
    getPhase2Repositories().timelines.updateTitle(timelineId, title);
    return true;
  });
  ipcMain.handle('phase2:timeline:delete-after', (_event, timelineId: string, messageId: string) => {
    getPhase2Repositories().messages.deleteAfter(timelineId, messageId);
    return true;
  });
  ipcMain.handle('phase2:timeline:clear-messages', (_event, timelineId: string) => {
    getPhase2Repositories().messages.clearTimeline(timelineId);
    return true;
  });

  ipcMain.handle('phase2:memory:list', (_event, filter?: { characterId?: string; timelineId?: string; activeOnly?: boolean }) => {
    const repos = getPhase2Repositories();
    return filter?.activeOnly === false
      ? repos.memories.listAll(filter)
      : repos.memories.listActive(filter);
  });
  ipcMain.handle('phase2:memory:create', (_event, memory: Parameters<ReturnType<typeof createPhase2Repositories>['memories']['create']>[0]) => {
    getPhase2Repositories().memories.create(memory);
    return true;
  });
  ipcMain.handle('phase2:memory:update', (_event, id: string, patch: Parameters<ReturnType<typeof createPhase2Repositories>['memories']['update']>[1]) => {
    getPhase2Repositories().memories.update(id, patch);
    return true;
  });
  ipcMain.handle('phase2:memory:delete', (_event, id: string) => {
    getPhase2Repositories().memories.delete(id);
    return true;
  });

  ipcMain.handle('phase2:summary:get', (_event, timelineId: string) => getPhase2Repositories().summaries.getByTimeline(timelineId));
  ipcMain.handle('phase2:summary:upsert', (_event, summary: Parameters<ReturnType<typeof createPhase2Repositories>['summaries']['upsert']>[0]) => {
    getPhase2Repositories().summaries.upsert(summary);
    return true;
  });

  ipcMain.handle('phase2:assets:import-avatar', async (_event, characterId: string, sourcePath: string) => {
    return await importAvatarAsset(characterId, sourcePath);
  });

  ipcMain.handle('phase2:assets:import-expression', async (_event, characterId: string, sourcePath: string, metadata: Record<string, unknown>) => {
    return await importExpressionAsset(characterId, sourcePath, metadata);
  });

  ipcMain.handle('phase2:assets:import-video', async (_event, characterId: string, sourcePath: string, metadata: Record<string, unknown>) => {
    return await importVideoAsset(characterId, sourcePath, metadata);
  });

  ipcMain.handle('phase2:assets:import-live2d', async (_event, characterId: string, sourcePath: string, metadata: Record<string, unknown>) => {
    return await importLive2DAsset(characterId, sourcePath, metadata);
  });

  ipcMain.handle('phase2:assets:list', (_event, filter?: Parameters<ReturnType<typeof createPhase2Repositories>['assets']['list']>[0]) => {
    return getPhase2Repositories().assets.list(filter);
  });

  ipcMain.handle('phase2:assets:update', (_event, id: string, patch: Parameters<ReturnType<typeof createPhase2Repositories>['assets']['update']>[1]) => {
    getPhase2Repositories().assets.update(id, patch);
    return true;
  });

  ipcMain.handle('phase2:assets:delete', async (_event, id: string) => {
    const repos = getPhase2Repositories();
    const asset = repos.assets.get(id);

    if (asset) {
      await rm(resolveDataRelativePath(asset.relativePath), { force: true });
      repos.assets.delete(id);
    }

    return true;
  });

  ipcMain.handle('phase2:assets:get-data-url', async (_event, assetId: string) => {
    return await readAssetDataUrl(assetId);
  });

  ipcMain.handle('phase2:presentation:get-profile', (_event, characterId: string) => {
    return getPhase2Repositories().presentationProfiles.get(characterId);
  });

  ipcMain.handle(
    'phase2:presentation:upsert-profile',
    (_event, profile: Parameters<ReturnType<typeof createPhase2Repositories>['presentationProfiles']['upsert']>[0]) => {
      getPhase2Repositories().presentationProfiles.upsert(profile);
      return true;
    },
  );

  ipcMain.handle('phase2:backup:export', async (_event, targetPath?: string, includeSecrets?: boolean) => {
    return await exportFullBackup({
      db: getPhase2Database(),
      dataDir: getUserDataDir(),
      targetPath,
      includeSecrets,
    });
  });

  ipcMain.handle('phase2:backup:restore', async (_event, backupPath: string) => {
    phase2Db?.close();
    phase2Db = null;
    await restoreFullBackup({ dataDir: getUserDataDir(), backupPath });
    return true;
  });

  ipcMain.handle('phase2:character-archive:export', async (_event, characterId: string, mode: 'profile' | 'full', targetPath?: string) => {
    return await exportCharacterArchive({
      db: getPhase2Database(),
      dataDir: getUserDataDir(),
      characterId,
      mode,
      targetPath,
    });
  });

  ipcMain.handle('phase2:character-archive:import', async (_event, archivePath: string) => {
    return await importCharacterArchive({
      db: getPhase2Database(),
      dataDir: getUserDataDir(),
      archivePath,
    });
  });
}

function normalizeTtsProxyRequest(request: unknown) {
  if (typeof request !== 'object' || request === null) {
    throw new Error('Invalid TTS request.');
  }

  const { endpoint, body } = request as { endpoint?: unknown; body?: unknown };

  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new Error('TTS endpoint is required.');
  }

  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Invalid TTS endpoint URL.');
  }

  const isLocalHost = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLocalHost) {
    throw new Error('TTS endpoint must be a local HTTP service.');
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('TTS request body must be an object.');
  }

  return {
    endpoint: url.toString(),
    body: body as Record<string, unknown>,
  };
}

function registerTtsHandlers() {
  ipcMain.handle('tts:synthesize', async (_event, request: unknown) => {
    const normalized = normalizeTtsProxyRequest(request);
    const response = await fetch(normalized.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized.body),
    });
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        body: Buffer.from(bytes).toString('utf8').slice(0, 1000),
      };
    }

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') ?? 'audio/wav',
      bytes,
    };
  });
}

function registerStorageHandlers() {
  ipcMain.handle('storage:read', async (_event, fileName: string) => {
    await ensureDataDir();

    try {
      const content = await readFile(getDataPath(fileName), 'utf8');
      return JSON.parse(content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  });

  ipcMain.handle('storage:write', async (_event, fileName: string, data: unknown) => {
    await ensureDataDir();
    await writeFile(getDataPath(fileName), JSON.stringify(data, null, 2), 'utf8');
    return true;
  });

  ipcMain.handle('storage:delete', async (_event, fileName: string) => {
    await ensureDataDir();
    await rm(getDataPath(fileName), { force: true });
    return true;
  });

  ipcMain.handle('secret:encrypt', (_event, value: string) => {
    if (!value) {
      return { encoding: 'plain:fallback', value: '' };
    }

    if (safeStorage.isEncryptionAvailable()) {
      try {
        return {
          encoding: 'safe:v1',
          value: safeStorage.encryptString(value).toString('base64'),
        };
      } catch {
        return { encoding: 'plain:fallback', value };
      }
    }

    return { encoding: 'plain:fallback', value };
  });

  ipcMain.handle('secret:decrypt', (_event, encryptedValue: string, encoding: string) => {
    if (!encryptedValue) {
      return '';
    }

    if (encoding === 'safe:v1') {
      try {
        return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
      } catch {
        return '';
      }
    }

    return encryptedValue;
  });

  ipcMain.handle('theme:set-source', (_event, themeMode: string) => {
    nativeTheme.themeSource = themeMode === 'light' || themeMode === 'dark'
      ? themeMode
      : 'system';
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
    if (shouldOpenDevTools) {
      win.webContents.openDevTools();
    }
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

registerStorageHandlers();
registerTtsHandlers();
registerPhase2Handlers();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    phase2Db?.close();
    app.quit();
  }
});
