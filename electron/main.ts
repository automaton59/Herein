import { randomUUID } from 'crypto';
import { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, safeStorage, screen, shell } from 'electron';
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { accessSync, appendFileSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { openPhase2Database, type Phase2Database } from './data/database';
import { migratePhase1JsonData } from './data/migratePhase1';
import { createPhase2Repositories } from './data/repositories';
import { createMemoryStore } from './data/memoryStore';
import {
  exportCharacterArchive,
  exportFullBackup,
  importCharacterArchive,
  restoreFullBackup,
} from './data/archive';
import { APP_DISPLAY_NAME, APP_USER_DATA_DIR_NAME } from './appIdentity';
import { resolveAssetRoots } from './assets/paths';
import { startCoreServer, type CoreServerHandle } from './core/server';
import {
  loadPersonaPacks,
  resolvePersonaRoot,
  selectPrimaryPersona,
  syncPersonaCharacter,
  type PersonaPack,
  type PersonaRuntime,
} from './persona';
import { resolveDesktopPresence } from './presence/resolve';
import { PresenceWindowManager, type PresenceBounds } from './presence/window';
import type { DesktopPresenceState, DesktopShellState } from './presence/types';
import { startVoiceRuntime, type VoiceRuntimeHandle } from './voiceRuntime';
import { VoiceService } from './voice/service';
import { VoiceTranscriptFilter } from './voice/transcriptFilter';
import { startLocalLlm, type LocalLlmHandle } from './localLlm';

const isDev = process.env.NODE_ENV === 'development';
const shouldOpenDevTools = process.env.OPEN_DEVTOOLS === '1' || process.env.OPEN_DEVTOOLS === 'true';
const ALLOWED_DATA_FILES = new Set(['config.json', 'chat-history.json', 'api-profiles.json']);
const voiceTranscriptFilter = new VoiceTranscriptFilter();

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Chromium's GPU sandbox crashes with an access violation on this Windows
// setup, which makes every Electron window terminate during startup. Keep the
// renderer sandbox enabled, but let the GPU process use the driver directly.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

let phase2Db: Phase2Database | null = null;
let coreHandle: CoreServerHandle | null = null;
let coreAccess: { url: string; token: string } | null = null;
let coreClosing = false;
let voiceRuntime: VoiceRuntimeHandle | null = null;
let voiceService: VoiceService | null = null;
let localLlm: LocalLlmHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let presenceManager: PresenceWindowManager | null = null;
let tray: Tray | null = null;
let persona: PersonaRuntime | null = null;
let isQuitting = false;
let hosting = false;
let closeToHosting = true;
let presenceEnabled = true;
let presenceAlwaysOnTop = true;
let launchAtLogin = false;
let presencePosition: PresenceBounds | null = null;

app.setName(APP_DISPLAY_NAME);
// Resolve the writable data directory before requesting the single-instance
// lock. The default %APPDATA%\herein may be unwritable on this machine, and a
// lock held against an unwritable userData path silently makes every launch
// look like a second instance.
app.setPath('userData', resolveUserDataDirectory());

function mainLog(message: string) {
  const file = process.env.HEREIN_MAIN_LOG?.trim();

  if (!file) {
    return;
  }

  try {
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Startup logging is best-effort.
  }
}

if (process.env.HEREIN_MAIN_LOG?.trim()) {
  // Diagnostic mode only: keep crash details on disk. Without an explicit log
  // target, leave Node's normal fail-fast behavior intact.
  process.on('uncaughtException', error => {
    mainLog(`uncaughtException: ${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
  });

  process.on('unhandledRejection', reason => {
    mainLog(`unhandledRejection: ${reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)}`);
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

mainLog(`single instance lock: ${gotSingleInstanceLock}`);

if (!gotSingleInstanceLock) {
  app.quit();
}

function canWriteDirectory(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    writeFileSync(probe, 'ok', 'utf8');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function canUseUserDataDirectory(dir: string) {
  const dataDir = path.join(dir, 'data');

  if (!canWriteDirectory(dataDir)) {
    return false;
  }

  // Creating new files in the directory can still succeed when the existing
  // database itself is read-only. Use an access check instead of opening the
  // file: opening app.db-wal with a second copy of the app running raises a
  // sharing violation, and treating that as "not writable" silently moved the
  // whole profile to a fallback directory.
  for (const fileName of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const file = path.join(dataDir, fileName);

    if (!existsSync(file)) {
      continue;
    }

    try {
      accessSync(file, constants.W_OK);
    } catch {
      return false;
    }
  }

  return true;
}

const SEEDED_DATA_FILES = [
  'app.db',
  'app.db-wal',
  'app.db-shm',
  'config.json',
  'chat-history.json',
  'api-profiles.json',
  'llm.json',
  'qqbot.json',
];

function seedFallbackUserData(preferredDir: string, fallbackDir: string) {
  const preferredData = path.join(preferredDir, 'data');
  const fallbackData = path.join(fallbackDir, 'data');

  try {
    mkdirSync(fallbackData, { recursive: true });

    for (const fileName of SEEDED_DATA_FILES) {
      const source = path.join(preferredData, fileName);
      const target = path.join(fallbackData, fileName);

      if (existsSync(source) && !existsSync(target)) {
        copyFileSync(source, target);
      }
    }

    const preferredAssets = path.join(preferredData, 'assets');
    const fallbackAssets = path.join(fallbackData, 'assets');

    if (existsSync(preferredAssets) && !existsSync(fallbackAssets)) {
      cpSync(preferredAssets, fallbackAssets, { recursive: true });
    }
  } catch (error) {
    console.warn('[herein] cannot seed fallback data directory', error);
  }
}

let userDataFallback: { preferred: string; used: string } | null = null;

function resolveUserDataDirectory() {
  const override = process.env.HEREIN_USER_DATA_DIR?.trim();

  if (override) {
    const resolved = path.resolve(override);
    mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  const preferred = path.join(app.getPath('appData'), APP_USER_DATA_DIR_NAME);

  if (canUseUserDataDirectory(preferred)) {
    return preferred;
  }

  const candidates = [
    path.join(process.cwd(), '.herein-data'),
    path.join(app.getPath('temp'), 'herein-data'),
  ];

  for (const candidate of candidates) {
    if (canWriteDirectory(candidate)) {
      seedFallbackUserData(preferred, candidate);

      if (canUseUserDataDirectory(candidate)) {
        userDataFallback = { preferred, used: candidate };
        console.warn(`[herein] ${preferred} is not writable; using ${candidate}`);
        return candidate;
      }
    }
  }

  console.warn(`[herein] no writable data directory found; keeping ${preferred}`);
  return preferred;
}

function getUserDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function getDataPath(fileName: string) {
  if (!ALLOWED_DATA_FILES.has(fileName)) {
    throw new Error(`Unsupported data file: ${fileName}`);
  }

  return path.join(getUserDataDir(), fileName);
}

/**
 * 打包后 cwd 可能是临时解压目录，凭据不能只按 cwd 找。
 * 顺序：环境变量 → cwd（开发）→ exe 同级 → 用户数据目录（便携版双机可用）。
 */
function resolveRuntimeFile(fileName: string, envKey: string) {
  const override = process.env[envKey]?.trim();
  const candidates = [
    override,
    path.join(process.cwd(), 'private', 'credentials', fileName),
    path.join(path.dirname(process.execPath), 'private', 'credentials', fileName),
    path.join(getUserDataDir(), fileName),
  ].filter((item): item is string => Boolean(item));

  return candidates.find(candidate => existsSync(candidate));
}

async function ensureDataDir() {
  const dataDir = getUserDataDir();
  await mkdir(dataDir, { recursive: true });

  // Drop-in locations documented in docs/PLUGIN-SETUP.md so users never have to
  // guess where to put a token or a sticker pack.
  for (const dir of ['dsh', path.join('assets', 'stickers')]) {
    try {
      await mkdir(path.join(dataDir, dir), { recursive: true });
    } catch {
      // Non-fatal: the corresponding plugin will report what is missing.
    }
  }
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

function readShellSettings() {
  const repos = getPhase2Repositories();
  const storedPosition = repos.settings.get<unknown>('presencePosition', null);

  presenceEnabled = repos.settings.get<boolean>('presenceEnabled', true) !== false;
  presenceAlwaysOnTop = repos.settings.get<boolean>('presenceAlwaysOnTop', true) !== false;
  closeToHosting = repos.settings.get<boolean>('closeToHosting', true) !== false;
  launchAtLogin = repos.settings.get<boolean>('launchAtLogin', false) === true;
  presencePosition = typeof storedPosition === 'object'
    && storedPosition !== null
    && typeof (storedPosition as { x?: unknown }).x === 'number'
    && typeof (storedPosition as { y?: unknown }).y === 'number'
    ? { x: (storedPosition as { x: number }).x, y: (storedPosition as { y: number }).y }
    : null;
}

function persistShellSetting(key: string, value: unknown) {
  try {
    getPhase2Repositories().settings.set(key, value as never);
  } catch (error) {
    console.warn(`[herein] could not persist ${key}`, error);
  }
}

function activePersonaId() {
  if (persona) {
    return persona.id;
  }

  try {
    const repos = getPhase2Repositories();
    return repos.settings.get<string>('activeCharacterId')
      ?? repos.characters.list()[0]?.id
      ?? null;
  } catch {
    return null;
  }
}

async function getPresenceState(): Promise<DesktopPresenceState | null> {
  const characterId = activePersonaId();

  if (!characterId) {
    return null;
  }

  return resolveDesktopPresence({
    repos: getPhase2Repositories(),
    dataDir: getUserDataDir(),
    characterId,
    persona,
    coreUrl: coreAccess?.url ?? null,
    hosting: Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()),
    mainWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  });
}

function getShellState(): DesktopShellState {
  const mainWindowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  hosting = Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindowVisible);

  return {
    presenceEnabled,
    presenceVisible: presenceManager?.isVisible() ?? false,
    alwaysOnTop: presenceAlwaysOnTop,
    closeToHosting,
    launchAtLogin,
    hosting,
    mainWindowVisible,
  };
}

function broadcastShellState() {
  const state = getShellState();
  presenceManager?.send('shell:state', state);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shell:state', state);
  }

  updateTrayMenu();
}

async function broadcastPresence() {
  if (!presenceManager) {
    return;
  }

  try {
    const state = await getPresenceState();

    if (state) {
      presenceManager.send('presence:state', state);
    }
  } catch (error) {
    console.warn('[herein] could not refresh desktop presence', error);
  }
}

function showMainWindow(openChat = false, messageId?: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();

    if (openChat && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('app:open-chat', messageId ?? '');
      });
    }

    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();

  if (openChat) {
    mainWindow.webContents.send('app:open-chat', messageId ?? '');
  }

  broadcastShellState();
  void broadcastPresence();
}

function setPresenceEnabled(value: boolean) {
  presenceEnabled = value;
  persistShellSetting('presenceEnabled', value);

  if (value) {
    createPresenceWindow();
    presenceManager?.show(presenceAlwaysOnTop);
    void broadcastPresence();
  } else {
    presenceManager?.hide();
  }

  broadcastShellState();
  updateTrayMenu();
}

function setPresenceAlwaysOnTop(value: boolean) {
  presenceAlwaysOnTop = value;
  persistShellSetting('presenceAlwaysOnTop', value);
  presenceManager?.setAlwaysOnTop(value);
  broadcastShellState();
  updateTrayMenu();
}

function setCloseToHosting(value: boolean) {
  closeToHosting = value;
  persistShellSetting('closeToHosting', value);
  broadcastShellState();
  updateTrayMenu();
}

function setLaunchAtLogin(value: boolean) {
  launchAtLogin = value;
  persistShellSetting('launchAtLogin', value);

  try {
    app.setLoginItemSettings({
      openAtLogin: value,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(process.cwd())],
    });
  } catch (error) {
    console.warn('[herein] could not update login item settings', error);
  }

  broadcastShellState();
  updateTrayMenu();
}

function createTray() {
  if (tray) {
    return;
  }

  const candidates = [
    path.join(process.cwd(), 'public', 'herein-icon.png'),
    path.join(__dirname, '../dist/herein-icon.png'),
    path.join(__dirname, '../public/herein-icon.png'),
  ];
  const iconPath = candidates.find(candidate => existsSync(candidate));
  let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip(APP_DISPLAY_NAME);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setToolTip(hosting ? '此间 · 托管中（形象在线）' : '此间');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: hosting ? '打开此间（托管中）' : '打开此间',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: '桌面形象',
      type: 'checkbox',
      checked: presenceEnabled,
      click: item => setPresenceEnabled(item.checked),
    },
    {
      label: '形象保持置顶',
      type: 'checkbox',
      checked: presenceAlwaysOnTop,
      enabled: presenceEnabled,
      click: item => setPresenceAlwaysOnTop(item.checked),
    },
    {
      label: '关闭窗口时进入托管',
      type: 'checkbox',
      checked: closeToHosting,
      click: item => setCloseToHosting(item.checked),
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: launchAtLogin,
      click: item => setLaunchAtLogin(item.checked),
    },
    { type: 'separator' },
    {
      label: '退出此间',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function openPresenceContextMenu() {
  const window = presenceManager?.window ?? mainWindow ?? undefined;

  Menu.buildFromTemplate([
    {
      label: '打开聊天',
      click: () => showMainWindow(true),
    },
    {
      label: '形象保持置顶',
      type: 'checkbox',
      checked: presenceAlwaysOnTop,
      click: item => setPresenceAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    {
      label: '隐藏桌面形象',
      click: () => setPresenceEnabled(false),
    },
    {
      label: '退出此间',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]).popup({ window });
}

function attachRendererLogging(win: BrowserWindow, label: string) {
  // Electron 42 passes a single event object here; the old (event, level,
  // message) form is deprecated.
  const contents = win.webContents as unknown as {
    on: (
      event: 'console-message',
      listener: (event: { level?: string; message?: string }) => void,
    ) => void;
  };

  contents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') {
      console.warn(`[${label}:${event.level}] ${event.message ?? ''}`);
    }
  });
}

async function runStartupDiagnostics() {
  const dir = process.env.HEREIN_DIAG_DIR?.trim();

  if (!dir) {
    return;
  }

  const delayMs = Number.parseInt(process.env.HEREIN_DIAG_DELAY_MS ?? '', 10) || 6000;

  if (process.env.HEREIN_DIAG_HOSTING_TEST === '1') {
    setTimeout(() => {
      mainLog('diag: closing main window to exercise hosting transition');
      mainWindow?.close();
    }, Math.max(1000, delayMs - 3500));
  }

  if (process.env.HEREIN_DIAG_OPEN_CHAT_TEST === '1') {
    setTimeout(() => {
      const win = presenceManager?.window;
      mainLog('diag: asking presence to reopen chat');

      if (win && !win.isDestroyed()) {
        void win.webContents.executeJavaScript(
          'window.hereinShell?.presence.openChat()',
        );
      }
    }, Math.max(1500, delayMs - 2000));
  }

  setTimeout(() => {
    void (async () => {
      try {
        await mkdir(dir, { recursive: true });
        const windows: Array<[string, BrowserWindow | null]> = [
          ['main', mainWindow],
          ['presence', presenceManager?.window ?? null],
        ];

        for (const [name, win] of windows) {
          if (!win || win.isDestroyed()) {
            console.log(`[diag] ${name}: missing`);
            continue;
          }

          const bounds = win.getBounds();
          const visible = win.isVisible();

          if (!visible) {
            console.log(`[diag] ${name}: url=${win.webContents.getURL()} visible=false bounds=${JSON.stringify(bounds)} topmost=${win.isAlwaysOnTop()}`);
            continue;
          }

          const text = await win.webContents.executeJavaScript('document.body.innerText').catch((error: unknown) => (
            `executeJavaScript failed: ${error instanceof Error ? error.message : String(error)}`
          ));
          const canvasCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll("canvas").length',
          ).catch(() => -1);
          const image = await win.webContents.capturePage();
          await writeFile(path.join(dir, `${name}.png`), image.toPNG());
          console.log(`[diag] ${name}: url=${win.webContents.getURL()} visible=true bounds=${JSON.stringify(bounds)} topmost=${win.isAlwaysOnTop()} canvas=${String(canvasCount)} text=${JSON.stringify(String(text).slice(0, 800))}`);
        }

        const state = await getPresenceState();
        console.log(`[diag] shellState=${JSON.stringify(getShellState())}`);
        console.log(`[diag] presenceState=${JSON.stringify(state)}`);

        const primary = screen.getPrimaryDisplay();
        console.log(`[diag] display=${JSON.stringify(primary.bounds)} workArea=${JSON.stringify(primary.workArea)} scale=${primary.scaleFactor}`);

        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.round(primary.bounds.width * primary.scaleFactor),
            height: Math.round(primary.bounds.height * primary.scaleFactor),
          },
        });

        if (sources[0]) {
          await writeFile(path.join(dir, 'desktop.png'), sources[0].thumbnail.toPNG());
        }
      } catch (error) {
        console.error('[diag] failed', error);
      }

      if (process.env.HEREIN_DIAG_EXIT === '1') {
        isQuitting = true;
        app.quit();
      }
    })();
  }, delayMs);
}

function createPresenceWindow() {
  if (!presenceEnabled) {
    return;
  }

  if (!presenceManager) {
    presenceManager = new PresenceWindowManager({
      preloadPath: path.join(__dirname, 'preload.js'),
      isDev,
      devUrl: process.env.HEREIN_DEV_URL ?? 'http://127.0.0.1:5173',
      productionHtmlPath: path.join(__dirname, '../dist/index.html'),
      getSavedPosition: () => presencePosition,
      savePosition: position => {
        presencePosition = position;
        persistShellSetting('presencePosition', position);
      },
    });
  }

  const win = presenceManager.ensure(presenceAlwaysOnTop);

  if (win.webContents.listenerCount('console-message') === 0) {
    attachRendererLogging(win, 'presence');
  }
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
      firstMessage: '',
      systemPrompt: '',
      personalityCore: '温柔、机敏、有陪伴感。',
      speakingStyle: '自然、具体、轻松。',
      valuesText: '重视真实陪伴、尊重用户边界。',
      boundaries: '不展示思维过程，不替用户做危险决定。',
    });
    repos.timelines.ensurePrimaryForCharacter('herein-default', '新角色');
    repos.settings.set('activeCharacterId', 'herein-default');
    repos.settings.set('themeMode', 'light');
  }
}

function bootstrapPhase2() {
  const db = getPhase2Database();
  migratePhase1JsonData({ db, dataDir: getUserDataDir() });

  const repos = getPhase2Repositories();

  if (persona) {
    syncPersonaCharacter(repos, persona.pack);
  } else {
    ensureDefaultCharacter();
  }

  return {
    settings: {
      activeCharacterId: repos.settings.get('activeCharacterId', null),
      activeProfileId: repos.settings.get('activeProfileId', null),
      themeMode: repos.settings.get('themeMode', 'light'),
      voiceConfig: repos.settings.get('voiceConfig', null),
      memoryEnabled: repos.settings.get('memoryEnabled', true),
      memoryProfileMode: repos.settings.get('memoryProfileMode', 'follow-chat'),
      memoryProfileId: repos.settings.get('memoryProfileId', null),
      summaryTriggerMessageCount: repos.settings.get('summaryTriggerMessageCount', 20),
    },
    persona: persona
      ? {
        id: persona.id,
        name: persona.name,
        nickname: persona.nickname,
        relationshipFrame: persona.pack.character.relationshipFrame,
        avatar: persona.pack.character.avatar ?? null,
      }
      : null,
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
  const name = path.basename(filePath).toLowerCase();
  return name.endsWith('.model3.json') || name.endsWith('.model.json');
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
      source: 'user',
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
      source: 'user',
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
    const repos = getPhase2Repositories();
    repos.messages.clearTimeline(timelineId);
    repos.summaries.deleteByTimeline(timelineId);
    repos.openLoops.clearTimeline(timelineId);
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
    const repos = getPhase2Repositories();
    repos.summaries.upsert(summary);
    const db = getPhase2Database();
    const row = db
      .prepare('select character_id from timelines where id = ?')
      .get(summary.timelineId) as { character_id: string } | undefined;

    if (row) {
      createMemoryStore(db).narratives.append({
        characterId: row.character_id,
        timelineId: summary.timelineId,
        content: summary.content,
        messageCount: summary.messageCount,
        sourceMessageIds: summary.sourceMessageIds,
        watermarkMessageId: summary.sourceMessageIds[summary.sourceMessageIds.length - 1] ?? null,
      });
    }

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

function registerShellHandlers() {
  ipcMain.handle('presence:get-state', async () => {
    return await getPresenceState();
  });

  ipcMain.handle('presence:get-shell-state', () => getShellState());

  ipcMain.handle('presence:refresh', async () => {
    await broadcastPresence();
    return true;
  });

  ipcMain.handle('voice:transcribe', async (_event, pcm: unknown, turnId?: unknown) => {
    if (!(pcm instanceof Uint8Array)) {
      throw new Error('Invalid audio');
    }

    if (!voiceService) {
      throw new Error('Voice backend is not ready');
    }

    const result = await voiceService.transcribe(pcm);

    if (result.error) {
      throw new Error(result.error);
    }

    const text = (result.text ?? '').trim();
    const rejected = voiceTranscriptFilter.inspect(result, text);

    if (rejected) {
      if (rejected !== 'empty') {
        mainLog(`voice transcript ignored: ${rejected}`);
      }
      return { text: '', rejected };
    }

    if (text && coreAccess) {
      try {
        const response = await fetch(`${coreAccess.url}/v1/voice/transcript`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${coreAccess.token}`,
          },
          body: JSON.stringify({
            text,
            turnId: typeof turnId === 'string' ? turnId : undefined,
          }),
        });

        if (!response.ok) {
          mainLog(`voice transcript rejected: ${response.status}`);
        }
      } catch (error) {
        mainLog(`voice transcript failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { text, elapsedMs: result.elapsedMs };
  });

  ipcMain.handle('voice:cancel', async () => {
    voiceService?.cancel();

    if (coreAccess) {
      try {
        await fetch(`${coreAccess.url}/v1/voice/interrupt`, {
          method: 'POST',
          headers: { authorization: `Bearer ${coreAccess.token}` },
        });
      } catch {
        // The next transcript will start a fresh generation anyway.
      }
    }

    return true;
  });

  ipcMain.handle('voice:status', () => ({
    ready: voiceService?.ready ?? { asr: false, tts: false },
  }));

  ipcMain.handle('presence:open-chat', (_event, messageId?: unknown) => {
    showMainWindow(true, typeof messageId === 'string' ? messageId : undefined);
    return true;
  });

  ipcMain.handle('presence:context-menu', () => {
    openPresenceContextMenu();
    return true;
  });

  ipcMain.handle('presence:get-bounds', () => {
    return presenceManager?.getBounds() ?? null;
  });

  ipcMain.on('presence:move-to', (_event, x: unknown, y: unknown) => {
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      presenceManager?.moveTo({ x, y });
    }
  });

  ipcMain.handle('presence:hide', () => {
    setPresenceEnabled(false);
    return true;
  });

  ipcMain.handle('app:set-presence-enabled', (_event, value: unknown) => {
    setPresenceEnabled(Boolean(value));
    return getShellState();
  });

  ipcMain.handle('app:set-always-on-top', (_event, value: unknown) => {
    setPresenceAlwaysOnTop(Boolean(value));
    return getShellState();
  });

  ipcMain.handle('app:set-close-to-hosting', (_event, value: unknown) => {
    setCloseToHosting(Boolean(value));
    return getShellState();
  });

  ipcMain.handle('app:set-launch-at-login', (_event, value: unknown) => {
    setLaunchAtLogin(Boolean(value));
    return getShellState();
  });

  ipcMain.handle('app:show-main', () => {
    showMainWindow();
    return true;
  });

  ipcMain.handle('app:quit', () => {
    isQuitting = true;
    app.quit();
    return true;
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }

  const iconCandidates = [
    path.join(process.cwd(), 'public', 'herein-icon.png'),
    path.join(__dirname, '../dist/herein-icon.png'),
  ];
  const iconPath = iconCandidates.find(candidate => existsSync(candidate));
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F7F6FB',
    title: APP_DISPLAY_NAME,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  attachRendererLogging(win, 'main');
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.HEREIN_DEV_URL ?? 'http://127.0.0.1:5173';
    const prodRoot = pathToFileURL(path.resolve(__dirname, '../dist')).href;
    const allowed = isDev
      ? url.startsWith(devUrl)
      : url.startsWith(prodRoot);

    if (!allowed) {
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    broadcastShellState();
    void broadcastPresence();
  });

  win.on('close', event => {
    mainLog(`main close requested: quitting=${isQuitting} closeToHosting=${closeToHosting}`);

    if (isQuitting || !closeToHosting) {
      return;
    }

    event.preventDefault();
    win.hide();
    hosting = true;
    mainLog(`main hidden; visible=${win.isVisible()} hosting=${hosting}`);
    mainLog('broadcast shell state: before');
    broadcastShellState();
    mainLog('broadcast shell state: after');
    mainLog('broadcast presence: before schedule');
    void broadcastPresence();
    mainLog('broadcast presence: after schedule');
  });

  win.on('show', () => {
    hosting = false;
    broadcastShellState();
    void broadcastPresence();
  });

  win.on('hide', () => {
    hosting = true;
    mainLog('main hide event');
    broadcastShellState();
    void broadcastPresence();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    void win.loadURL(process.env.HEREIN_DEV_URL ?? 'http://127.0.0.1:5173');
    if (shouldOpenDevTools) {
      win.webContents.openDevTools();
    }
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

async function startEmbeddedCore(personaPacks: ReadonlyMap<string, PersonaPack>) {
  if (process.env.HEREIN_EMBED_CORE === '0') {
    return;
  }

  try {
    await ensureDataDir();
    const token = randomUUID();
    const fallbackVoiceApi = process.env.HEREIN_VOICE_LLM_FALLBACK_API === '1';
    const voiceEnabled = Boolean(voiceService)
      && (Boolean(localLlm) || fallbackVoiceApi)
      && process.env.HEREIN_VOICE_ENABLED !== '0';
    const qqConfigPath = resolveRuntimeFile('qqbot.json', 'HEREIN_QQ_CONFIG');
    const llmConfigPath = resolveRuntimeFile('llm.json', 'HEREIN_LLM_CONFIG');
    const qqEnabled = process.env.HEREIN_QQ_ENABLED === '0'
      ? false
      : Boolean(qqConfigPath) || process.env.HEREIN_QQ_ENABLED === '1';
    const handle = await startCoreServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: getUserDataDir(),
      assetDirs: resolveAssetRoots(getUserDataDir()),
      // Plugins ship next to the app (extraResources) so they keep working when
      // the process is launched from a shortcut with an arbitrary cwd.
      pluginsDir: process.env.HEREIN_PLUGINS_DIR
        ?? path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'plugins'),
      // ctx.loadModule() resolves bundled adapters against this root; in a
      // packaged build that is inside app.asar, which import() can read.
      appRoot: app.getAppPath(),
      token,
      ttsUrl: voiceRuntime?.ttsUrl,
      interactionPort: voiceService?.createPort(),
      personaPacks,
      seedPersonaPacks: true,
      experienceAuto: process.env.HEREIN_EXPERIENCE_AUTO === '1',
      // 有凭据就默认开 QQ；HEREIN_QQ_ENABLED=0 可强制关闭。
      qqListener: {
        enabled: qqEnabled,
        configPath: qqConfigPath,
        autoReply: process.env.HEREIN_QQ_AUTO_REPLY !== '0',
      },
      llmConfigPath,
      proactiveShare: { enabled: false },
      initiativeAuto: { enabled: process.env.HEREIN_INITIATIVE_AUTO !== '0' },
      initiative: {
        quietHours: {
          start: process.env.HEREIN_INITIATIVE_QUIET_START ?? '01:30',
          end: process.env.HEREIN_INITIATIVE_QUIET_END ?? '08:00',
        },
      },
      materialsAuto: { enabled: process.env.HEREIN_MATERIAL_AUTO !== '0' },
      voice: {
        enabled: voiceEnabled,
        llmConfig: localLlm?.config,
        llmConfigPath: localLlm?.configPath,
        maxTokens: localLlm?.config.maxTokens,
      },
    });
    coreHandle = handle;
    coreAccess = { url: `http://127.0.0.1:${handle.port}`, token };
    console.log(`embedded core: ${coreAccess.url}`);
  } catch (error) {
    console.warn('embedded core did not start:', error);
  }
}

