import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { LlmConfig } from './core/llm';

export interface LocalLlmOptions {
  rootDir: string;
  userDataRoot: string;
  logger?: (message: string) => void;
}

export interface LocalLlmHandle {
  configPath: string;
  config: LlmConfig;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Search order is intentionally machine-independent: an explicit env override
 * wins, then a few conventional locations relative to the app root. Nothing here
 * may reference a developer's home directory or tool install path.
 */
function resolveBinary(rootDir: string) {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  return firstExisting([
    process.env.HEREIN_LLAMA_SERVER,
    path.join(rootDir, 'tmp', 'llama-vulkan', exe),
    path.join(rootDir, 'tmp', 'llama.cpp', exe),
    path.join(rootDir, 'tools', 'llama.cpp', exe),
  ]);
}

function log(options: LocalLlmOptions, message: string) {
  options.logger?.(`[local-llm] ${message}`);
}

function firstExisting(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value && existsSync(value)) {
      return value;
    }
  }

  return null;
}

const MODEL_CANDIDATES = [
  'Qwen3.5-4B-Q4_K_M.gguf',
  'Qwen3.5-4B-UD-Q4_K_XL.gguf',
  'Qwen3.5-4B-Q4_K_XL.gguf',
];

function resolveModel(rootDir: string) {
  return firstExisting([
    process.env.HEREIN_VOICE_LLM_MODEL,
    ...MODEL_CANDIDATES.map(name => path.join(rootDir, 'tmp', 'models', name)),
  ]);
}

function portOpen(port: number) {
  return new Promise<boolean>(resolve => {
    const client = net.connect({ host: '127.0.0.1', port });
    const done = (value: boolean) => {
      client.destroy();
      resolve(value);
    };

    client.setTimeout(500);
    client.once('connect', () => done(true));
    client.once('timeout', () => done(false));
    client.once('error', () => done(false));
  });
}

async function waitForHealth(port: number, child: ChildProcess | null, timeoutMs: number) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (child && child.exitCode !== null) {
      return false;
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Still loading.
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return false;
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>(resolve => {
    if (process.platform !== 'win32') {
      child.kill('SIGTERM');
      resolve();
      return;
    }

    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}

/**
 * Starts the voice-only local LLM. This is deliberately separate from the Core
 * text model: text chat and proactive messages keep using llm.json.
 */
export async function startLocalLlm(options: LocalLlmOptions): Promise<LocalLlmHandle | null> {
  if (process.env.HEREIN_VOICE_LLM === 'api') {
    log(options, 'voice local LLM disabled by HEREIN_VOICE_LLM=api');
    return null;
  }

  const binary = resolveBinary(options.rootDir);
  const model = resolveModel(options.rootDir);

  if (!binary || !model) {
    log(options, `voice local LLM unavailable (binary=${binary ?? 'missing'} model=${model ?? 'missing'})`);
    return null;
  }

  const port = Number(process.env.HEREIN_VOICE_LLM_PORT ?? 8080) || 8080;
  const url = `http://127.0.0.1:${port}`;
  const dataDir = path.join(options.userDataRoot, 'voice');
  mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(dataDir, 'voice-llm.json');
  const config: LlmConfig = {
    baseUrl: `${url}/v1`,
    apiKey: 'local',
    model: process.env.HEREIN_VOICE_LLM_NAME ?? 'qwen3.5-4b',
    maxTokens: Number(process.env.HEREIN_VOICE_LLM_MAX_TOKENS ?? 192) || 192,
    temperature: 0.7,
    chatTemplateKwargs: { enable_thinking: false },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  if (await portOpen(port)) {
    log(options, `adopting local LLM on ${url}`);
    return {
      configPath,
      config,
      url,
      stop: async () => undefined,
    };
  }

  const logDir = path.join(options.rootDir, 'tmp');
  mkdirSync(logDir, { recursive: true });
  const out = openSync(path.join(logDir, 'herein-llama.out.log'), 'a');
  const err = openSync(path.join(logDir, 'herein-llama.err.log'), 'a');
  const args = [
    '-m', model,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--ctx-size', process.env.HEREIN_VOICE_LLM_CTX ?? '4096',
    '--n-gpu-layers', process.env.HEREIN_VOICE_LLM_GPU_LAYERS ?? '99',
    '--no-webui',
  ];

  log(options, `starting ${binary} model=${path.basename(model)} port=${port}`);
  const child = spawn(binary, args, {
    cwd: options.rootDir,
    windowsHide: true,
    stdio: ['ignore', out, err],
  });

  const ready = await waitForHealth(port, child, Number(process.env.HEREIN_VOICE_LLM_START_TIMEOUT ?? 90_000) || 90_000);

  if (!ready) {
    log(options, 'local LLM did not become ready; stopping it');
    await killTree(child);
    return null;
  }

  writeFileSync(path.join(logDir, 'herein-llama.pid'), String(child.pid ?? ''), 'utf8');
  return {
    configPath,
    config,
    url,
    stop: async () => killTree(child),
  };
}
