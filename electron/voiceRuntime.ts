import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface VoiceRuntimeOptions {
  rootDir: string;
  userDataRoot: string;
  logger?: (message: string) => void;
}

export interface VoiceRuntimeHandle {
  configPath: string | null;
  ttsUrl: string;
  stop: () => Promise<void>;
}

interface EndpointFile {
  url?: string;
  token?: string;
  pid?: number;
}

interface ManagedProcess {
  child?: ChildProcess;
  pid?: number;
}

interface InteractionConfig {
  asr?: {
    python?: string;
    model?: string;
    device?: string;
    cudaBin?: string;
  };
  tts?: {
    provider?: string;
    voice?: string;
    qwenPython?: string;
    qwenModel?: string;
    ggufSource?: string;
    ggufDependencies?: string;
    ggufDecoder?: string;
  };
  avatarManifest?: string;
  vad?: Record<string, number>;
  rendererDir?: string;
}

function log(options: VoiceRuntimeOptions, message: string) {
  options.logger?.(`[voice-runtime] ${message}`);
}

function exists(file: string | undefined): file is string {
  return Boolean(file && existsSync(file));
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

function firstExisting(candidates: Array<string | undefined>): string | null {
  return candidates.find(exists) ?? null;
}

function findWhisperModel(): string | null {
  const base = path.join(
    os.homedir(),
    '.cache',
    'huggingface',
    'hub',
    'models--Systran--faster-whisper-small',
    'snapshots',
  );

  try {
    const snapshots = readdirSync(base)
      .map(name => path.join(base, name))
      .filter(candidate => existsSync(path.join(candidate, 'model.bin')));

    return snapshots[0] ?? null;
  } catch {
    return null;
  }
}

function resolveAsr(template: InteractionConfig | null): InteractionConfig['asr'] | null {
  const python = firstExisting([
    process.env.HEREIN_ASR_PYTHON,
    template?.asr?.python,
    'D:\\AI\\tools\\whisper\\Scripts\\python.exe',
  ]);
  const model = firstExisting([
    process.env.HEREIN_ASR_MODEL,
    template?.asr?.model,
    findWhisperModel() ?? undefined,
  ]);

  if (!python || !model) {
    return null;
  }

  const cudaBin = firstExisting([
    process.env.HEREIN_ASR_CUDA_BIN,
    template?.asr?.cudaBin,
    'D:\\AI\\tools\\qwen_tts\\venv\\Lib\\site-packages\\torch\\lib',
  ]);

  return {
    python,
    model,
    device: process.env.HEREIN_ASR_DEVICE ?? template?.asr?.device ?? 'cuda',
    ...(cudaBin ? { cudaBin } : {}),
  };
}

function resolveTts(
  options: VoiceRuntimeOptions,
  template: InteractionConfig | null,
): NonNullable<InteractionConfig['tts']> {
  const officialModel = firstExisting([
    process.env.HEREIN_INTERACTION_QWEN_MODEL,
    path.join(options.rootDir, 'tmp', 'models', 'qwen3-tts-0.6b-customvoice'),
  ]);
  const requested = process.env.HEREIN_INTERACTION_TTS_PROVIDER
    ?? (officialModel ? 'qwen' : template?.tts?.provider);

  if (requested === 'qwen-gguf') {
    const qwenPython = firstExisting([
      process.env.HEREIN_INTERACTION_QWEN_PYTHON,
      template?.tts?.qwenPython,
      'D:\\AI\\tools\\qwen_tts\\venv\\Scripts\\python.exe',
    ]);
    const qwenModel = firstExisting([
      process.env.HEREIN_INTERACTION_QWEN_MODEL,
      template?.tts?.qwenModel,
    ]);
    const ggufSource = firstExisting([
      process.env.HEREIN_INTERACTION_GGUF_SOURCE,
      template?.tts?.ggufSource,
    ]);
    const ggufDependencies = firstExisting([
      process.env.HEREIN_INTERACTION_GGUF_DEPENDENCIES,
      template?.tts?.ggufDependencies,
    ]);

    if (qwenPython && qwenModel && ggufSource) {
      return {
        provider: 'qwen-gguf',
        voice: template?.tts?.voice ?? 'Microsoft Huihui Desktop',
        qwenPython,
        qwenModel,
        ggufSource,
        ...(ggufDependencies ? { ggufDependencies } : {}),
        ggufDecoder: process.env.HEREIN_INTERACTION_GGUF_DECODER
          ?? template?.tts?.ggufDecoder
          ?? 'DML',
      };
    }

    log(options, 'qwen-gguf paths are incomplete; falling back to sapi');
  }

  if (requested === 'qwen') {
    const qwenPython = firstExisting([
      process.env.HEREIN_INTERACTION_QWEN_PYTHON,
      template?.tts?.qwenPython,
      'D:\\AI\\tools\\qwen_tts\\venv\\Scripts\\python.exe',
    ]);
    const qwenModel = firstExisting([
      process.env.HEREIN_INTERACTION_QWEN_MODEL,
      officialModel ?? undefined,
      template?.tts?.qwenModel,
    ]);

    if (qwenPython && qwenModel) {
      return {
        provider: 'qwen',
        voice: template?.tts?.voice ?? 'Microsoft Huihui Desktop',
        qwenPython,
        qwenModel,
      };
    }
  }

  return {
    provider: 'sapi',
    voice: process.env.HEREIN_INTERACTION_SAPI_VOICE
      ?? template?.tts?.voice
      ?? 'Microsoft Huihui Desktop',
  };
}

function writeAvatarManifest(rootDir: string, dataDir: string): string | null {
  const dshRoot = path.join(rootDir, 'private', 'assets');
  const dshModel = path.join(dshRoot, 'avatars', 'dsh_l2d', 'deepseek.model3.json');
  const dshCore = path.join(dshRoot, 'live2d', 'core4', 'live2dcubismcore.min.js');

  if (existsSync(dshModel) && existsSync(dshCore)) {
    const manifestPath = path.join(dataDir, 'avatar.local.json');
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      cubism: 4,
      root: dshRoot,
      entry: path.join('avatars', 'dsh_l2d', 'deepseek.model3.json'),
      core: path.join('live2d', 'core4', 'live2dcubismcore.min.js'),
      parameters: {
        mouth: 'ParamMouthOpenY',
        breath: 'ParamBreath',
        eyeLeft: 'ParamEyeLOpen',
        eyeRight: 'ParamEyeROpen',
        eyeX: 'ParamEyeBallX',
        eyeY: 'ParamEyeBallY',
        smileLeft: 'ParamEyeLSmile',
        mouthForm: 'ParamMouthForm',
        angleY: 'ParamAngleY',
      },
      expressions: {
        neutral: null,
        happy: 'happy',
        excited: 'happy2',
        puzzled: 'puzzled',
        relaxed: 'relax',
        sad: 'unhappy',
      },
      motions: {
        idle: { group: 'Idle', index: 0, loop: true },
        speaking: { group: 'Anima', index: 0, loop: true },
        thinking: { group: 'Anima', index: 2, loop: true },
        thinkEnd: { group: 'Anima', index: 1, loop: false },
      },
      states: {
        idle: 'idle',
        listening: 'idle',
        paused: 'idle',
        interrupted: 'idle',
        thinking: 'thinking',
        speaking: 'speaking',
      },
      interactions: {
        tap: { motion: 'thinkEnd', emotion: 'happy' },
        drag: { motion: 'thinkEnd', emotion: 'puzzled' },
      },
      scale: 0.92,
      offsetX: 0,
      offsetY: 0,
    }, null, 2));
    return manifestPath;
  }

  const fallback = path.join(rootDir, 'tmp', 'interaction-avatar.local.json');

  if (existsSync(fallback)) {
    const manifestPath = path.join(dataDir, 'avatar.local.json');
    writeFileSync(manifestPath, readFileSync(fallback));
    return manifestPath;
  }

  return null;
}

