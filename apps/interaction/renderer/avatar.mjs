import { Application, Ticker } from "pixi.js";
import "@pixi/unsafe-eval";
import { BodyAnimator, motionSpec } from "./body.mjs";
import { avatarLayout } from "./framing.mjs";
export class Avatar {
  constructor(host, manifest, fps, framing = "bust") {
    this.host = host;
    this.manifest = manifest;
    this.fps = fps;
    this.framing = ["bust", "half", "full"].includes(framing) ? framing : "bust";
    this.mouth = 0;
    this.emotion = "neutral";
    this.samples = [];
    this.errors = 0;
    this.state = "idle";
    this.expressionBusy = false;
    this.parameterValues = {};
    this.smoothedMouth = 0;
  }
  async load() {
    const m = this.manifest;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = m.core;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Cubism core failed to load"));
      document.head.appendChild(script);
    });
    const { Live2DModel, config } = await (m.cubism === 2
      ? import("pixi-live2d-display/cubism2")
      : import("pixi-live2d-display/cubism4"));
    config.sound = false;
    config.preserveExpressionOnMotion = true;
    Live2DModel.registerTicker(Ticker);
    this.app = new Application({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(devicePixelRatio, 1.5),
    });
    this.app.ticker.maxFPS = this.fps;
    if (this.isHidden) this.app.ticker.maxFPS = 10;
    this.host.appendChild(this.app.view);
    this.model = await Live2DModel.from(new URL(m.entry, location.href).href, {
      autoHitTest: false,
      autoFocus: false,
      idleMotionGroup: motionSpec(m.motions?.idle)?.group || "idle",
      autoUpdate: true,
    });
    this.model.anchor.set(0.5, 0.5);
    this.app.stage.addChild(this.model);
    const manager = this.model.internalModel.motionManager;
    const core = this.model.internalModel.coreModel;
    // Cubism 2 creates virtual parameters for unknown IDs; strict presence
    // validation is available only from Cubism 4's actual parameter list.
    if (m.cubism === 4 && !core._model.parameters.ids.includes(m.parameters.mouth))
      throw new Error("Manifest mouth parameter is unavailable");
    for (const spec of Object.values(m.motions || {}).map(motionSpec)) {
      if (!manager.definitions[spec.group]?.length ||
          (spec.index !== undefined && !manager.definitions[spec.group][spec.index]))
        throw new Error("Manifest motion is unavailable");
    }
    for (const expression of Object.values(m.expressions || {}))
      if (expression !== null && (!manager.expressionManager ||
          manager.expressionManager.getExpressionIndex(expression) < 0))
        throw new Error("Manifest expression is unavailable");
    const specifications = Object.values(m.motions || {}).map(motionSpec);
    await Promise.all(specifications.filter(s => s.index !== undefined)
      .map(async spec => {
        const motion = await manager.loadMotion(spec.group, spec.index);
        if (!motion) throw new Error("Manifest motion is unavailable");
        if (typeof spec.loop === "boolean") motion.setIsLoop?.(spec.loop);
        return motion;
      }));
    await Promise.all((manager.expressionManager?.definitions || [])
      .map((_, i) => manager.expressionManager.loadExpression(i)));
    this.body = new BodyAnimator(m, {
      stop: () => manager.stopAllMotions(),
      play: spec => this.model.motion(spec.group, spec.index, 3)
        .catch(() => { this.errors++; return false; }),
      expression: emotion => this.applyExpression(emotion),
    });
    manager.on("motionFinish", () => queueMicrotask(() => this.body?.finished()));
    const width = this.model.width,
      height = this.model.height;
    this.fit = () => {
      const layout = avatarLayout({
        modelWidth: width,
        modelHeight: height,
        width: this.host.clientWidth,
        height: this.host.clientHeight,
        framing: this.framing,
        scale: this.framing === "full" ? (m.scale || 0.92) : (m.scale || 1),
        offsetX: m.offsetX || 0,
        offsetY: m.offsetY || 0,
        framingTop: m.framingTop,
        framingScaleBust: m.framingScaleBust,
        framingScaleHalf: m.framingScaleHalf,
      });
      this.model.scale.set(layout.scale);
      this.model.x = layout.x;
      this.model.y = layout.y;
    };
    this.fit();
    this.observer = new ResizeObserver(this.fit);
    this.observer.observe(this.host);
    // Idle/think motions may omit mouth curves. Clear the old motion's mouth
    // before blending, then allow expressions and PCM to contribute in order.
    this.model.internalModel.on("beforeMotionUpdate", () => {
      const core = this.model.internalModel.coreModel;
      if (m.cubism === 2) core.setParamFloat(m.parameters.mouth, 0);
      else core.setParameterValueById(m.parameters.mouth, 0);
    });
    let lastMouthAt = performance.now();
    this.model.internalModel.on("beforeModelUpdate", () => {
      const core = this.model.internalModel.coreModel;
      const set = (id, value) => {
        if (!id) return;
        if (m.cubism === 2) core.setParamFloat(id, value);
        else core.setParameterValueById(id, value);
      };
      // Preserve expression mouths at rest; PCM takes precedence only while speaking.
      const now = performance.now();
      const dt = Math.min(100, now - lastMouthAt);
      lastMouthAt = now;
      const target = Math.max(0, Math.min(1, this.mouth));
      const smoothingMs = target > this.smoothedMouth ? 35 : 85;
      this.smoothedMouth += (target - this.smoothedMouth) * (1 - Math.exp(-dt / smoothingMs));
      if (this.state !== "speaking") this.smoothedMouth = 0;
      if (this.state === "speaking")
        set(m.parameters.mouth, this.smoothedMouth);
      if (m.parameters.breath)
        set(
          m.parameters.breath,
          0.5 + 0.4 * Math.sin(performance.now() / 1400),
        );
      for (const id of Object.values(m.parameters)) {
        this.parameterValues[id] = m.cubism === 2
          ? core.getParamFloat(id) : core.getParameterValueById(id);
      }
    });
    let last = performance.now();
    this.app.ticker.add(() => {
      const now = performance.now();
      this.samples.push(now - last);
      last = now;
      if (this.samples.length > 600) this.samples.shift();
    });
    this.expression(this.emotion);
    this.body.setState(this.state);
    this.move = (event) => {
      this.focus(event.clientX, event.clientY);
    };
    this.host.addEventListener("pointermove", this.move);
    this.leave = () => this.model.internalModel.focusController.focus(0, 0);
    this.host.addEventListener("pointerleave", this.leave);
    this.app.view.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.errors++;
      this.app.stop();
    });
    this.app.view.addEventListener("webglcontextrestored", () => {
      this.app.start();
      this.fit();
    });
    this.loaded = true;
  }
  expression(emotion) {
    if (typeof emotion !== "string") return;
    this.emotion = emotion;
    if (this.body) this.body.expression(emotion);
  }
  applyExpression(emotion) {
    const expression = this.manifest.expressions?.[emotion];
    if (!this.model || expression === undefined) return;
    this.pendingExpression = expression;
    if (!this.expressionBusy) void this.flushExpression();
  }
  async flushExpression() {
    this.expressionBusy = true;
    try {
      while (this.pendingExpression !== undefined && this.model) {
        const expression = this.pendingExpression;
        this.pendingExpression = undefined;
        const manager = this.model.internalModel.motionManager.expressionManager;
        if (!manager) continue;
        // Limit Cubism's fading expression queue during bursts of body commands.
        if (manager.queueManager?._motions?.length >= 4) manager.stopAllExpressions();
        if (expression === null) {
          manager.stopAllExpressions();
          manager.reserveExpressionIndex = -1;
          manager.currentExpression = manager.defaultExpression;
          manager.resetExpression();
        } else await this.model.expression(expression);
      }
    } catch { this.errors++; }
    finally { this.expressionBusy = false; }
  }
  motion(name) {
    return this.body?.motion(name).catch(() => this.errors++);
  }
  interact(kind) {
    return this.body?.interact(kind).catch(() => this.errors++);
  }
  setState(state) {
    this.state = state;
    this.body?.setState(state);
  }
  setFraming(framing) {
    if (!["bust", "half", "full"].includes(framing)) return;
    this.framing = framing;
    this.fit?.();
  }
  focus(x, y) {
    const box = this.host.getBoundingClientRect();
    this.model?.focus(x - box.left, y - box.top);
  }
  diagnostic() {
    const manager = this.model?.internalModel.motionManager;
    const expression = manager?.expressionManager;
    return {
      loaded: this.loaded === true, cubism: this.manifest.cubism,
      framing: this.framing,
      state: this.state, emotion: this.body?.emotion,
      motion: this.body?.motionName,
      group: manager?.state.currentGroup, index: manager?.state.currentIndex,
      expressionDefault: expression?.currentExpression === expression?.defaultExpression,
      expressionName: expression?.definitions[expression?.expressions.indexOf(expression?.currentExpression)]?.Name,
      motionQueue: manager?.queueManager?._motions?.length,
      expressionQueue: expression?.queueManager?._motions?.length,
      parameters: { ...this.parameterValues },
      ...this.stats(),
    };
  }
  stats() {
    const frames = this.samples;
    const mean = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
    return { fps: mean ? 1000 / mean : 0, renderErrors: this.errors, avatarReady: this.loaded === true };
  }
  setFps(fps) {
    this.fps = fps;
    if (this.app) this.app.ticker.maxFPS = this.isHidden ? 10 : fps;
    this.samples = [];
  }
  hidden(hidden) {
    this.isHidden = hidden;
    if (!this.app) return;
    if (hidden) {
      this.app.ticker.maxFPS = 10;
      this.samples = [];
    } else this.setFps(this.fps);
  }
  destroy() {
    this.loaded = false;
    this.pendingExpression = undefined;
    this.observer?.disconnect();
    this.body?.destroy();
    this.body = null;
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerleave", this.leave);
    this.app?.destroy(true, {
      children: true,
      texture: true,
      baseTexture: true,
    });
  }
}
