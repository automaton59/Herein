import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { APP_USER_DATA_DIR_NAME } from '../appIdentity';
import { openPhase2Database, type Phase2Database } from '../data/database';
import { migratePhase1JsonData } from '../data/migratePhase1';
import {
  createPhase2Repositories,
  type MessageRecord,
} from '../data/repositories';
import { buildCoreChatPrompt } from './chatContext';
import { CoreEventBus, type CoreEvent } from './eventBus';
import {
  chatCompletion,
  loadLlmConfig,
  type LlmCompletion,
  type LlmConfig,
  type LlmMessage,
} from './llm';
import { buildCoreStatus } from './status';
import { CoreMemoryRunner } from './memory';
import { InitiativeEngine, InitiativeScheduler, type InitiativePolicy } from './initiative';
import { PluginRegistry } from '../plugins/registry';
import { PluginError } from '../plugins/types';
import { AgentProviderRegistry, type AgentProvider } from '../plugins/agentProvider';
import {
  scanBilibiliFeed,
  type BilibiliFeedSource,
} from '../services/bilibiliActivity';
import {
  recommendContent,
  type RecommendationGate,
} from '../services/contentRecommender';
import {
  getNeteaseCandidates,
  type NeteaseCandidateSource,
} from '../services/neteaseCandidates';
import { ProactiveShareScheduler } from '../services/proactiveShare';
import { ntfyConfigFromEnv, publishNtfy, publishNtfyMessage } from '../services/ntfy';
import { BILIBILI_MANIFEST, createBilibiliPlugin } from '../plugins/builtin/bilibili';
import { NETEASE_MANIFEST, createNeteasePlugin } from '../plugins/builtin/netease';
import { QQ_MANIFEST, createQQPlugin } from '../plugins/builtin/qq';

export const CORE_SERVER_VERSION = '0.1.0';
export const DEFAULT_CORE_HOST = '127.0.0.1';
export const DEFAULT_CORE_PORT = 8787;

export interface CoreServerOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  dbPath?: string;
  assetsDir?: string;
  pluginsDir?: string;
  pluginFetch?: typeof fetch;
  token?: string;
  ttsUrl?: string;
  ttsFetch?: typeof fetch;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  llmFetch?: typeof fetch;
  bilibiliSource?: BilibiliFeedSource;
  neteaseSource?: NeteaseCandidateSource;
  contentPromptPath?: string;
  proactiveShare?: {
    enabled: boolean;
    intervalMs?: number;
  };
  qqListener?: {
    enabled: boolean;
    configPath?: string;
    autoReply?: boolean;
  };
  memory?: {
    enabled?: boolean;
    triggerMessageCount?: number;
  };
  initiative?: Partial<InitiativePolicy>;
  initiativeAuto?: {
    enabled: boolean;
    intervalMs?: number;
  };
  agentProviders?: AgentProvider[];
}

export interface CoreServerHandle {
  server: Server;
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  assetsDir: string;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function defaultDataDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_USER_DATA_DIR_NAME, 'data');
  }

  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', APP_USER_DATA_DIR_NAME, 'data');
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configHome, APP_USER_DATA_DIR_NAME, 'data');
}