ipcMain.on('core:access', event => {
  event.returnValue = coreAccess;
});

// Settings forms let users point at a token file or a sticker directory without
// typing a Windows path by hand.
ipcMain.handle('dialog:pick', async (_event, rawOptions: unknown) => {
  const options = rawOptions && typeof rawOptions === 'object'
    ? rawOptions as Record<string, unknown>
    : {};
  const mode = options.mode === 'directory' ? 'openDirectory' : 'openFile';
  const title = typeof options.title === 'string' ? options.title : undefined;
  const result = await dialog.showOpenDialog({
    ...(title ? { title } : {}),
    properties: [mode],
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('shell:open-external', async (_event, target: unknown) => {
  if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
    return false;
  }

  await shell.openExternal(target);
  return true;
});

registerStorageHandlers();
registerTtsHandlers();
registerPhase2Handlers();
registerShellHandlers();

app.on('second-instance', () => {
  if (app.isReady()) {
    showMainWindow(true);
  }
});

// A packaged build has no project directory behind it, so the persona pack,
// local content manifest and fallback assets are shipped next to the app
// (extraResources) and pointed at explicitly. In development they still come
// from ./private via the defaults.
function configurePackagedResourcePaths() {
  if (!app.isPackaged) {
    return;
  }

  const personaDir = path.join(process.resourcesPath, 'persona');

  if (!process.env.HEREIN_PERSONA_DIR && existsSync(personaDir)) {
    process.env.HEREIN_PERSONA_DIR = personaDir;
  }

  const localContent = path.join(process.resourcesPath, 'local-content.json');

  if (!process.env.HEREIN_LOCAL_CONTENT && existsSync(localContent)) {
    process.env.HEREIN_LOCAL_CONTENT = localContent;
  }

  const assetsDir = path.join(process.resourcesPath, 'private-assets');

  if (!process.env.HEREIN_ASSETS_DIR && existsSync(assetsDir)) {
    process.env.HEREIN_ASSETS_DIR = assetsDir;
  }
}

app.whenReady().then(async () => {
  mainLog('app ready');
  configurePackagedResourcePaths();

  if (userDataFallback) {
    // Splitting the profile across two directories looks like "my chat history
    // and API keys disappeared", so surface the switch instead of hiding it.
    mainLog(`userData fallback: ${userDataFallback.preferred} -> ${userDataFallback.used}`);
    void dialog.showMessageBox({
      type: 'warning',
      title: '数据目录不可写',
      message: '此间 无法写入默认数据目录，已改用备用位置。',
      detail: [
        `默认目录：${userDataFallback.preferred}`,
        `实际使用：${userDataFallback.used}`,
        '',
        '聊天记录与设置保存在实际使用的目录中。请检查默认目录权限后重启，避免历史记录被分成两份。',
      ].join('\n'),
      buttons: ['知道了'],
      noLink: true,
    });
  }

  if (!gotSingleInstanceLock) {
    mainLog('quitting because the single instance lock was not acquired');
    return;
  }

  Menu.setApplicationMenu(null);

  let personaPacks: ReadonlyMap<string, PersonaPack> = new Map();

  try {
    personaPacks = await loadPersonaPacks(resolvePersonaRoot());
    persona = selectPrimaryPersona(personaPacks);
    mainLog(`persona packs: ${[...personaPacks.keys()].join(',')}; selected=${persona?.id ?? 'none'}`);

    if (persona) {
      console.log(`persona: ${persona.name} (${persona.id})`);
    } else {
      console.warn('no persona pack was found; falling back to the local default character');
    }
  } catch (error) {
    mainLog(`persona load failed: ${error instanceof Error ? error.message : String(error)}`);
    console.warn('persona packs were not loaded:', error);
  }

  try {
    await ensureDataDir();
    const db = getPhase2Database();
    migratePhase1JsonData({ db, dataDir: getUserDataDir() });
    const repos = getPhase2Repositories();

    if (persona) {
      syncPersonaCharacter(repos, persona.pack);
    } else {
      ensureDefaultCharacter();
    }

    readShellSettings();
    mainLog(`local data ready; active=${activePersonaId() ?? 'none'}`);
  } catch (error) {
    mainLog(`local data failed: ${error instanceof Error ? error.message : String(error)}`);
    console.warn('local data could not be prepared before startup:', error);
  }

  const legacyVoice = process.env.HEREIN_VOICE_MODE === 'legacy';

  if (legacyVoice) {
    mainLog('starting legacy voice runtime');
    voiceRuntime = await startVoiceRuntime({
      rootDir: path.resolve(__dirname, '..'),
      userDataRoot: app.getPath('userData'),
      logger: mainLog,
    });
    voiceService = new VoiceService({
      configPath: voiceRuntime.configPath,
      speaker: process.env.HEREIN_VOICE_SPEAKER ?? 'vivian',
      httpTtsUrl: voiceRuntime.ttsUrl,
      onPcm: (pcm, meta) => {
        const target = presenceManager?.window;

        if (target && !target.isDestroyed()) {
          target.webContents.send('voice:pcm', {
            generation: meta.generation,
            first: meta.first,
            provider: meta.provider,
            pcm: Buffer.from(pcm),
          });
        }
      },
      onCancel: generation => {
        const target = presenceManager?.window;

        if (target && !target.isDestroyed()) {
          target.webContents.send('voice:cancel-event', { generation });
        }
      },
      logger: {
        info: (message, detail) => mainLog(`${message} ${detail ? JSON.stringify(detail) : ''}`),
        warn: (message, detail) => mainLog(`${message} ${detail ? JSON.stringify(detail) : ''}`),
      },
    });
    mainLog(`voice runtime: config=${voiceRuntime.configPath ?? 'none'} tts=${voiceRuntime.ttsUrl}`);
    voiceService.start();
    const ttsReady = await voiceService.waitForTts(30_000);
    mainLog(`local TTS: ${ttsReady ? 'ready' : 'not ready'}`);

    mainLog('starting local voice LLM');
    localLlm = await startLocalLlm({
      rootDir: path.resolve(__dirname, '..'),
      userDataRoot: app.getPath('userData'),
      logger: mainLog,
    });
    mainLog(`local voice LLM: ${localLlm?.url ?? 'unavailable'}`);
  } else {
    mainLog('voice mode off; presence is text-only');
  }

  mainLog('starting embedded core');
  await startEmbeddedCore(personaPacks);
  mainLog(`embedded core: ${coreAccess?.url ?? 'unavailable'}`);

  mainLog('creating windows');
  createWindow();
  createTray();
  createPresenceWindow();
  if (legacyVoice) {
    const pttRegistered = globalShortcut.register('Control+Shift+Space', () => {
      presenceManager?.window?.webContents.send('voice:ptt');
    });
    mainLog(`push-to-talk shortcut: ${pttRegistered ? 'registered' : 'unavailable'}`);
  }
  mainLog(`windows: main=${mainWindow ? 'yes' : 'no'} presence=${presenceManager ? 'yes' : 'no'} tray=${tray ? 'yes' : 'no'}`);
  void runStartupDiagnostics();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      showMainWindow(true);
    }
  });
});