function buildInteractionConfig(
  options: VoiceRuntimeOptions,
  dataDir: string,
): string | null {
  const explicit = process.env.HEREIN_INTERACTION_CONFIG?.trim();

  if (explicit) {
    const resolved = path.resolve(explicit);
    return existsSync(resolved) ? resolved : null;
  }

  const templatePath = path.join(options.rootDir, 'tmp', 'interaction-portrait-config.local.json');
  const template = readJson<InteractionConfig>(templatePath);
  const asr = resolveAsr(template);
  const rendererDir = path.join(options.rootDir, 'tmp', 'interaction-dist');
  const avatarManifest = writeAvatarManifest(options.rootDir, dataDir);

  if (!asr || !avatarManifest || !existsSync(path.join(rendererDir, 'index.html'))) {
    log(options, 'interaction runtime is missing ASR, avatar, or renderer dist');
    return null;
  }

  const configPath = path.join(dataDir, 'interaction-config.local.json');
  const config = {
    asr,
    tts: resolveTts(options, template),
    avatarManifest,
    port: Number(process.env.HEREIN_INTERACTION_PORT ?? 0) || 0,
    alwaysOnTop: false,
    fps: 30,
    framing: 'bust',
    autoListen: true,
    headless: process.env.HEREIN_INTERACTION_HEADLESS !== '0',
    silentOutput: false,
    diagnostics: false,
    vad: {
      startMs: 50,
      endMs: 500,
      maxUtteranceMs: 15000,
      ...(template?.vad ?? {}),
      threshold: Number(process.env.HEREIN_VAD_THRESHOLD ?? 0.01),
      minSpeechMs: Number(process.env.HEREIN_VAD_MIN_SPEECH_MS ?? 120),
    },
    rendererDir,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function spawnLogged(
  options: VoiceRuntimeOptions,
  command: string,
  args: string[],
  logName: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess | null {
  const logDir = path.join(options.userDataRoot, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, logName);
  const fd = openSync(logPath, 'a');

  try {
    const child = spawn(command, args, {
      cwd: options.rootDir,
      env,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
    child.on('error', error => log(options, `${logName} failed: ${error.message}`));
    return child;
  } catch (error) {
    log(options, `${logName} spawn failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    closeSync(fd);
  }
}

async function killPid(pid: number): Promise<void> {
  if (!pid || !Number.isInteger(pid)) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        killer.kill();
        resolve();
      }, 3000);
      killer.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      killer.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The process may already be gone.
  }
}

async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.killed) {
    return;
  }

  await killPid(child.pid);
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function waitForPidFile(file: string, timeoutMs = 5000): Promise<number | null> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return null;
}

async function startTts(
  options: VoiceRuntimeOptions,
): Promise<{ process: ManagedProcess; url: string }> {
  const port = Number(process.env.HEREIN_TTS_PORT ?? 9881) || 9881;
  const url = `http://127.0.0.1:${port}`;

  if (process.env.HEREIN_TTS_AUTO === '0') {
    return { process: {}, url };
  }

  const launcherPidFile = path.join(options.rootDir, 'tmp', 'herein-tts.pid');
  const launcherPid = existsSync(launcherPidFile)
    ? Number(readFileSync(launcherPidFile, 'utf8').trim())
    : null;

  if (launcherPid && pidAlive(launcherPid)) {
    log(options, `adopting TTS service on pid ${launcherPid}`);
    return { process: { pid: launcherPid }, url };
  }

  if (await portOpen(port)) {
    log(options, `TTS service already listening on ${port}`);
    return { process: {}, url };
  }

  const python = firstExisting([
    process.env.HEREIN_TTS_PYTHON,
    'D:\\AI\\tools\\qwen_tts\\venv\\Scripts\\python.exe',
  ]);
  const model = firstExisting([
    process.env.HEREIN_TTS_MODEL,
    path.join(options.rootDir, 'tmp', 'models', 'qwen3-tts-0.6b-customvoice'),
    path.join(options.rootDir, 'tmp', 'models', 'qwen3-tts-customvoice'),
  ]);
  const script = path.join(options.rootDir, 'scripts', 'qwen3_tts_service.py');

  if (!python || !model || !existsSync(script)) {
    log(options, 'TTS service is not available (python/model/script missing)');
    return { process: {}, url };
  }

  log(options, `starting TTS service on ${port}`);
  const logDir = path.join(options.userDataRoot, 'logs');
  mkdirSync(logDir, { recursive: true });
  const args = [
    script,
    '--mode', 'custom_voice',
    '--model', model,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--device', process.env.HEREIN_TTS_DEVICE ?? 'cuda:0',
    '--no-flash-attn',
  ];

  if (process.platform === 'win32') {
    const pidFile = path.join(logDir, 'herein-tts.pid');
    const wrapperPath = path.join(logDir, 'herein-tts-start.ps1');
    const wrapper = [
      '$ErrorActionPreference = "Stop"',
      `$p = Start-Process -FilePath ${psQuote(python)} -ArgumentList @(${args.map(psQuote).join(', ')}) -WorkingDirectory ${psQuote(options.rootDir)} -WindowStyle Hidden -RedirectStandardOutput ${psQuote(path.join(logDir, 'herein-tts.out.log'))} -RedirectStandardError ${psQuote(path.join(logDir, 'herein-tts.err.log'))} -PassThru`,
      `Set-Content -LiteralPath ${psQuote(pidFile)} -Value $p.Id`,
    ].join('\r\n');
    writeFileSync(wrapperPath, wrapper);

    try {
      unlinkSync(pidFile);
    } catch {
      // No stale PID file.
    }

    const starter = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      wrapperPath,
    ], {
      cwd: options.rootDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        ...(process.env.HEREIN_TTS_OFFLINE === '0'
          ? {}
          : { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }),
      },
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    starter.unref();

    const pid = await waitForPidFile(pidFile);

    if (pid) {
      log(options, `TTS service started on pid ${pid}`);
      return { process: { pid }, url };
    }

    log(options, 'TTS service starter did not report a pid; leaving TTS to the launcher');
    return { process: {}, url };
  }

  const child = spawnLogged(options, python, args, 'herein-tts.log', {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    ...(process.env.HEREIN_TTS_OFFLINE === '0'
      ? {}
      : { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }),
  });

  return { process: child ? { child } : {}, url };
}

async function startInteraction(
  options: VoiceRuntimeOptions,
  dataDir: string,
): Promise<{ child: ChildProcess | null; endpointFile: string }> {
  const endpointFile = path.join(dataDir, 'endpoint.local.json');

  if (process.env.HEREIN_INTERACTION_AUTO === '0') {
    return { child: null, endpointFile };
  }

  const existing = readJson<EndpointFile>(endpointFile);

  if (existing && pidAlive(existing.pid)) {
    log(options, `interaction runtime already running on ${existing.pid}`);
    return { child: null, endpointFile };
  }

  if (existsSync(endpointFile)) {
    try {
      unlinkSync(endpointFile);
    } catch {
      // A stale endpoint will be ignored by C because its PID is dead.
    }
  }

  const configPath = buildInteractionConfig(options, dataDir);

  if (!configPath) {
    log(options, 'interaction runtime config is not available');
    return { child: null, endpointFile };
  }

  const interactionDir = path.join(options.rootDir, 'apps', 'interaction');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const args = [
    interactionDir,
    `--config=${configPath}`,
    `--data-dir=${dataDir}`,
    `--user-data-dir=${dataDir}`,
  ];

  if (process.argv.includes('--no-sandbox')) {
    args.push('--no-sandbox');
  }

  log(options, 'starting interaction runtime');
  const child = spawnLogged(options, process.execPath, args, 'herein-interaction.log', env);

  return { child, endpointFile };
}

function buildVoiceWorkerConfig(
  options: VoiceRuntimeOptions,
  dataDir: string,
): string | null {
  const templatePath = path.join(options.rootDir, 'tmp', 'interaction-portrait-config.local.json');
  const template = readJson<InteractionConfig>(templatePath);
  const asr = resolveAsr(template);

  if (!asr) {
    log(options, 'voice config skipped: ASR is not available');
    return null;
  }

  const tts = resolveTts(options, template);
  const configPath = path.join(dataDir, 'voice-config.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        asr,
        tts,
        vad: {
          startMs: 50,
          endMs: 500,
          maxUtteranceMs: 15_000,
          threshold: Number(process.env.HEREIN_VAD_THRESHOLD ?? 0.01),
          minSpeechMs: Number(process.env.HEREIN_VAD_MIN_SPEECH_MS ?? 120),
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  return configPath;
}

export async function startVoiceRuntime(
  options: VoiceRuntimeOptions,
): Promise<VoiceRuntimeHandle> {
  const dataDir = path.join(options.userDataRoot, 'voice');
  mkdirSync(dataDir, { recursive: true });

  if (process.env.HEREIN_AUTO_VOICE === '0') {
    log(options, 'auto voice disabled');
    return {
      configPath: null,
      ttsUrl: `http://127.0.0.1:${Number(process.env.HEREIN_TTS_PORT ?? 9881) || 9881}`,
      stop: async () => undefined,
    };
  }

  const configPath = buildVoiceWorkerConfig(options, dataDir);
  const ttsServiceEnabled = process.env.HEREIN_TTS_SERVICE !== '0';
  const tts = ttsServiceEnabled
    ? await startTts(options)
    : {
      process: {} as ManagedProcess,
      url: `http://127.0.0.1:${Number(process.env.HEREIN_TTS_PORT ?? 9881) || 9881}`,
    };

  return {
    configPath,
    ttsUrl: tts.url,
    stop: async () => {
      if (tts.process.pid) {
        await killPid(tts.process.pid);
      } else if (tts.process.child) {
        await killTree(tts.process.child);
      }
    },
  };
}