function isLoopback(host: string) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function setCors(response: ServerResponse) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,authorization');
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.moc': 'application/octet-stream',
    '.moc3': 'application/octet-stream',
    '.mtn': 'application/octet-stream',
  };

  return types[extension] ?? 'application/octet-stream';
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;

    if (total > MAX_BODY_BYTES) {
      throw new Error('request body is too large');
    }

    chunks.push(buffer);
  }

  if (total === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function ensureDefaultCharacter(repos: ReturnType<typeof createPhase2Repositories>) {
  if (repos.characters.list().length > 0) {
    return;
  }

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

function stringParam(url: URL, name: string) {
  const value = url.searchParams.get(name);
  return value && value.trim() ? value : undefined;
}

function numberParam(url: URL, name: string, fallback: number) {
  const value = Number.parseInt(url.searchParams.get(name) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }

  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value;
}

function requireRole(record: Record<string, unknown>) {
  const role = requireString(record, 'role');

  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    throw new Error('role must be system, user or assistant');
  }

  return role;
}



export async function startCoreServer(options: CoreServerOptions = {}): Promise<CoreServerHandle> {
  const host = options.host ?? process.env.HEREIN_CORE_HOST ?? DEFAULT_CORE_HOST;
  const port = options.port ?? (Number.parseInt(process.env.HEREIN_CORE_PORT ?? '', 10) || DEFAULT_CORE_PORT);
  const token = options.token ?? process.env.HEREIN_CORE_TOKEN ?? '';
  const dataDir = path.resolve(options.dataDir ?? process.env.HEREIN_DATA_DIR ?? defaultDataDir());
  const dbPath = path.resolve(options.dbPath ?? path.join(dataDir, 'app.db'));
  const assetsDir = path.resolve(
    options.assetsDir ?? process.env.HEREIN_ASSETS_DIR ?? path.join(dataDir, 'assets'),
  );
  const ttsUrl = (options.ttsUrl ?? process.env.HEREIN_TTS_URL ?? 'http://127.0.0.1:9881').replace(/\/+$/, '');
  const ttsFetch = options.ttsFetch ?? fetch;

  if (!isLoopback(host) && !token) {
    throw new Error('HEREIN_CORE_TOKEN is required when the Core server binds to a non-loopback host');
  }

  await mkdir(dataDir, { recursive: true });

  const startedAt = Date.now();
  const ntfyConfig = ntfyConfigFromEnv();
  const db: Phase2Database = openPhase2Database(dbPath);
  migratePhase1JsonData({ db, dataDir });
  const repos = createPhase2Repositories(db);
  ensureDefaultCharacter(repos);

  const pluginsDir = path.resolve(
    options.pluginsDir ?? process.env.HEREIN_PLUGINS_DIR ?? path.join(process.cwd(), 'plugins'),
  );
  const pluginRegistry = new PluginRegistry({
    db,
    pluginsDir,
    fetchImpl: options.pluginFetch,
  });
  pluginRegistry.registerBuiltin(BILIBILI_MANIFEST, () => createBilibiliPlugin({
    repos,
    source: options.bilibiliSource,
  }));
  pluginRegistry.registerBuiltin(NETEASE_MANIFEST, () => createNeteasePlugin({
    source: options.neteaseSource,
  }));
  pluginRegistry.registerBuiltin(QQ_MANIFEST, () => createQQPlugin({
    repos,
    llmConfig: options.llmConfig,
    llmConfigPath: options.llmConfigPath,
    fetchImpl: options.llmFetch,
    configPath: options.qqListener?.configPath,
    autoReply: options.qqListener?.autoReply,
  }));
  await pluginRegistry.initialize();

  const agentProviderRegistry = new AgentProviderRegistry();

  for (const provider of options.agentProviders ?? []) {
    agentProviderRegistry.register(provider);
  }

  const qqEnabled = options.qqListener?.enabled ?? process.env.HEREIN_QQ_ENABLED === '1';

  if (qqEnabled) {
    try {
      await pluginRegistry.install('qq');
      await pluginRegistry.updateConfig('qq', {
        ...(options.qqListener?.configPath ? { configPath: options.qqListener.configPath } : {}),
        autoReply: options.qqListener?.autoReply ?? process.env.HEREIN_QQ_AUTO_REPLY === '1',
      });
      const qq = pluginRegistry.get('qq');

      if (!qq?.enabled) {
        await pluginRegistry.enable('qq');
      }
    } catch (error) {
      console.warn(`QQ plugin was not started: ${error instanceof Error ? error.message : error}`);
    }
  }

  const events = new CoreEventBus();
  const sseClients = new Set<ServerResponse>();

  const memoryRunner = new CoreMemoryRunner({
    repos,
    llmConfig: options.llmConfig,
    llmConfigPath: options.llmConfigPath,
    fetchImpl: options.llmFetch,
    enabled: options.memory?.enabled,
    triggerMessageCount: options.memory?.triggerMessageCount,
  });

  const initiative = new InitiativeEngine({
    repos,
    events,
    llmConfig: options.llmConfig,
    llmConfigPath: options.llmConfigPath,
    fetchImpl: options.llmFetch,
    policy: options.initiative,
    notify: ntfyConfig
      ? message => publishNtfyMessage(ntfyConfig, {
        title: '蓝蓝',
        message,
        tags: ['speech_balloon'],
      }).then(() => undefined)
      : undefined,
  });

  const initiativeAutoEnabled = options.initiativeAuto?.enabled
    ?? process.env.HEREIN_INITIATIVE_AUTO === '1';
  const initiativeScheduler = initiativeAutoEnabled
    ? new InitiativeScheduler({
      engine: initiative,
      getCharacterId: () => repos.settings.get<string>('activeCharacterId')
        ?? repos.characters.list()[0]?.id
        ?? null,
      intervalMs: options.initiativeAuto?.intervalMs
        ?? (Number.parseInt(process.env.HEREIN_INITIATIVE_INTERVAL_MS ?? '', 10) || 30 * 60 * 1000),
    })
    : null;
  initiativeScheduler?.start();

  let proactiveScheduler: ProactiveShareScheduler | null = null;

  const authorized = (request: IncomingMessage, url: URL) => {
    if (!token) {
      return true;
    }

    if (request.headers.authorization === `Bearer ${token}`) {
      return true;
    }

    // EventSource cannot set an Authorization header. The token is accepted in
    // the query string only for the SSE endpoint.
    return url.pathname === '/v1/events' && url.searchParams.get('token') === token;
  };

  const server = createServer((request, response) => {
    setCors(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean);

    // Live2D models and textures are loaded by the browser without custom
    // headers, so this route is intentionally public. Do not put credentials
    // here; use the data directory for secrets.
    if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
      void (async () => {
        try {
          const relative = decodeURIComponent(url.pathname.slice('/assets/'.length));
          const target = path.resolve(assetsDir, relative);

          if (target !== assetsDir && !target.startsWith(`${assetsDir}${path.sep}`)) {
            sendJson(response, 403, { error: 'invalid asset path' });
            return;
          }

          const data = await readFile(target);
          response.writeHead(200, {
            'content-type': contentTypeFor(target),
            'content-length': data.byteLength,
            'cache-control': 'no-cache',
          });
          response.end(data);
        } catch {
          sendJson(response, 404, { error: 'asset not found' });
        }
      })();
      return;
    }

    if (!authorized(request, url)) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    void (async () => {
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          name: 'herein-core',
          version: CORE_SERVER_VERSION,
          host,
          port,
          dataDir,
          dbPath,
          assetsDir,
          characters: repos.characters.list().length,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/characters') {
        sendJson(response, 200, { characters: repos.characters.list() });
        return;
      }

      if (segments[0] === 'v1' && segments[1] === 'read-state' && segments[2]) {
        const characterId = decodeURIComponent(segments[2]);
        const character = repos.characters.get(characterId);

        if (!character) {
          sendJson(response, 404, { error: `character not found: ${characterId}` });
          return;
        }

        if (request.method === 'GET') {
          sendJson(response, 200, {
            readState: repos.readState.get(characterId) ?? {
              characterId,
              lastReadMessageId: null,
              lastReadAt: null,
              updatedAt: null,
            },
          });
          return;
        }

        if (request.method === 'POST') {
          const body = asRecord(await readJson(request));
          const lastReadMessageId = typeof body.lastReadMessageId === 'string'
            ? body.lastReadMessageId
            : null;
          const readState = {
            characterId,
            lastReadMessageId,
            lastReadAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          repos.readState.upsert(readState);
          sendJson(response, 200, {
            readState: repos.readState.get(characterId) ?? readState,
          });
          return;
        }

        sendJson(response, 405, { error: 'method not allowed' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/chat') {
        const body = asRecord(await readJson(request));
        const characterId = requireString(body, 'characterId');
        const character = repos.characters.get(characterId);

        if (!character) {
          sendJson(response, 404, { error: `character not found: ${characterId}` });
          return;
        }

        const timeline = repos.timelines.getPrimaryForCharacter(characterId)
          ?? repos.timelines.ensurePrimaryForCharacter(characterId, character.name);
        const clientMessageId = typeof body.clientMessageId === 'string' && body.clientMessageId.trim()
          ? body.clientMessageId.trim().slice(0, 200)
          : null;
        const idempotencyKey = clientMessageId ? `chat:${characterId}:${clientMessageId}` : null;

        if (idempotencyKey) {
          const cached = repos.chatIdempotency.get(idempotencyKey);

          if (cached) {
            sendJson(response, 200, cached);
            return;
          }
        }

        const rawMessages = Array.isArray(body.messages) ? body.messages : [];
        const llmMessages: LlmMessage[] = rawMessages.map(item => {
          const message = asRecord(item);
          return {
            role: requireRole(message),
            content: requireString(message, 'content'),
          };
        });

        if (!llmMessages.some(message => message.role === 'user')) {
          throw new Error('messages must include at least one user message');
        }

        const systemPrompt = typeof body.system === 'string' && body.system.trim()
          ? body.system
          : buildCoreChatPrompt({
            repos,
            character,
            timeline,
            audience: body.audience === 'group' ? 'group' : 'private',
          });

        let config = options.llmConfig;
        if (!config) {
          try {
            config = await loadLlmConfig(options.llmConfigPath);
          } catch (error) {
            sendJson(response, 503, {
              error: 'LLM is not configured',
              detail: error instanceof Error ? error.message : 'missing llm config',
            });
            return;
          }
        }

        let completion: LlmCompletion;
        try {
          completion = await chatCompletion(config, [
            { role: 'system', content: systemPrompt },
            ...llmMessages,
          ], {
            temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
            maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
            fetchImpl: options.llmFetch,
          });
        } catch (error) {
          sendJson(response, 502, {
            error: 'LLM request failed',
            detail: error instanceof Error ? error.message : 'unknown error',
          });
          return;
        }

        const persist = body.persist !== false;

        if (persist) {
          const lastUser = [...llmMessages].reverse().find(message => message.role === 'user');
          const timestamp = new Date().toISOString();

          if (lastUser) {
            repos.messages.append({
              id: randomUUID(),
              timelineId: timeline.id,
              role: 'user',
              content: lastUser.content,
              timestamp,
              status: 'sent',
            });
          }

          repos.messages.append({
            id: randomUUID(),
            timelineId: timeline.id,
            role: 'assistant',
            content: completion.content,
            timestamp: new Date(Date.now() + 1).toISOString(),
            status: 'sent',
          });
          events.publish('chat.completed', {
            characterId,
            timelineId: timeline.id,
            model: completion.model,
          });
          void memoryRunner.run({
            characterId,
            timelineId: timeline.id,
          });
        }

        const chatResponse = {
          message: {
            role: 'assistant',
            content: completion.content,
          },
          model: completion.model,
          usage: completion.usage,
          latencyMs: completion.latencyMs,
          persisted: persist,
          timelineId: timeline.id,
        };

        if (idempotencyKey) {
          repos.chatIdempotency.put(idempotencyKey, chatResponse);
        }

        sendJson(response, 200, chatResponse);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/tts') {
        const body = asRecord(await readJson(request));
        const text = requireString(body, 'text').slice(0, 500);
        const emotion = typeof body.emotion === 'string' ? body.emotion : 'neutral';
        const speaker = typeof body.speaker === 'string' ? body.speaker : undefined;

        try {
          const upstream = await ttsFetch(`${ttsUrl}/tts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text,
              emotion,
              speaker,
              language: 'Chinese',
            }),
          });

          if (!upstream.ok) {
            const detail = await upstream.text();
            sendJson(response, 502, {
              error: 'TTS request failed',
              detail: detail.slice(0, 300),
            });
            return;
          }

          const audio = Buffer.from(await upstream.arrayBuffer());
          response.writeHead(200, {
            'content-type': upstream.headers.get('content-type') ?? 'audio/wav',
            'content-length': audio.byteLength,
            'cache-control': 'no-store',
          });
          response.end(audio);
        } catch (error) {
          sendJson(response, 502, {
            error: 'TTS unavailable',
            detail: error instanceof Error ? error.message : 'unknown error',
          });
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/recommend') {
        const body = asRecord(await readJson(request));
        const context = requireString(body, 'context');
        const candidates = Array.isArray(body.candidates) ? body.candidates : [];

        let config = options.llmConfig;
        if (!config) {
          try {
            config = await loadLlmConfig(options.llmConfigPath);
          } catch (error) {
            sendJson(response, 503, {
              error: 'LLM is not configured',
              detail: error instanceof Error ? error.message : 'missing llm config',
            });
            return;
          }
        }

        const now = new Date();
        let gate: RecommendationGate;

        if (typeof body.gate === 'object' && body.gate !== null && !Array.isArray(body.gate)) {
          const raw = body.gate as Record<string, unknown>;
          gate = {
            ...(raw as unknown as RecommendationGate),
            now: typeof raw.now === 'string' ? new Date(raw.now) : now,
            itemId: typeof raw.itemId === 'string' ? raw.itemId : '',
          };
        } else {
          const first = candidates[0] as { itemId?: unknown } | undefined;
          gate = {
            now,
            itemId: typeof first?.itemId === 'string' ? first.itemId : '',
            lastRecommendedAt: repos.recommendationEvents.lastRecommendedAt(),
            recentItemIds: repos.recommendationEvents.recentItemIds(
              new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            ),
            turnsSinceLast: 99,
          };
        }

        const feedbackEvents = repos.recommendationEvents.recent(30);
        const defaultTaste = {
          likedItemIds: feedbackEvents.filter(event => event.feedback === 'like').map(event => event.itemId),
          skippedItemIds: feedbackEvents.filter(event => event.feedback === 'skip').map(event => event.itemId),
          recentItemIds: feedbackEvents.map(event => event.itemId),
        };

        try {
          const result = await recommendContent({
            llmConfig: config,
            context,
            candidates,
            taste: body.taste ?? defaultTaste,
            characterName: typeof body.characterName === 'string' ? body.characterName : undefined,
            gate,
            promptPath: options.contentPromptPath,
            fetchImpl: options.llmFetch,
          });

          if (result.decision.shouldRecommend && result.decision.itemId && result.decision.type) {
            repos.recommendationEvents.record({
              id: randomUUID(),
              itemId: result.decision.itemId,
              itemType: result.decision.type,
              recommendedAt: now.toISOString(),
            });
          }

          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 502, {
            error: 'recommendation failed',
            detail: error instanceof Error ? error.message : 'unknown error',
          });
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/recommend/feedback') {
        const body = asRecord(await readJson(request));
        const itemId = requireString(body, 'itemId');
        const feedback = requireString(body, 'feedback');

        if (feedback !== 'like' && feedback !== 'skip') {
          throw new Error('feedback must be like or skip');
        }

        const updated = repos.recommendationEvents.feedback(itemId, feedback);
        sendJson(response, updated ? 200 : 404, { updated });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/recommendations') {
        sendJson(response, 200, {
          events: repos.recommendationEvents.recent(numberParam(url, 'limit', 20)),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/netease/candidates') {
        const body = asRecord(await readJson(request));
        const query = typeof body.query === 'string' ? body.query : undefined;
        const limit = typeof body.limit === 'number' ? body.limit : 10;

        try {
          const plugin = pluginRegistry.get('netease');

          if (plugin?.enabled) {
            const result = await pluginRegistry.invoke('netease', 'candidates', { query, limit });
            sendJson(response, 200, result);
            return;
          }

          const candidates = await getNeteaseCandidates({
            query,
            limit,
            source: options.neteaseSource,
          });
          sendJson(response, 200, { candidates });
        } catch (error) {
          sendJson(response, 503, {
            error: 'Netease candidates failed',
            detail: error instanceof Error ? error.message : 'run npm run build:netease',
          });
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/bilibili/scan') {
        const body = asRecord(await readJson(request));
        const limit = typeof body.limit === 'number' ? body.limit : 20;

        try {
          const plugin = pluginRegistry.get('bilibili');

          if (plugin?.enabled) {
            const result = await pluginRegistry.invoke('bilibili', 'scan', { limit });
            sendJson(response, 200, result);
            return;
          }

          let source = options.bilibiliSource;

          if (!source) {
            const adapter = await import('../../adapters/bilibili/dist/index.js' as string) as {
              BilibiliClient: new (options?: { minIntervalMs?: number }) => BilibiliFeedSource;
            };
            source = new adapter.BilibiliClient({ minIntervalMs: 1200 });
          }

          const result = await scanBilibiliFeed({
            repos,
            source,
            limit,
            now: () => new Date(),
          });
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 503, {
            error: 'Bilibili scan failed',
            detail: error instanceof Error ? error.message : 'run npm run build:bilibili',
          });
        }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/activity') {
        sendJson(response, 200, {
          sessions: repos.activitySessions.listRecent(numberParam(url, 'limit', 20)),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/initiative/run') {
        const body = asRecord(await readJson(request));
        const requested = typeof body.characterId === 'string' && body.characterId.trim()
          ? body.characterId.trim()
          : null;
        const fallback = repos.settings.get<string>('activeCharacterId')
          ?? repos.characters.list()[0]?.id
          ?? null;
        const characterId = requested ?? fallback;

        if (!characterId) {
          sendJson(response, 404, { error: 'no character available' });
          return;
        }

        const result = await initiative.run({ characterId });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/proactive/share/run') {
        if (!proactiveScheduler) {
          sendJson(response, 503, {
            error: 'proactive sharing is disabled',
            detail: 'set HEREIN_PROACTIVE_SHARE=1 and configure the LLM',
          });
          return;
        }

        try {
          const result = await proactiveScheduler.tick();
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 502, {
            error: 'proactive share failed',
            detail: error instanceof Error ? error.message : 'unknown error',
          });
        }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const status = await buildCoreStatus({
          db,
          pluginRegistry,
          agentRegistry: agentProviderRegistry,
          startedAt,
          version: CORE_SERVER_VERSION,
          ttsUrl,
          ttsFetch,
          llmConfig: options.llmConfig,
          llmConfigPath: options.llmConfigPath,
        });
        sendJson(response, 200, status);
        return;
      }

      if (segments[0] === 'v1' && segments[1] === 'agents') {
        try {
          if (request.method === 'GET' && segments.length === 2) {
            sendJson(response, 200, await agentProviderRegistry.list());
            return;
          }

          const providerId = segments[2] ? decodeURIComponent(segments[2]) : '';
          const capabilityId = segments[3] ? decodeURIComponent(segments[3]) : '';

          if (!providerId) {
            sendJson(response, 404, { error: 'agent provider not found' });
            return;
          }

          if (request.method === 'GET' && capabilityId === 'health' && segments.length === 4) {
            sendJson(response, 200, { health: await agentProviderRegistry.health(providerId) });
            return;
          }

          if (request.method === 'POST' && capabilityId && segments[4]) {
            const action = segments[4];

            if (action === 'install') {
              sendJson(response, 200, await agentProviderRegistry.install(providerId, capabilityId));
              return;
            }

            if (action === 'enable') {
              sendJson(response, 200, await agentProviderRegistry.enable(providerId, capabilityId));
              return;
            }

            if (action === 'disable') {
              sendJson(response, 200, await agentProviderRegistry.disable(providerId, capabilityId));
              return;
            }

            if (action === 'remove') {
              sendJson(response, 200, await agentProviderRegistry.remove(providerId, capabilityId));
              return;
            }

            if (action === 'rollback') {
              sendJson(response, 200, await agentProviderRegistry.rollback(providerId, capabilityId));
              return;
            }

            if (action === 'invoke') {
              const body = asRecord(await readJson(request));
              const invokeAction = requireString(body, 'action');
              const result = await agentProviderRegistry.invoke(
                providerId,
                capabilityId,
                invokeAction,
                body.input,
              );
              sendJson(response, 200, { result });
              return;
            }
          }

          sendJson(response, 405, { error: 'method not allowed' });
          return;
        } catch (error) {
          if (error instanceof PluginError) {
            sendJson(response, error.status, {
              error: error.code,
              detail: error.message,
            });
            return;
          }

          throw error;
        }
      }

      if (segments[0] === 'v1' && segments[1] === 'plugins') {
        try {
          if (request.method === 'GET' && segments.length === 2) {
            sendJson(response, 200, {
              plugins: pluginRegistry.list(),
              summary: pluginRegistry.summary(),
            });
            return;
          }

          if (request.method === 'GET' && segments[2] === 'audit') {
            sendJson(response, 200, {
              audit: pluginRegistry.audit(numberParam(url, 'limit', 100)),
            });
            return;
          }

          if (request.method === 'POST' && segments[2] === 'install') {
            const body = asRecord(await readJson(request));
            const pluginId = requireString(body, 'id');
            const plugin = await pluginRegistry.install(pluginId);
            sendJson(response, 200, { plugin });
            return;
          }

          const pluginId = segments[2] ? decodeURIComponent(segments[2]) : '';

          if (!pluginId) {
            sendJson(response, 404, { error: 'plugin not found' });
            return;
          }

          if (request.method === 'GET' && segments.length === 3) {
            const plugin = pluginRegistry.get(pluginId);

            if (!plugin) {
              sendJson(response, 404, { error: 'plugin not found' });
              return;
            }

            sendJson(response, 200, { plugin });
            return;
          }

          if (request.method === 'DELETE' && segments.length === 3) {
            const result = await pluginRegistry.remove(pluginId);
            sendJson(response, 200, result);
            return;
          }

          if (request.method === 'POST' && segments[3] === 'enable') {
            const plugin = await pluginRegistry.enable(pluginId);
            sendJson(response, 200, { plugin });
            return;
          }

          if (request.method === 'POST' && segments[3] === 'disable') {
            const plugin = await pluginRegistry.disable(pluginId);
            sendJson(response, 200, { plugin });
            return;
          }

          if (request.method === 'POST' && segments[3] === 'invoke') {
            const body = asRecord(await readJson(request));
            const action = requireString(body, 'action');
            const result = await pluginRegistry.invoke(pluginId, action, body.input);
            sendJson(response, 200, { result });
            return;
          }

          if (request.method === 'PATCH' && segments[3] === 'config') {
            const body = asRecord(await readJson(request));
            const plugin = await pluginRegistry.updateConfig(pluginId, body.config);
            sendJson(response, 200, { plugin });
            return;
          }

          sendJson(response, 405, { error: 'method not allowed' });
          return;
        } catch (error) {
          if (error instanceof PluginError) {
            sendJson(response, error.status, {
              error: error.code,
              detail: error.message,
            });
            return;
          }

          throw error;
        }
      }

      if (request.method === 'GET' && url.pathname === '/v1/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        response.write(`event: hello\ndata: ${JSON.stringify({ version: CORE_SERVER_VERSION })}\n\n`);
        sseClients.add(response);
        const unsubscribe = events.subscribe((event: CoreEvent) => {
          response.write(`event: core\ndata: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => {
          response.write(': heartbeat\n\n');
        }, 15000);
        request.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
          sseClients.delete(response);
        });
        return;
      }

      if (segments[0] === 'v1' && segments[1] === 'timeline' && segments[2]) {
        const characterId = decodeURIComponent(segments[2]);
        const character = repos.characters.get(characterId);

        if (!character) {
          sendJson(response, 404, { error: `character not found: ${characterId}` });
          return;
        }

        const timeline = repos.timelines.getPrimaryForCharacter(characterId)
          ?? repos.timelines.ensurePrimaryForCharacter(characterId, character.name);

        if (request.method === 'GET' && segments[3] === 'messages') {
          const limit = numberParam(url, 'limit', 100);
          sendJson(response, 200, {
            timeline,
            messages: repos.messages.listRecent(timeline.id, limit),
          });
          return;
        }

        if (request.method === 'POST' && segments[3] === 'sync') {
          const body = asRecord(await readJson(request));
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const title = typeof body.title === 'string' && body.title.trim() ? body.title : timeline.title;
          // The HTTP caller does not need to know the timeline id; it is owned
          // by the character route. Override it so a stale client cannot write
          // into another timeline.
          const normalized = messages.map(item => ({
            ...(item as MessageRecord),
            timelineId: timeline.id,
          }));
          const result = repos.messages.sync(timeline.id, normalized, title, {
            // Ordinary client snapshots must not prune messages that another
            // device wrote after the sender's last known message. A deliberate
            // delete must send prune:true.
            prune: body.prune === true,
          });
          events.publish('timeline.synced', {
            characterId,
            timelineId: timeline.id,
            result,
          });
          void memoryRunner.run({
            characterId,
            timelineId: timeline.id,
          });
          sendJson(response, 200, { timeline: { ...timeline, title }, result });
          return;
        }

        if (request.method === 'POST' && segments[3] === 'apply') {
          const body = asRecord(await readJson(request));
          const upserts = Array.isArray(body.upserts) ? body.upserts : [];
          const deletes = Array.isArray(body.deletes)
            ? [...new Set(body.deletes.filter((id): id is string => typeof id === 'string'))]
            : [];
          const title = typeof body.title === 'string' && body.title.trim() ? body.title : timeline.title;
          const normalized = upserts.map(item => ({
            ...(item as MessageRecord),
            timelineId: timeline.id,
          }));
          const result = repos.messages.sync(timeline.id, normalized, title, {
            prune: false,
            deleteIds: deletes,
          });
          events.publish('timeline.synced', {
            characterId,
            timelineId: timeline.id,
            result,
            via: 'apply',
          });
          void memoryRunner.run({
            characterId,
            timelineId: timeline.id,
          });
          sendJson(response, 200, { timeline: { ...timeline, title }, result });
          return;
        }

        sendJson(response, 405, { error: 'method not allowed' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memory') {
        const characterId = stringParam(url, 'characterId');
        const timelineId = stringParam(url, 'timelineId');
        const query = stringParam(url, 'q');
        const limit = numberParam(url, 'limit', 50);
        const memories = query
          ? repos.memories.search(query, { characterId, timelineId, limit })
          : repos.memories.listActive({ characterId, timelineId });
        sendJson(response, 200, { memories });
        return;
      }

      if (url.pathname === '/v1/observations') {
        if (request.method === 'GET') {
          sendJson(response, 200, {
            observations: repos.observations.listRecent({
              platform: stringParam(url, 'platform'),
              conversationId: stringParam(url, 'conversationId'),
              limit: numberParam(url, 'limit', 100),
            }),
          });
          return;
        }

        if (request.method === 'POST') {
          const body = asRecord(await readJson(request));
          const observation = {
            id: requireString(body, 'id'),
            platform: requireString(body, 'platform'),
            accountId: typeof body.accountId === 'string' ? body.accountId : null,
            conversationId: requireString(body, 'conversationId'),
            conversationKind: requireString(body, 'conversationKind') as 'dm' | 'group' | 'public',
            actorId: typeof body.actorId === 'string' ? body.actorId : null,
            actorName: typeof body.actorName === 'string' ? body.actorName : null,
            isSelf: Boolean(body.isSelf),
            isBot: Boolean(body.isBot),
            kind: requireString(body, 'kind'),
            content: typeof body.content === 'string' ? body.content : null,
            occurredAt: requireString(body, 'occurredAt'),
            receivedAt: requireString(body, 'receivedAt'),
            provenance: requireString(body, 'provenance') as 'owner' | 'agent' | 'untrusted' | 'system',
            audience: requireString(body, 'audience') as 'private' | 'group' | 'public',
            trust: typeof body.trust === 'number' ? body.trust : 0.5,
            dedupeKey: typeof body.dedupeKey === 'string' ? body.dedupeKey : null,
          };
          const inserted = repos.observations.insert(observation);
          events.publish('observation.created', { id: observation.id, inserted });
          sendJson(response, inserted ? 201 : 200, { inserted });
          return;
        }
      }

      if (request.method === 'GET' && url.pathname === '/v1/experiences') {
        sendJson(response, 200, {
          experiences: repos.experiences.listRecent(numberParam(url, 'limit', 20)),
        });
        return;
      }

      if (url.pathname === '/v1/sync/ops') {
        if (request.method === 'GET') {
          const deviceId = stringParam(url, 'deviceId') ?? '';
          const since = stringParam(url, 'since') ?? '1970-01-01T00:00:00.000Z';
          sendJson(response, 200, {
            ops: repos.syncOps.listSince(deviceId, since, numberParam(url, 'limit', 500)),
          });
          return;
        }

        if (request.method === 'POST') {
          const body = asRecord(await readJson(request));
          repos.syncOps.append({
            id: requireString(body, 'id'),
            deviceId: requireString(body, 'deviceId'),
            hlc: requireString(body, 'hlc'),
            entity: requireString(body, 'entity'),
            entityId: requireString(body, 'entityId'),
            op: requireString(body, 'op'),
            payload: body.payload,
          });
          events.publish('sync.op', { id: body.id });
          sendJson(response, 201, { ok: true });
          return;
        }
      }

      sendJson(response, 404, { error: 'not found' });
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }

      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'request failed',
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const proactiveEnabled = options.proactiveShare?.enabled
    ?? process.env.HEREIN_PROACTIVE_SHARE === '1';

  if (proactiveEnabled) {
    let config = options.llmConfig;

    if (!config) {
      try {
        config = await loadLlmConfig(options.llmConfigPath);
      } catch {
        config = undefined;
      }
    }

    if (config) {
      const envInterval = Number.parseInt(process.env.HEREIN_PROACTIVE_INTERVAL_MS ?? '', 10);
      const ntfy = ntfyConfig;
      proactiveScheduler = new ProactiveShareScheduler({
        repos,
        llmConfig: config,
        source: options.neteaseSource,
        promptPath: options.contentPromptPath,
        fetchImpl: options.llmFetch,
        intervalMs: options.proactiveShare?.intervalMs
          ?? (Number.isFinite(envInterval) && envInterval > 0 ? envInterval : 90 * 60 * 1000),
        publish: song => events.publish('song.shared', song),
        notify: ntfy
          ? song => publishNtfy(ntfy, song).then(() => undefined)
          : undefined,
      });
      proactiveScheduler.start();
    }
  }

  return {
    server,
    host,
    port: actualPort,
    dataDir,
    dbPath,
    assetsDir,
    close: async () => {
      proactiveScheduler?.stop();
      initiativeScheduler?.stop();
      await memoryRunner.close();
      await pluginRegistry.close();
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      server.closeAllConnections?.();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    },
  };
}

async function main() {
  const handle = await startCoreServer();
  console.log(`herein-core listening on http://${handle.host}:${handle.port}`);
  console.log(`data: ${handle.dataDir}`);

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