app.on('before-quit', event => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  presenceManager?.destroy();
  presenceManager = null;
  tray?.destroy();
  tray = null;
  voiceService?.close();
  voiceService = null;

  if (!coreHandle || coreClosing) {
    phase2Db?.close();
    phase2Db = null;
    const runtime = voiceRuntime;
    voiceRuntime = null;
    const local = localLlm;
    localLlm = null;
    void Promise.all([runtime?.stop(), local?.stop()]);
    return;
  }

  event.preventDefault();
  coreClosing = true;
  const handle = coreHandle;
  coreHandle = null;
  const runtime = voiceRuntime;
  voiceRuntime = null;
  const local = localLlm;
  localLlm = null;
  const voiceStop = runtime?.stop() ?? Promise.resolve();
  const localStop = local?.stop() ?? Promise.resolve();
  const forceExit = setTimeout(() => {
    mainLog('core close timed out; forcing exit');
    app.exit(0);
  }, 10000);

  void Promise.all([handle.close(), voiceStop, localStop]).finally(() => {
    clearTimeout(forceExit);
    phase2Db?.close();
    phase2Db = null;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  // Closing the chat window is a transition into background hosting, not an
  // exit. The tray/presence window keeps the app and the embedded Core alive,
  // so the companion stays online until the user explicitly chooses 退出.
  if (process.platform === 'darwin') {
    return;
  }
});
