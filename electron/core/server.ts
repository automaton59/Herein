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
  type JsonValue,
  type MessageMaterial,
  type MessageRecord,
  type MessageSticker,
} from '../data/repositories';
import { buildCoreChatPrompt } from './chatContext';
import { parseAssistantMetadata } from './assistantMeta';
import { CoreEventBus, type CoreEvent } from './eventBus';
import {
  chatCompletion,
  loadLlmConfig,
  type LlmCompletion,
  type LlmConfig,
  type LlmMessage,
} from './llm';
import { buildCoreStatus } from './status';
import { createMemoryStore } from '../data/memoryStore';
import { MemoryRunner, recallMemory, extractExperiences } from '../memory';
import {
  compilePersona,
  loadPersonaPack,
  loadPersonaPacks,
  resolvePersonaRoot,
  seedPersonaPacks,
  syncPersonaCharacter,
  type PersonaPack,
} from '../persona';
import {
  PERSONA_EDIT_KEY,
  PERSONA_FINGERPRINT_KEY,
  applyPersonaEdit,
  fingerprintPack,
  syncPersonaIfChanged,
  validatePersonaEditInput,
  type PersonaEditState,
} from '../persona/editState';
import { applyLocalContent, loadLocalContent } from '../localContent';
import { InitiativeEngine, InitiativeScheduler, type InitiativePolicy } from './initiative';
import {
  MaterialService,
  materialShortId,
  pickMaterialForReply,
  type MaterialItem,
} from './materials';
import { parseAssistantReply } from './replyStyle';
import { directTurn, type TurnDecision } from './turnDirector';
import { affectPrompt, computeAffect } from './affect';
import { extractOpenLoops } from './openLoops';
import { InteractionDispatcher, HttpInteractionPort, AInteractionPort } from './interaction';
import type { InteractionPort } from './interaction';
import { AInteractionSession } from './aInteractionSession';
import { VoiceConversation } from './voiceConversation';
import { PluginRegistry } from '../plugins/registry';
import { PluginError } from '../plugins/types';
import { createStickerPicker } from './stickers';
import { createPluginEventSink, type PluginChannelMessage } from './pluginEvents';
import { createQQReply } from '../services/qqResponder';
import {
  recommendContent,
  type RecommendationGate,
} from '../services/contentRecommender';
import { ProactiveShareScheduler } from '../services/proactiveShare';
import { ntfyConfigFromEnv, publishNtfy, publishNtfyMessage } from '../services/ntfy';

export const CORE_SERVER_VERSION = '0.1.0';
export const DEFAULT_CORE_HOST = '127.0.0.1';
export const DEFAULT_CORE_PORT = 8787;

/**
 * A user message that smells like it is still inside a material conversation
 * (follow-ups, link requests, "one more"). The intent regexes in
 * MaterialService decide when to *refresh* plugins; this decides when to put
 * the latest local material back in front of the character so follow-ups do not
 * degenerate into invented titles.
 */
const MATERIAL_CONTEXT_HINT = /视频|B站|b站|哔哩|bilibili|音乐|歌|链接|地址|推|刷|翻/;

