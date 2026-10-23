const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  screen,
  powerMonitor,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { VoiceWorkers } = require("./workers.cjs");
const root = __dirname;
let win,
  tray,
  workers,
  server,
  config,
  manifest,
  dataDir,
  token,
  buildId,
  rendererDir,
  generation = 0,
  quitting = false,
  ready = false;
const clients = new Set(),
  acks = new Map();
let serial = Promise.resolve(),
  pendingMetrics = 0,
  lastRendererAt = 0,
  lastMetrics = {},
  lastInteraction = Date.now(),
  micActive = false,
  micPreference = false;
app.setName("Herein Interaction");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
const configPath =
  process.argv.find((arg) => arg.startsWith("--config="))?.slice(9) ||
  process.env.HEREIN_INTERACTION_CONFIG;
if (!configPath) {
  console.error(
    "Set HEREIN_INTERACTION_CONFIG or --config=<absolute-local-config.json>",
  );
  app.quit();
} else {
  // Set paths before the first awaited filesystem read and before Chromium
  // starts GPU/network children, including direct Electron/login launches.
  dataDir = path.resolve(
    process.argv.find(arg => arg.startsWith("--data-dir="))?.slice(11) ||
    process.env.HEREIN_INTERACTION_DATA_DIR || path.join(root, "../../tmp/interaction-data"),
  );
  app.setPath("userData", dataDir);
  app.setPath("sessionData", dataDir);
  app.commandLine.appendSwitch("user-data-dir", dataDir);
}
function push(event) {
  if (win && !win.isDestroyed())
    win.webContents.send("interaction:push", event);
}
function publish(event) {
  for (const client of clients) {
    if (client.writableLength > 65536) {
      client.destroy();
      clients.delete(client);
    } else client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
function metric(event) {
  if (pendingMetrics >= 256) return;
  const clean = { at: new Date().toISOString(), type: event.type };
  for (const key of [
    "generation",
    "provider",
    "firstMs",
    "elapsedMs",
    "audioSeconds",
    "rtf",
    "fps",
    "rssMiB",
    "heapMiB",
    "bufferMs",
    "underruns",
    "renderFirstMs",
    "interruptMs",
    "vadToAsrMs",
    "asrMs",
    "endToSoundMs",
    "renderErrors",
    "tracks",
    "audioContexts",
    "state",
    "reason",
    "count",
  ]) {
    if (typeof event[key] === "number" && Number.isFinite(event[key]))
      clean[key] = Math.round(event[key] * 100) / 100;
    if (
      ["provider", "state"].includes(key) &&
      typeof event[key] === "string" &&
      event[key].length < 40
    )
      clean[key] = event[key];
  }
  if (typeof event.avatarReady === "boolean") clean.avatarReady = event.avatarReady;
  // Serialize writes and rotate: no text, audio, tokens, or arbitrary payloads enter logs.
  pendingMetrics++;
  serial = serial
    .then(async () => {
      const file = path.join(dataDir, "metrics.jsonl");
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.size > 8 * 1024 * 1024)
        await fs.rename(file, path.join(dataDir, "metrics.previous.jsonl"));
      await fs.appendFile(file, JSON.stringify(clean) + "\n");
    })
    .catch(() => {})
    .finally(() => {
      pendingMetrics--;
    });
  const sample = { ...clean };
  if (!["renderer.sample", "presence"].includes(event.type))
    delete sample.state;
  lastMetrics = { ...lastMetrics, ...sample };
}
function cancel(reason = "command") {
  generation++;
  workers?.cancel();
  for (const ack of acks.values()) {
    clearTimeout(ack.timer);
    ack.resolve();
  }
  acks.clear();
  push({ type: "cancel", generation, reason });
  publish({ type: "interrupted", generation, reason });
  metric({ type: "cancel", generation, reason });
  return generation;
}
async function pcm(data, meta) {
  if (meta.generation !== generation) return;
  const id = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      acks.delete(id);
      reject(new Error("Renderer audio backpressure timeout"));
    }, 15000);
    acks.set(id, { resolve, timer });
    push({ type: "pcm", id, pcm: new Uint8Array(data), ...meta });
  });
}
async function speak(value) {
  const { speechCommand } = await import("./contracts.mjs");
  const command = speechCommand(value);
  cancel("replace");
  const current = generation;
  publish({
    type: "speech.started",
    generation: current,
    turnId: command.turnId,
  });
  push({
    type: "speech.begin",
    generation: current,
    emotion: command.emotion,
    turnId: command.turnId,
  });
  void workers
    .speak(command, current, pcm)
    .then((result) => {
      if (current === generation) {
        push({ type: "speech.end", generation: current });
        publish({
          type: "speech.completed",
          generation: current,
          turnId: command.turnId,
        });
        metric({
          type: "tts.complete",
          generation: current,
          provider: config.tts.provider,
          ...result,
        });
      }
    })
    .catch((error) => {
      if (current === generation) {
        publish({
          type: "speech.failed",
          generation: current,
          turnId: command.turnId,
          error: "tts_unavailable",
        });
        // Failed synthesis invalidates every queued chunk before recovery.
        cancel("tts-failure");
        push({
          type: "speech.error",
          generation,
          error: error.message,
        });
        metric({ type: "tts.error", reason: error.message });
      }
    });
  return { generation: current };
}
function clampBounds(bounds) {
  const displays = screen.getAllDisplays();
  const match =
    displays.find((display) => {
      const r = display.workArea;
      return (
        bounds.x < r.x + r.width &&
        bounds.x + bounds.width > r.x &&
        bounds.y < r.y + r.height &&
        bounds.y + bounds.height > r.y
      );
    }) || screen.getPrimaryDisplay();
  const r = match.workArea;
  const width = Math.max(160, Math.min(bounds.width, r.width));
  const height = Math.max(240, Math.min(bounds.height, r.height));
  return {
    ...bounds,
    width,
    height,
    x: Math.max(r.x, Math.min(bounds.x, r.x + r.width - width)),
    y: Math.max(r.y, Math.min(bounds.y, r.y + r.height - height)),
  };
}
function validSender(event) {
  return win && !win.isDestroyed() && event.sender.id === win.webContents.id;
}
function updateTray() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 / 隐藏形象",
        click: () => (win.isVisible() ? win.hide() : win.show()),
      },
      {
        label: "置顶",
        type: "checkbox",
        checked: win.isAlwaysOnTop(),
        click: (item) => win.setAlwaysOnTop(item.checked),
      },
      { label: "停止说话", click: () => cancel("tray") },
      { label: "暂停 / 恢复监听", click: () => push({ type: "mic.toggle" }) },
      {
        label: "开机启动",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) =>
          app.setLoginItemSettings({
            openAtLogin: item.checked,
            path: process.execPath,
            args: [root, `--config=${configPath}`, `--data-dir=${dataDir}`],
          }),
      },
      {
        label: "退出运行时",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
async function main() {
  config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (
    !config.asr?.python ||
    !config.asr?.model ||
    !["sapi", "qwen", "qwen-gguf"].includes(config.tts?.provider)
  )
    throw new Error("Invalid interaction config");
  const { validateManifest, assetPath, avatarCommand } = await import("./contracts.mjs");
  rendererDir = path.resolve(config.rendererDir || path.join(root, "../../tmp/interaction-dist"));
  const sources = [
    "main.cjs",
    "workers.cjs",
    "preload.cjs",
    "contracts.mjs",
    "asr-worker.py",
    "qwen-worker.py",
    "gguf-worker.py",
    "sapi-worker.ps1",
    "renderer/runtime.mjs",
    "renderer/avatar.mjs",
    "renderer/body.mjs",
    "renderer/audio.mjs",
    "renderer/audio-worklet.mjs",
    "renderer/index.html",
    "renderer/style.css",
  ];
  const hash = crypto.createHash("sha256");
  for (const source of sources)
    hash.update(source).update(await fs.readFile(path.join(root, source)));
  hash.update(
    await fs.readFile(
      path.join(rendererDir, "assets/main.js"),
    ),
  );
  buildId = hash.digest("hex");
  manifest = validateManifest(
    JSON.parse(await fs.readFile(config.avatarManifest, "utf8")),
  );
  dataDir = path.resolve(
    process.argv.find((arg) => arg.startsWith("--data-dir="))?.slice(11) ||
      process.env.HEREIN_INTERACTION_DATA_DIR ||
      path.join(root, "../../tmp/interaction-data"),
  );
  app.setPath("userData", dataDir);
  app.setPath("sessionData", dataDir);
  await fs.mkdir(dataDir, { recursive: true });
  token = crypto.randomBytes(32).toString("hex");
  try {
    micPreference =
      JSON.parse(
        await fs.readFile(path.join(dataDir, "preferences.local.json"), "utf8"),
      ).listen === true;
  } catch {}
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) =>
      callback(
        webContents.id === win?.webContents.id && permission === "media",
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission) =>
      webContents?.id === win?.webContents.id && permission === "media",
  );
  workers = new VoiceWorkers(config);
  workers.on("capability", (event) => {
    push({ type: "capability", ...event });
    metric({ type: "capability", state: event.asr || event.tts });
  });
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".moc": "application/octet-stream",
    ".moc3": "application/octet-stream",
    ".mtn": "text/plain",
    ".css": "text/css",
  };
  server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (
        request.method === "GET" &&
        (url.pathname.startsWith("/avatar/") ||
          url.pathname === "/" ||
          url.pathname.startsWith("/assets/"))
      ) {
        const avatar = url.pathname.startsWith("/avatar/");
        const base = avatar
          ? manifest.root
          : rendererDir;
        const entry = decodeURIComponent(
          avatar
            ? url.pathname.slice(8)
            : url.pathname === "/"
              ? "index.html"
              : url.pathname.slice(1),
        );
        const target = assetPath(base, entry);
        const real = await fs.realpath(target),
          realRoot = await fs.realpath(base);
        if (!real.startsWith(realRoot + path.sep))
          throw new Error("Asset symlink escapes root");
        const ext = path.extname(real).toLowerCase();
        if (!mime[ext]) throw new Error("Unsupported asset type");
        response.writeHead(200, {
          "Content-Type": mime[ext],
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:",
        });
        response.end(await fs.readFile(real));
        return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401);
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/events") {
        if (clients.size >= 8) {
          response.writeHead(429);
          response.end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        });
        response.write("event: ready\ndata: {}\n\n");
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            ready,
            avatarReady: lastMetrics.avatarReady === true,
            apiVersion: 1,
            buildId,
            asr: workers.asr.ready,
            tts:
              config.tts.provider === "sapi"
                ? workers.sapi?.ready === true
                : workers.qwen?.ready === true,
            metrics: lastMetrics,
            uptimeSeconds: process.uptime(),
            generation,
            micActive,
            rendererAgeMs: lastRendererAt ? Date.now() - lastRendererAt : null,
            window: {
              visible: win?.isVisible(),
              alwaysOnTop: win?.isAlwaysOnTop(),
              bounds: win?.getBounds(),
            },
            workers: [
              workers.asr,
              config.tts.provider === "sapi" ? workers.sapi : workers.qwen,
            ].map((worker) => ({
              pid: worker?.child.pid,
              ready: worker?.ready === true,
            })),
            processes: app.getAppMetrics().map((process) => ({
              pid: process.pid,
              type: process.type,
              workingSetMiB: process.memory.workingSetSize / 1024,
              cpuPercent: process.cpu.percentCPUUsage,
            })),
          }),
        );
        return;
      }
      if (
        config.diagnostics &&
        request.method === "POST" &&
        url.pathname === "/v1/diagnostics/capture"
      ) {
        const capture = await win.webContents.capturePage();
        await fs.writeFile(
          path.join(dataDir, "runtime-capture.png"),
          capture.toPNG(),
        );
        response.end(JSON.stringify({ captured: true }));
        return;
      }
      if (config.diagnostics && request.method === "GET" &&
          url.pathname === "/v1/diagnostics/avatar") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(await win.webContents.executeJavaScript(
          "window.interactionAvatarDiagnostic?.() || {loaded:false}")));
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) throw new Error("Request too large");
      }
      const value = JSON.parse(body || "{}");
      let result;
      if (config.diagnostics && request.method === "POST" &&
          url.pathname === "/v1/diagnostics/avatar") {
        if (!["tap", "drag", "focus", "center"].includes(value.action))
          throw new Error("Invalid avatar diagnostic action");
        if (value.action === "focus" &&
            (![value.x, value.y].every(Number.isFinite) || Math.abs(value.x) > 2000 || Math.abs(value.y) > 2000))
          throw new Error("Invalid avatar diagnostic coordinates");
        result = await win.webContents.executeJavaScript(
          `window.interactionAvatarExercise?.(${JSON.stringify({ action: value.action, x: value.x, y: value.y })})`);
      } else if (request.method === "POST" && url.pathname === "/v1/speech")
        result = await speak(value);
      else if (request.method === "POST" && url.pathname === "/v1/cancel")
        result = { generation: cancel("external") };
      else if (
        config.diagnostics &&
        request.method === "POST" &&
        url.pathname === "/v1/diagnostics/lifecycle"
      ) {
        if (
          ![
            "suspend",
            "resume",
            "hide",
            "show",
            "renderer-crash",
            "asr-crash",
          ].includes(value.action)
        )
          throw new Error("Invalid diagnostic action");
        if (value.action === "suspend") {
          cancel("diagnostic-suspend");
          push({ type: "suspend" });
        }
        if (value.action === "resume") {
          workers.recover();
          push({ type: "resume" });
        }
        if (value.action === "hide") win.hide();
        if (value.action === "show") win.show();
        if (value.action === "renderer-crash")
          win.webContents.forcefullyCrashRenderer();
        if (value.action === "asr-crash") workers.asr.close();
        result = { accepted: true, simulated: true };
      } else if (
        request.method === "POST" &&
        url.pathname === "/v1/listening"
      ) {
        if (typeof value.enabled !== "boolean")
          throw new Error("enabled must be boolean");
        push({ type: "mic.set", enabled: value.enabled });
        result = { accepted: true };
      } else if (request.method === "POST" && url.pathname === "/v1/text") {
        if (
          !["begin", "delta", "end"].includes(value.op) ||
          typeof value.turnId !== "string" ||
          value.turnId.length > 80 ||
          (value.op === "delta" &&
            (typeof value.text !== "string" || value.text.length > 500))
        )
          throw new Error("Invalid text stream command");
        if (value.op === "begin") cancel("stream.begin");
        push({
          type: "text",
          op: value.op,
          turnId: value.turnId,
          text: value.op === "delta" ? value.text : "",
          emotion:
            typeof value.emotion === "string"
              ? value.emotion.slice(0, 40)
              : "neutral",
          generation,
        });
        result = { accepted: true };
      } else if (request.method === "POST" && url.pathname === "/v1/avatar") {
        const command = avatarCommand(value, manifest);
        push({
          type: "avatar",
          ...command,
        });
        result = { accepted: true };
      } else {
        response.writeHead(404);
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.port ?? 0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await fs.writeFile(
    path.join(dataDir, "endpoint.local.json"),
    JSON.stringify(
      {
        url: `http://127.0.0.1:${port}`,
        token,
        pid: process.pid,
        started: new Date().toISOString(),
        apiVersion: 1,
        buildId,
      },
      null,
      2,
    ),
  );
  let bounds = {
    width: 380,
    height: 620,
    x: screen.getPrimaryDisplay().workArea.width - 400,
    y: screen.getPrimaryDisplay().workArea.height - 640,
  };
  try {
    const saved = JSON.parse(
      await fs.readFile(path.join(dataDir, "window.local.json"), "utf8"),
    );
    if (
      ["x", "y", "width", "height"].every((key) => Number.isFinite(saved[key]))
    )
      bounds = saved;
  } catch {}
  win = new BrowserWindow({
    ...clampBounds(bounds),
    title: "Herein · 交互运行时",
    frame: false,
    transparent: config.transparent !== false,
    backgroundColor: config.transparent === false ? "#20232e" : "#00000000",
    resizable: true,
    alwaysOnTop: config.alwaysOnTop !== false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(root, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${port}/`) event.preventDefault();
  });
  if (config.diagnostics)
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () =>
        fs
          .writeFile(
            path.join(dataDir, "window.local.json"),
            JSON.stringify(win.getBounds()),
          )
          .catch(() => {}),
      500,
    );
  };
  win.on("move", save);
  win.on("resize", save);
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("hide", () => push({ type: "visibility", hidden: true }));
  win.on("show", () => push({ type: "visibility", hidden: false }));
  win.webContents.on("render-process-gone", (_event, details) => {
    ready = false;
    lastRendererAt = 0;
    micActive = false;
    lastMetrics = { ...lastMetrics, avatarReady: false, tracks: 0, fps: 0 };
    cancel("renderer-crash");
    metric({ type: "renderer.gone", reason: details.reason });
    if (!quitting)
      setTimeout(() => win.loadURL(`http://127.0.0.1:${port}/`), 1000);
  });
  const icon = nativeImage
    .createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    )
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Herein 交互运行时");
  tray.on("double-click", () => win.show());
  updateTray();
  for (const [key, action] of [
    [
      "CommandOrControl+Shift+Space",
      () => (win.isVisible() ? win.hide() : win.show()),
    ],
    ["CommandOrControl+Shift+X", () => cancel("shortcut")],
    ["CommandOrControl+Shift+M", () => push({ type: "mic.toggle" })],
  ])
    if (!globalShortcut.register(key, action))
      metric({ type: "shortcut.failed", reason: key });
  screen.on("display-removed", () =>
    win.setBounds(clampBounds(win.getBounds())),
  );
  screen.on("display-metrics-changed", () =>
    win.setBounds(clampBounds(win.getBounds())),
  );
  powerMonitor.on("suspend", () => {
    cancel("suspend");
    push({ type: "suspend" });
    metric({ type: "power.suspend" });
  });
  powerMonitor.on("resume", () => {
    workers.recover();
    push({ type: "resume" });
    win.setBounds(clampBounds(win.getBounds()));
    metric({ type: "power.resume" });
  });
  powerMonitor.on("lock-screen", () => {
    cancel("lock");
    push({ type: "suspend" });
  });
  powerMonitor.on("unlock-screen", () => push({ type: "resume" }));
  ipcMain.handle("interaction:bootstrap", (event) => {
    if (!validSender(event)) throw new Error("Invalid sender");
    ready = true;
    return {
      manifest: {
        ...manifest,
        root: undefined,
        entry: `/avatar/${manifest.entry.replaceAll("\\", "/")}`,
        core: `/avatar/${manifest.core.replaceAll("\\", "/")}`,
      },
      config: {
        fps: config.fps || 60,
        vad: config.vad || {},
        demoReply: config.demoReply || "",
        provider: config.tts.provider,
        autoListen: config.autoListen === true || micPreference,
        diagnostics: config.diagnostics === true,
        silentOutput: config.silentOutput === true,
      },
      asrReady: workers.asr.ready,
    };
  });
  ipcMain.handle("interaction:asr", async (event, pcm, turnId) => {
    if (
      !validSender(event) ||
      !(pcm instanceof Uint8Array) ||
      typeof turnId !== "string" ||
      turnId.length > 80
    )
      throw new Error("Invalid audio");
    const current = generation;
    const result = await workers.transcribe(pcm);
    if (current !== generation) return { stale: true };
    publish({
      type: "transcript",
      text: result.text,
      final: true,
      generation: current,
      turnId,
    });
    metric({ type: "asr.complete", asrMs: result.elapsedMs });
    return result;
  });
  ipcMain.handle("interaction:speak", (event, command) => {
    if (!validSender(event)) throw new Error("Invalid sender");
    return speak(command);
  });
  ipcMain.handle("interaction:cancel", (event) => {
    if (!validSender(event)) throw new Error("Invalid sender");
    return cancel("renderer");
  });
  ipcMain.on("interaction:ack", (event, id) => {
    if (!validSender(event)) return;
    const ack = acks.get(id);
    if (ack) {
      clearTimeout(ack.timer);
      acks.delete(id);
      ack.resolve();
    }
  });
  ipcMain.on("interaction:event", (event, value) => {
    if (
      !validSender(event) ||
      !value ||
      typeof value.type !== "string" ||
      value.type.length > 40
    )
      return;
    if (value.type === "renderer.sample") lastRendererAt = Date.now();
    if (value.type === "presence") {
      micActive = value.micActive === true;
      lastInteraction = Date.now();
      publish({
        type: "presence",
        state: String(value.state || "idle").slice(0, 40),
        micActive,
      });
    }
    if (value.type === "mic.preference" && typeof value.enabled === "boolean") {
      micPreference = value.enabled;
      void fs.writeFile(
        path.join(dataDir, "preferences.local.json"),
        JSON.stringify({ listen: micPreference }),
      );
    }
    metric(value);
  });
  ipcMain.handle("interaction:window", (event, action, value) => {
    if (!validSender(event)) throw new Error("Invalid sender");
    if (action === "hide") win.hide();
    if (action === "top") {
      win.setAlwaysOnTop(Boolean(value));
      updateTray();
    }
    if (action === "quit") {
      quitting = true;
      app.quit();
    }
    if (
      action === "move" &&
      Number.isFinite(value?.x) &&
      Number.isFinite(value?.y)
    ) {
      const b = win.getBounds();
      win.setBounds(
        clampBounds({
          ...b,
          x: b.x + Math.max(-1000, Math.min(1000, value.x)),
          y: b.y + Math.max(-1000, Math.min(1000, value.y)),
        }),
      );
    }
    return true;
  });
  setInterval(() => {
    metric({
      type: "host.sample",
      rssMiB: process.memoryUsage().rss / 1048576,
      heapMiB: process.memoryUsage().heapUsed / 1048576,
    });
    publish({
      type: "presence",
      idleSeconds: powerMonitor.getSystemIdleTime(),
      runtimeIdleSeconds: (Date.now() - lastInteraction) / 1000,
      micActive,
    });
    for (const client of clients) {
      if (client.writableLength > 65536) {
        client.destroy();
        clients.delete(client);
      } else client.write(": heartbeat\n\n");
    }
  }, 30000).unref();
  let recoverAt = 0;
  setInterval(() => {
    if (Date.now() < recoverAt) return;
    const voice = config.tts.provider === "sapi" ? workers.sapi : workers.qwen;
    if (
      (!workers.asr.ready &&
        (workers.asr.closed || workers.asr.child.exitCode !== null)) ||
      (!voice?.ready && (voice?.closed || voice?.child.exitCode !== null))
    ) {
      recoverAt = Date.now() + 30000;
      workers.recover();
      metric({ type: "worker.recovery" });
    }
  }, 5000).unref();
  await win.loadURL(`http://127.0.0.1:${port}/`);
  win.show();
  console.log(
    `Interaction runtime listening on loopback port ${port}; discovery: ${path.join(dataDir, "endpoint.local.json")}`,
  );
  metric({ type: "runtime.started", provider: config.tts.provider });
}
app.on("before-quit", () => {
  quitting = true;
  workers?.close();
  globalShortcut.unregisterAll();
  server?.close();
  for (const client of clients) client.end();
  tray?.destroy();
  for (const ack of acks.values()) {
    clearTimeout(ack.timer);
    ack.resolve();
  }
  acks.clear();
});
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});
if (configPath)
  main().catch((error) => {
    console.error(error.message);
    quitting = true;
    app.quit();
  });