export interface CoreServerOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  dbPath?: string;
  assetsDir?: string;
  assetDirs?: string[];
  pluginsDir?: string;
  pluginFetch?: typeof fetch;
  token?: string;
  ttsUrl?: string;
  ttsFetch?: typeof fetch;
  llmConfig?: LlmConfig;
  llmConfigPath?: string;
  llmFetch?: typeof fetch;
  /**
   * Application root for `ctx.loadModule()`; defaults to the process cwd. In a
   * packaged build pass the app path (asar root) so bundled adapters resolve.
   */
  appRoot?: string;
  /** Test seam: pre-loaded modules served by `ctx.loadModule()`. */
  bundledModules?: Record<string, unknown>;
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
  experienceAuto?: boolean;
  personaPacks?: ReadonlyMap<string, PersonaPack>;
  seedPersonaPacks?: boolean;
  initiative?: Partial<InitiativePolicy>;
  initiativeAuto?: {
    enabled: boolean;
    intervalMs?: number;
  };
  materialsAuto?: {
    enabled?: boolean;
    intervalMs?: number;
  };
  relayUrl?: string;
  relayToken?: string;
  relayFetch?: typeof fetch;
  relayTimeoutMs?: number;
  interaction?: {
    url?: string;
    token?: string;
    endpointFile?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  };
  interactionPort?: InteractionPort;
  voice?: {
    enabled?: boolean;
    characterId?: string;
    llmConfig?: LlmConfig;
    llmConfigPath?: string;
    maxTokens?: number;
  };
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
  const assetDirs = [...new Set(
    (options.assetDirs ?? [
      assetsDir,
      path.join(process.cwd(), 'private', 'assets'),
    ]).map(dir => path.resolve(dir)),
  )];
  const ttsUrl = (options.ttsUrl ?? process.env.HEREIN_TTS_URL ?? 'http://127.0.0.1:9881').replace(/\/+$/, '');
  const ttsFetch = options.ttsFetch ?? fetch;

  if (!isLoopback(host) && !token) {
    throw new Error('HEREIN_CORE_TOKEN is required when the Core server binds to a non-loopback host');
  }

  await mkdir(dataDir, { recursive: true });

  const startedAt = Date.now();
  const ntfyConfig = ntfyConfigFromEnv();
  const interactionUrl = options.interaction?.url ?? process.env.HEREIN_INTERACTION_URL;
  const interactionEndpointFile = options.interaction?.endpointFile
    ?? process.env.HEREIN_INTERACTION_ENDPOINT;
  const interactionPort = options.interactionPort ?? (interactionEndpointFile
    ? new AInteractionPort({
      endpointFile: interactionEndpointFile,
      fetchImpl: options.interaction?.fetchImpl,
      timeoutMs: options.interaction?.timeoutMs,
    })
    : interactionUrl
      ? new HttpInteractionPort({
        url: interactionUrl,
        token: options.interaction?.token
          ?? process.env.HEREIN_INTERACTION_TOKEN
          ?? token,
        fetchImpl: options.interaction?.fetchImpl,
        timeoutMs: options.interaction?.timeoutMs,
      })
      : undefined);
  const interactionConfigured = Boolean(options.interactionPort || interactionEndpointFile || interactionUrl);
  const interactionDispatcher = new InteractionDispatcher(interactionPort);
  const db: Phase2Database = openPhase2Database(dbPath);
  migratePhase1JsonData({ db, dataDir });
  const repos = createPhase2Repositories(db);
  const memoryStore = createMemoryStore(db);
  const personaPacks = options.personaPacks ?? new Map<string, PersonaPack>();
  // Persona packs are owned by the host process (main.ts); mutating this map
  // in place keeps both sides consistent when files change on disk.
  const mutablePacks = personaPacks as Map<string, PersonaPack>;

  if (options.seedPersonaPacks && personaPacks.size > 0) {
    seedPersonaPacks(repos, personaPacks);
    let active = repos.settings.get<string>('activeCharacterId');

    if (!active || !mutablePacks.has(active)) {
      // The stored active character is unknown to the loaded packs (for
      // example another build's persona ran against this data directory).
      // Re-anchor to the bundled persona so chat and editing stay coherent.
      active = [...personaPacks.keys()][0];
      repos.settings.set('activeCharacterId', active);
    }

    const primary = active ? mutablePacks.get(active) : undefined;

    if (primary) {
      const sync = syncPersonaIfChanged(repos, primary);

      if (sync.applied) {
        console.log(`persona sync: ${sync.reason}`);
      }
    }
  }

  ensureDefaultCharacter(repos);

  const activeBasePack = (): PersonaPack | undefined => {
    const active = repos.settings.get<string>('activeCharacterId');

    if (active) {
      const pack = mutablePacks.get(active);

      if (pack) {
        return pack;
      }
    }

    return [...mutablePacks.values()][0];
  };

  const personaEditState = (): PersonaEditState | null =>
    repos.settings.get<PersonaEditState>(PERSONA_EDIT_KEY) ?? null;

  /** Pack with in-app edits applied; what the compiler and engines should see. */
  const effectivePack = (characterId: string): PersonaPack | undefined => {
    const base = mutablePacks.get(characterId);

    if (!base) {
      return undefined;
    }

    const edit = personaEditState();
    return edit ? applyPersonaEdit(base, edit) : base;
  };

  const personaViewState = async () => {
    const base = activeBasePack();

    if (!base) {
      return {
        available: false as const,
        packId: null,
        fileChanged: false,
        hasEdits: false,
      };
    }

    const stored = repos.settings.get<string>(PERSONA_FINGERPRINT_KEY) ?? null;
    const edit = personaEditState();

    let diskFingerprint: string | null = null;

    try {
      diskFingerprint = fingerprintPack(await loadPersonaPack(base.root));
    } catch {
      diskFingerprint = null;
    }

    const fileChanged = diskFingerprint !== null && stored !== null && diskFingerprint !== stored;
    const effective = edit && !fileChanged ? applyPersonaEdit(base, edit) : base;
    const character = effective.character;

    return {
      available: true as const,
      packId: base.manifest.id,
      packVersion: base.manifest.version,
      activeCharacterId: repos.settings.get<string>('activeCharacterId') ?? null,
      fileChanged,
      hasEdits: Boolean(edit),
      character: {
        name: character.name,
        nickname: character.nickname ?? '',
        relationshipFrame: character.relationshipFrame,
        personality: {
          core: character.personality.core,
          values: character.personality.values ?? [],
          boundaries: character.personality.boundaries ?? [],
        },
        speakingStyle: {
          defaultAddress: character.speakingStyle.defaultAddress,
          occasionalAddress: character.speakingStyle.occasionalAddress ?? '',
          examples: character.speakingStyle.examples ?? [],
        },
      },
      templates: [...base.templates.values()].map(({ ref }) => ({
        id: ref.id,
        layer: ref.layer,
        required: Boolean(ref.required),
        edited: Boolean(edit && !fileChanged && edit.templates[ref.id] !== undefined),
        text: (edit && !fileChanged ? edit.templates[ref.id] : undefined)
          ?? base.templates.get(ref.id)?.text
          ?? '',
      })),
    };
  };

  const localContent = await loadLocalContent();

  if (localContent) {
    applyLocalContent(repos, localContent);
  }

  const pluginsDir = path.resolve(
    options.pluginsDir ?? process.env.HEREIN_PLUGINS_DIR ?? path.join(process.cwd(), 'plugins'),
  );
  const privatePluginsDir = path.resolve(
    process.env.HEREIN_PRIVATE_PLUGINS_DIR ?? path.join(process.cwd(), 'private', 'plugins'),
  );
  const pluginRegistry = new PluginRegistry({
    db,
    pluginsDir: [pluginsDir, privatePluginsDir],
    assetsDirs: assetDirs,
    // The resolved dataDir, not options.dataDir: a standalone `core:serve`
    // process gets it from HEREIN_DATA_DIR, and plugins rely on ctx.dataDir.
    dataDir,
    appRoot: options.appRoot ?? process.cwd(),
    ...(options.bundledModules ? { bundledModules: options.bundledModules } : {}),
    fetchImpl: options.pluginFetch,
  });

  // The event sink is where plugin-originated data becomes durable. Plugins
  // report observations and channel messages; the Core owns the database, the
  // persona and the model — replies are generated here, not in the plugin.
  const qqReply = createQQReply({
    repos,
    llmConfig: options.llmConfig,
    llmConfigPath: options.llmConfigPath,
    fetchImpl: options.llmFetch,
  });

  pluginRegistry.setEventSink(createPluginEventSink({
    repos,
    onChannelMessage: (pluginId, message: PluginChannelMessage) => (
      pluginId === 'qq' ? qqReply(message) : Promise.resolve(null)
    ),
    sendReply: async (pluginId, message, reply) => {
      await pluginRegistry.invoke(pluginId, 'send', {
        conversationId: message.conversationId,
        conversationKind: message.conversationKind,
        content: reply,
        msgId: message.msgId,
      });
    },
  }));

  await pluginRegistry.initialize();

  const stickerPicker = createStickerPicker({ plugins: pluginRegistry });

  const materialService = new MaterialService({
    repos,
    plugins: pluginRegistry,
    logger: {
      info: (message, detail) => console.log(message, detail ?? ''),
      warn: (message, detail) => console.warn(message, detail ?? ''),
    },
  });
  const materialsAutoEnabled = options.materialsAuto?.enabled
    ?? process.env.NODE_ENV !== 'test';

  if (materialsAutoEnabled) {
    materialService.startAutoRefresh({
      intervalMs: options.materialsAuto?.intervalMs
        ?? (Number.parseInt(process.env.HEREIN_MATERIAL_INTERVAL_MS ?? '', 10) || 45 * 60 * 1000),
    });
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

  const memoryRunner = new MemoryRunner({
    repos,
    store: memoryStore,
    llmConfig: options.llmConfig,
    llmConfigPath: options.llmConfigPath,
    fetchImpl: options.llmFetch,
    enabled: options.memory?.enabled ?? repos.settings.get<boolean>('memoryEnabled') ?? true,
    triggerMessageCount: options.memory?.triggerMessageCount
      ?? repos.settings.get<number>('summaryTriggerMessageCount')
      ?? 20,
  });

  const triggerExperienceExtraction = () => {
    if (!options.experienceAuto) {
      return;
    }

    const characterId = repos.settings.get<string>('activeCharacterId')
      ?? repos.characters.list()[0]?.id;

    if (!characterId) {
      return;
    }

    void (async () => {
      let config = options.llmConfig;

      if (!config) {
        try {
          config = await loadLlmConfig(options.llmConfigPath);
        } catch {
          return;
        }
      }

      await extractExperiences({
        repos,
        store: memoryStore,
        characterId,
        llmConfig: config,
        fetchImpl: options.llmFetch,
      });
    })().catch(error => {
      console.warn('experience extraction failed:', error);
    });
  };

  const voiceConversation = interactionPort && options.voice?.enabled !== false
    && process.env.HEREIN_VOICE_ENABLED !== '0'
    ? new VoiceConversation({
      repos,
      events,
      memoryRunner,
      dispatcher: interactionDispatcher,
      materials: materialService,
      llmConfig: options.voice?.llmConfig ?? options.llmConfig,
      llmConfigPath: options.voice?.llmConfigPath ?? options.llmConfigPath,
      fetchImpl: options.llmFetch,
      characterId: options.voice?.characterId ?? process.env.HEREIN_VOICE_CHARACTER_ID,
      maxTokens: options.voice?.maxTokens ?? 2048,
      waitForSpeechCompletion: options.interactionPort ? false : undefined,
      maxSpeechParts: options.interactionPort ? 1 : undefined,
      interject: options.interactionPort ? false : undefined,
      backchannel: options.interactionPort ? false : undefined,
      logger: {
        info: (message, detail) => console.log(message, detail ?? ''),
        warn: (message, detail) => console.warn(message, detail ?? ''),
      },
    })
    : null;
  const aInteractionSession = voiceConversation && interactionEndpointFile
    ? new AInteractionSession({
      endpointFile: interactionEndpointFile,
      fetchImpl: options.interaction?.fetchImpl,
      logger: {
        warn: (message, detail) => console.warn(message, detail ?? ''),
      },
      onEvent: event => {
        if (process.env.HEREIN_VOICE_DEBUG === '1') {
          const transcript = event as { text?: unknown; final?: unknown };
          console.log('[voice] event', JSON.stringify({
            type: event.type,
            final: transcript.final,
            characters: typeof transcript.text === 'string' ? transcript.text.length : undefined,
          }));
        }

        if (event.type === 'transcript') {
          const transcript = event as { text?: unknown; final?: unknown; turnId?: unknown };

          if (transcript.final === true && typeof transcript.text === 'string') {
            voiceConversation.handleTranscript(
              transcript.text,
              typeof transcript.turnId === 'string' ? transcript.turnId : undefined,
            );
          }
        } else if (event.type === 'interrupted') {
          voiceConversation.interrupt();
          events.publish('interaction.interrupted', event);
        } else if (event.type === 'speech.completed' || event.type === 'speech.failed') {
          voiceConversation.handleSpeechEvent(event);
          events.publish('interaction.speech', event);
        } else if (event.type === 'vad') {
          const vad = event as { state?: unknown };

          if (vad.state === 'start' || vad.state === 'end') {
            voiceConversation.handleVad(vad.state);
          }

          events.publish('interaction.vad', event);
        } else if (event.type === 'presence') {
          events.publish('interaction.presence', event);
        }
      },
    })
    : null;

  const initiative = new InitiativeEngine({
    repos,
    events,
    llmConfig: options.llmConfig,
    llmConfigPath: options.llmConfigPath,
    fetchImpl: options.llmFetch,
    policy: options.initiative,
    materials: materialService,
    personaFor: characterId => {
      const pack = effectivePack(characterId);

      if (!pack) {
        return null;
      }

      try {
        return compilePersona(pack, {
          relationship: repos.relationships.get(characterId),
          audience: 'private',
        });
      } catch (error) {
        console.warn('initiative persona compile failed:', error);
        return null;
      }
    },
    notify: ntfyConfig
      ? message => publishNtfyMessage(ntfyConfig, {
        title: 'Herein',
        message,
        tags: ['speech_balloon'],
      }).then(() => undefined)
      : undefined,
    onSpoken: message => {
      void interactionDispatcher.speak({
        text: message,
        source: 'initiative',
        priority: 'normal',
        interruptible: true,
      });
    },
  });

  const initiativeAutoEnabled = options.initiativeAuto?.enabled
    ?? (process.env.NODE_ENV !== 'test' && process.env.HEREIN_INITIATIVE_AUTO !== '0');
  const initiativeScheduler = initiativeAutoEnabled
    ? new InitiativeScheduler({
      engine: initiative,
      getCharacterId: () => repos.settings.get<string>('activeCharacterId')
        ?? repos.characters.list()[0]?.id
        ?? null,
      intervalMs: options.initiativeAuto?.intervalMs
        ?? (Number.parseInt(process.env.HEREIN_INITIATIVE_INTERVAL_MS ?? '', 10) || 10 * 60 * 1000),
      startDelayMs: 20_000,
    })
    : null;
  initiativeScheduler?.start();

  if (process.env.NODE_ENV !== 'test') {
    console.log(`initiative auto: ${initiativeAutoEnabled ? 'on' : 'off'}`);
    console.log(`materials auto: ${materialsAutoEnabled ? 'on' : 'off'}`);
  }

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

          for (const root of assetDirs) {
            const target = path.resolve(root, relative);

            if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
              continue;
            }

            try {
              const data = await readFile(target);
              response.writeHead(200, {
                'content-type': contentTypeFor(target),
                'content-length': data.byteLength,
                'cache-control': 'no-cache',
              });
              response.end(data);
              return;
            } catch {
              continue;
            }
          }

          sendJson(response, 404, { error: 'asset not found' });
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
          assetDirs,
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

      if (url.pathname === '/v1/persona') {
        if (request.method === 'GET') {
          sendJson(response, 200, await personaViewState());
          return;
        }

        if (request.method === 'PUT') {
          const base = activeBasePack();

          if (!base) {
            sendJson(response, 404, { error: 'no persona pack is active' });
            return;
          }

          const stored = repos.settings.get<string>(PERSONA_FINGERPRINT_KEY) ?? null;
          let diskFingerprint: string | null = null;

          try {
            diskFingerprint = fingerprintPack(await loadPersonaPack(base.root));
          } catch {
            diskFingerprint = null;
          }

          if (diskFingerprint !== null && stored !== null && diskFingerprint !== stored) {
            sendJson(response, 409, {
              error: 'persona 文件已在磁盘上被修改，请先「从文件同步」再保存编辑',
            });
            return;
          }

          const body = asRecord(await readJson(request));
          const result = validatePersonaEditInput(base, body);

          if (!result.ok) {
            sendJson(response, 400, { error: result.errors.join('；') });
            return;
          }

          syncPersonaCharacter(repos, applyPersonaEdit(base, result.state));
          repos.settings.set(PERSONA_EDIT_KEY, JSON.parse(JSON.stringify(result.state)) as JsonValue);
          sendJson(response, 200, await personaViewState());
          return;
        }

        sendJson(response, 405, { error: 'method not allowed' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/persona/refresh') {
        const base = activeBasePack();

        if (!base) {
          sendJson(response, 404, { error: 'no persona pack is active' });
          return;
        }

        let fresh;

        try {
          fresh = await loadPersonaPack(base.root);
        } catch (error) {
          sendJson(response, 500, {
            error: `重新读取 persona 文件失败：${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }

        mutablePacks.set(fresh.manifest.id, fresh);

        if (fresh.manifest.id !== base.manifest.id) {
          mutablePacks.delete(base.manifest.id);
        }

        syncPersonaCharacter(repos, fresh);
        repos.settings.set(PERSONA_EDIT_KEY, null);
        repos.settings.set(PERSONA_FINGERPRINT_KEY, fingerprintPack(fresh));
        sendJson(response, 200, await personaViewState());
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

        const audience = body.audience === 'group' ? 'group' : 'private';
        const pack = effectivePack(character.id);
        const persona = pack
          ? compilePersona(pack, {
            relationship: repos.relationships.get(character.id),
            audience,
          })
          : undefined;
        let systemPrompt = typeof body.system === 'string' && body.system.trim()
          ? body.system
          : '';
        const lastUser = [...llmMessages].reverse().find(message => message.role === 'user');
        const persist = body.persist !== false;
        const previousAssistant = repos.messages
          .listRecent(timeline.id, 10)
          .reverse()
          .find(message => message.role === 'assistant');
        const previousAffect = repos.affectState.get(characterId);
        const affect = computeAffect({
          characterId,
          now: new Date(),
          recent: llmMessages,
          previous: previousAffect,
        });
        repos.affectState.upsert(affect);
        const turn: TurnDecision | null = lastUser
          ? directTurn({
            userText: lastUser.content,
            recent: llmMessages,
            lastAssistantAt: previousAssistant?.timestamp ?? null,
            now: new Date(),
            affect,
          }, pack?.manifest.tuning?.turnDirector)
          : null;
        const rememberOpenLoops = () => {
          if (!lastUser) {
            return;
          }

          repos.initiativeBids.markLatestSentAsReplied(characterId);

          const existing = new Set(
            repos.openLoops.listOpen(characterId, 20).map(loop => loop.text),
          );

          for (const text of extractOpenLoops(lastUser.content)) {
            if (existing.has(text)) {
              continue;
            }

            repos.openLoops.create({
              id: randomUUID(),
              characterId,
              timelineId: timeline.id,
              text,
              sourceMessageId: clientMessageId,
              status: 'open',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            });
          }
        };

        if (turn?.act === 'silent' && lastUser) {
          if (persist) {
            repos.messages.append({
              id: randomUUID(),
              timelineId: timeline.id,
              role: 'user',
              content: lastUser.content,
              timestamp: new Date().toISOString(),
              status: 'sent',
            });
          }

          rememberOpenLoops();

          events.publish('presence.reaction', {
            characterId,
            timelineId: timeline.id,
            emotion: 'neutral',
            notice: '在听',
          });

          const silentResponse = {
            silent: true,
            turn,
            presence: { emotion: 'neutral', notice: '在听' },
            persisted: persist,
            timelineId: timeline.id,
          };

          if (idempotencyKey) {
            repos.chatIdempotency.put(idempotencyKey, silentResponse);
          }

          sendJson(response, 200, silentResponse);
          return;
        }

        let materialBlock: string | undefined;
        let fedMaterials: MaterialItem[] = [];

        if (!systemPrompt && lastUser) {
          try {
            const context = await materialService.contextForText(lastUser.content);

            materialBlock = context.block || undefined;
            fedMaterials = context.items;
          } catch (error) {
            console.warn('chat material context failed:', error);
          }

          // 续聊兜底：意图正则追不上"再给一个""这次给个链接"这类指代式追问。
          // 只要对话处在素材语境，就把库里最新的真实素材重新摆到她面前——
          // blockWithItems 只读本地库，不触发网络刷新。
          if (!materialBlock && MATERIAL_CONTEXT_HINT.test(lastUser.content)) {
            try {
              const fallback = materialService.blockWithItems(6);

              if (fallback.text) {
                materialBlock = fallback.text;
                fedMaterials = fallback.items;
              }
            } catch {
              // No local material either; the reply then simply has none.
            }
          }

          // 追问链接：不再要求之前挂过卡片（否则没挂过卡的会话永远进不了
          // 这个分支）。只要手头有真实素材，就直接把编号摆出来。
          if (/链接|在哪看|哪里看|地址|发我/.test(lastUser.content)) {
            const linkable = fedMaterials
              .map(item => materialShortId(item))
              .filter((id): id is string => Boolean(id));

            if (linkable.length > 0) {
              materialBlock = [
                '【她刚提到的】用户想要内容的链接。',
                `直接把编号告诉他：${linkable.join(' / ')}。不用道歉，不用解释系统，一两句话就行。`,
              ].join('\n');
            }
          }
        }

        if (!systemPrompt) {
          const pluginNames = pluginRegistry.list()
            .filter(plugin => plugin.installed && plugin.enabled)
            .map(plugin => `- ${plugin.manifest.name}（${plugin.manifest.id}）`);
          const pluginBlock = pluginNames.length > 0
            ? ['【你这边开着的插件】', ...pluginNames].join('\n')
            : undefined;
          const recall = recallMemory({
            store: memoryStore,
            brief: {
              characterId,
              timelineId: timeline.id,
              audience,
              purpose: 'chat',
              situation: lastUser?.content ?? '',
              messageId: clientMessageId,
              packVersion: persona?.packVersion ?? null,
            },
          });

          systemPrompt = buildCoreChatPrompt({
            repos,
            character,
            timeline,
            audience,
            persona,
            memoryBlock: recall.text || undefined,
            materialBlock,
            pluginBlock,
          });

          const guidance = turn?.act === 'react'
            ? '只回一个短反应，最多 15 个字；不要追问，不要解释。'
            : turn?.act === 'elaborate'
              ? '可以展开到 3–4 句，先给结论；不要客服腔。'
              : '1–2 句，最多两个气泡；先接住眼前这句话。';

          systemPrompt = `${systemPrompt}\n\n${affectPrompt(affect)}\n\n【这一轮】\n${guidance}`;
        }

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
            maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : turn?.maxTokens,
            fetchImpl: options.llmFetch,
          });
        } catch (error) {
          sendJson(response, 502, {
            error: 'LLM request failed',
            detail: error instanceof Error ? error.message : 'unknown error',
          });
          return;
        }

        const assistant = parseAssistantMetadata(completion.content);
        const shaped = parseAssistantReply(assistant.text, pack?.manifest.tuning?.replyStyle);

        if (shaped.silent) {
          if (persist && lastUser) {
            repos.messages.append({
              id: randomUUID(),
              timelineId: timeline.id,
              role: 'user',
              content: lastUser.content,
              timestamp: new Date().toISOString(),
              status: 'sent',
            });
          }

          rememberOpenLoops();

          events.publish('presence.reaction', {
            characterId,
            timelineId: timeline.id,
            emotion: assistant.emotion ?? 'neutral',
            notice: '在听',
          });

          const silentResponse = {
            silent: true,
            turn,
            presence: {
              emotion: assistant.emotion ?? 'neutral',
              notice: '在听',
            },
            persisted: persist,
            timelineId: timeline.id,
          };

          if (idempotencyKey) {
            repos.chatIdempotency.put(idempotencyKey, silentResponse);
          }

          sendJson(response, 200, silentResponse);
          return;
        }

        const replyText = shaped.text;
        let assistantMessageId: string | null = null;

        // 表情是锦上添花：插件缺失、目录为空或限流时静默跳过，绝不影响回复。
        let sticker: MessageSticker | null = null;

        try {
          sticker = await stickerPicker.pick({
            emotion: assistant.emotion,
            text: replyText,
            recent: repos.messages.listRecent(timeline.id, 12),
          });
        } catch {
          sticker = null;
        }

        // 素材卡片：只有当她的回复确实提到了刚刷到的内容（标题命中）才挂上。
        // 命中与否由 pickMaterialForReply 决定，卡片永远不会凭空出现。
        let material: MessageMaterial | null = null;

        try {
          const matched = pickMaterialForReply(fedMaterials, replyText);

          material = matched
            ? {
              id: matched.id,
              kind: matched.kind,
              source: matched.source,
              title: matched.title,
              creator: matched.creator,
              url: matched.url,
              coverUrl: matched.coverUrl,
            }
            : null;
        } catch {
          material = null;
        }

        if (persist) {
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

          assistantMessageId = randomUUID();
          repos.messages.append({
            id: assistantMessageId,
            timelineId: timeline.id,
            role: 'assistant',
            content: replyText,
            emotion: assistant.emotion ?? null,
            voiceInstruct: assistant.voiceInstruct ?? null,
            sticker,
            material,
            timestamp: new Date(Date.now() + 1).toISOString(),
            status: 'sent',
          });
          events.publish('chat.completed', {
            characterId,
            timelineId: timeline.id,
            model: completion.model,
            message: {
              id: assistantMessageId,
              content: replyText,
              emotion: assistant.emotion ?? null,
              voiceInstruct: assistant.voiceInstruct ?? null,
              sticker,
              material,
              bubbles: shaped.bubbles,
            },
          });
          void memoryRunner.run({
            characterId,
            timelineId: timeline.id,
          });
        }

        rememberOpenLoops();

        const chatResponse = {
          message: {
            ...(assistantMessageId ? { id: assistantMessageId } : {}),
            role: 'assistant',
            content: replyText,
            ...(assistant.emotion ? { emotion: assistant.emotion } : {}),
            ...(assistant.voiceInstruct ? { voiceInstruct: assistant.voiceInstruct } : {}),
            ...(sticker ? { sticker } : {}),
            ...(material ? { material } : {}),
            bubbles: shaped.bubbles,
          },
          model: completion.model,
          usage: completion.usage,
          latencyMs: completion.latencyMs,
          persisted: persist,
          timelineId: timeline.id,
          turn,
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

      if (request.method === 'POST' && url.pathname === '/v1/voice/transcript') {
        if (!voiceConversation) {
          sendJson(response, 503, { error: 'voice conversation is not enabled' });
          return;
        }

        const body = asRecord(await readJson(request));
        const text = requireString(body, 'text').trim().slice(0, 1000);

        if (!text) {
          sendJson(response, 400, { error: 'text is required' });
          return;
        }

        const turnId = typeof body.turnId === 'string' ? body.turnId : undefined;
        void voiceConversation.handleTranscript(text, turnId);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/voice/messages') {
        const characterId = url.searchParams.get('characterId')
          ?? repos.characters.list()[0]?.id;
        const character = characterId ? repos.characters.get(characterId) : null;

        if (!character) {
          sendJson(response, 404, { error: 'character not found' });
          return;
        }

        const timeline = repos.timelines.getVoiceForCharacter(character.id);

        sendJson(response, 200, {
          timeline,
          messages: timeline ? repos.messages.listRecent(timeline.id, 100) : [],
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/voice/interrupt') {
        voiceConversation?.interrupt();
        sendJson(response, 200, { ok: true });
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
          const result = await pluginRegistry.invoke('netease', 'candidates', { query, limit });
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 503, {
            error: 'Netease candidates failed',
            detail: error instanceof Error ? error.message : 'install and enable the netease plugin',
          });
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/bilibili/scan') {
        const body = asRecord(await readJson(request));
        const limit = typeof body.limit === 'number' ? body.limit : 20;

        const sessionId = randomUUID();
        const startedAt = new Date().toISOString();

        repos.activitySessions.start({
          id: sessionId,
          kind: 'bilibili_feed',
          status: 'running',
          startedAt,
        });

        try {
          const result = await pluginRegistry.invoke('bilibili', 'scan', { limit }) as {
            fetched?: number;
            emitted?: number;
          };
          const fetched = typeof result?.fetched === 'number' ? result.fetched : 0;
          const emitted = typeof result?.emitted === 'number' ? result.emitted : 0;

          repos.activitySessions.finish(sessionId, {
            status: 'completed',
            endedAt: new Date().toISOString(),
            stats: { fetched, inserted: emitted },
            summary: `B站推荐流：${fetched} 条，上报 ${emitted} 条。`,
          });
          triggerExperienceExtraction();
          sendJson(response, 200, { ...result, sessionId, inserted: emitted });
        } catch (error) {
          repos.activitySessions.finish(sessionId, {
            status: 'failed',
            endedAt: new Date().toISOString(),
            stats: { fetched: 0, inserted: 0 },
            summary: error instanceof Error ? error.message.slice(0, 200) : 'B站推荐流失败',
          });
          sendJson(response, 503, {
            error: 'Bilibili scan failed',
            detail: error instanceof Error ? error.message : 'install and enable the bilibili plugin',
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
          relay: {
            url: options.relayUrl ?? process.env.HEREIN_RELAY_URL,
            token: options.relayToken
              ?? process.env.HEREIN_RELAY_TOKEN
              ?? token,
            fetchImpl: options.relayFetch,
            timeoutMs: options.relayTimeoutMs,
          },
          interaction: interactionConfigured ? interactionDispatcher : undefined,
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

          if (request.method === 'POST' && segments[3] === 'health') {
            await pluginRegistry.checkHealth(pluginId);
            const plugin = pluginRegistry.get(pluginId);

            if (!plugin) {
              sendJson(response, 404, { error: 'plugin not found' });
              return;
            }

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

        if (request.method === 'DELETE' && segments[3] === 'messages') {
          const result = repos.messages.sync(timeline.id, [], undefined, { prune: true });
          repos.summaries.deleteByTimeline(timeline.id);
          repos.openLoops.clearTimeline(timeline.id);
          events.publish('timeline.cleared', {
            characterId,
            timelineId: timeline.id,
            deleted: result.deleted,
          });
          sendJson(response, 200, { ok: true, deleted: result.deleted, timeline });
          return;
        }

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
          ? memoryStore.items.search(query, { characterId, limit })
          : memoryStore.items.listActive({ characterId, limit });
        sendJson(response, 200, { memories });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memory/runs') {
        sendJson(response, 200, {
          runs: memoryStore.runs.listRecent(numberParam(url, 'limit', 20)),
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memory/events') {
        sendJson(response, 200, {
          events: memoryStore.events.listRecent({
            characterId: stringParam(url, 'characterId'),
            itemId: stringParam(url, 'itemId'),
            limit: numberParam(url, 'limit', 50),
          }),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/memory/run') {
        const body = asRecord(await readJson(request));
        const characterId = requireString(body, 'characterId');
        const character = repos.characters.get(characterId);

        if (!character) {
          sendJson(response, 404, { error: `character not found: ${characterId}` });
          return;
        }

        const timeline = repos.timelines.getPrimaryForCharacter(characterId)
          ?? repos.timelines.ensurePrimaryForCharacter(characterId, character.name);

        const result = await memoryRunner.run({ characterId, timelineId: timeline.id });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/memory/recall') {
        const body = asRecord(await readJson(request));
        const characterId = requireString(body, 'characterId');
        const result = recallMemory({
          store: memoryStore,
          brief: {
            characterId,
            timelineId: typeof body.timelineId === 'string' ? body.timelineId : null,
            audience: body.audience === 'group' ? 'group' : body.audience === 'public' ? 'public' : 'private',
            purpose: 'chat',
            situation: typeof body.situation === 'string' ? body.situation : '',
            budget: typeof body.budget === 'number' ? body.budget : undefined,
          },
        });
        sendJson(response, 200, {
          text: result.text,
          itemIds: result.itemIds,
          sections: result.sections,
          latencyMs: result.latencyMs,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/experiences/extract') {
        const body = asRecord(await readJson(request));
        const requested = typeof body.characterId === 'string' ? body.characterId : null;
        const characterId = requested ?? repos.settings.get<string>('activeCharacterId')
          ?? repos.characters.list()[0]?.id;

        if (!characterId) {
          sendJson(response, 400, { error: 'no character available' });
          return;
        }

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

        const result = await extractExperiences({
          repos,
          store: memoryStore,
          characterId,
          llmConfig: config,
          fetchImpl: options.llmFetch,
          limit: typeof body.limit === 'number' ? body.limit : undefined,
        });
        sendJson(response, 200, result);
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
          experiences: memoryStore.experiences.listRecent({
            characterId: stringParam(url, 'characterId'),
            limit: numberParam(url, 'limit', 20),
          }),
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

      // The renderer runs under a CSP that only allows the local core
      // (connect-src 'self' http://127.0.0.1:*). Provider calls are proxied
      // here so any Base URL keeps working without relaxing the CSP, and
      // without depending on the provider sending CORS headers.
      if (request.method === 'POST' && url.pathname === '/v1/llm-proxy') {
        const body = asRecord(await readJson(request));
        const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';

        if (!rawUrl) {
          sendJson(response, 400, { error: 'url is required' });
          return;
        }

        let target: URL;

        try {
          target = new URL(rawUrl);
        } catch {
          sendJson(response, 400, { error: `invalid url: ${rawUrl}` });
          return;
        }

        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          sendJson(response, 400, { error: 'only http and https urls are allowed' });
          return;
        }

        const upstreamHeaders = new Headers();
        const rawHeaders = body.headers;

        if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
          for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
            if (typeof value === 'string') {
              upstreamHeaders.set(key, value);
            }
          }
        }

        const upstreamBody = body.body === undefined
          ? undefined
          : typeof body.body === 'string'
            ? body.body
            : JSON.stringify(body.body);

        if (upstreamBody && !upstreamHeaders.has('content-type')) {
          upstreamHeaders.set('content-type', 'application/json');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180_000);

        try {
          const upstream = await fetch(target, {
            method: typeof body.method === 'string' ? body.method : 'GET',
            headers: upstreamHeaders,
            body: upstreamBody,
            signal: controller.signal,
          });
          const text = await upstream.text();

          response.writeHead(upstream.status, {
            'content-type': upstream.headers.get('content-type') ?? 'application/json',
            'content-length': Buffer.byteLength(text),
            'cache-control': 'no-store',
          });
          response.end(text);
        } catch (error) {
          sendJson(response, 502, {
            error: 'upstream request failed',
            detail: error instanceof Error ? error.message : 'unknown error',
          });
        } finally {
          clearTimeout(timeout);
        }

        return;
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
        fetchCandidates: async () => {
          try {
            const result = await pluginRegistry.invoke('netease', 'candidates', { limit: 3 }) as {
              candidates?: unknown[];
            };

            return Array.isArray(result.candidates) ? result.candidates : [];
          } catch {
            // The plugin may be disabled; proactive sharing then just skips.
            return [];
          }
        },
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

  aInteractionSession?.start();

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
      materialService.stopAutoRefresh();
      await aInteractionSession?.stop();
      await voiceConversation?.stop();
      await interactionDispatcher.stop();
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
  const personaRoot = resolvePersonaRoot();
  const personaPacks = await loadPersonaPacks(personaRoot).catch(error => {
    console.warn(`persona packs were not loaded: ${error instanceof Error ? error.message : error}`);
    return new Map();
  });

  if (personaPacks.size > 0) {
    console.log(`persona packs: ${[...personaPacks.keys()].join(', ')}`);
  }

  const handle = await startCoreServer({
    personaPacks,
    seedPersonaPacks: process.env.HEREIN_PERSONA_SEED === '1',
    experienceAuto: process.env.HEREIN_EXPERIENCE_AUTO === '1',
  });
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
