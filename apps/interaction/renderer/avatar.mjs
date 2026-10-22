import { Application, Ticker } from "pixi.js";
import "@pixi/unsafe-eval";
export class Avatar {
  constructor(host, manifest, fps) {
    this.host = host;
    this.manifest = manifest;
    this.fps = fps;
    this.mouth = 0;
    this.emotion = "neutral";
    this.samples = [];
    this.errors = 0;
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
      idleMotionGroup: m.motions?.idle || "idle",
      autoUpdate: true,
    });
    this.model.anchor.set(0.5, 0.5);
    this.app.stage.addChild(this.model);
    const width = this.model.width,
      height = this.model.height;
    this.fit = () => {
      const w = this.host.clientWidth,
        h = this.host.clientHeight;
      this.model.scale.set(Math.min(w / width, h / height) * (m.scale || 0.92));
      this.model.x = w * (0.5 + (m.offsetX || 0));
      this.model.y = h * (0.5 + (m.offsetY || 0));
    };
    this.fit();
    this.observer = new ResizeObserver(this.fit);
    this.observer.observe(this.host);
    this.model.internalModel.on("beforeModelUpdate", () => {
      const core = this.model.internalModel.coreModel;
      const set = (id, value) => {
        if (!id) return;
        if (m.cubism === 2) core.setParamFloat(id, value);
        else core.setParameterValueById(id, value);
      };
      set(m.parameters.mouth, this.mouth);
      if (m.parameters.breath)
        set(
          m.parameters.breath,
          0.5 + 0.4 * Math.sin(performance.now() / 1400),
        );
    });
    let last = performance.now();
    this.app.ticker.add(() => {
      const now = performance.now();
      this.samples.push(now - last);
      last = now;
      if (this.samples.length > 600) this.samples.shift();
    });
    this.expression(this.emotion);
    this.motion("idle");
    this.move = (event) => {
      const box = this.host.getBoundingClientRect();
      this.model.focus(event.clientX - box.left, event.clientY - box.top);
    };
    this.host.addEventListener("pointermove", this.move);
    this.tap = () => this.motion("tap");
    this.host.addEventListener("click", this.tap);
    this.app.view.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.errors++;
      this.app.stop();
    });
    this.app.view.addEventListener("webglcontextrestored", () => {
      this.app.start();
      this.fit();
    });
  }
  expression(emotion) {
    this.emotion = emotion;
    const expression = this.manifest.expressions?.[emotion];
    if (expression && this.model)
      Promise.resolve(this.model.expression(expression)).catch(
        () => this.errors++,
      );
  }
  motion(name) {
    const group = this.manifest.motions?.[name];
    if (group && this.model)
      void this.model
        .motion(group, undefined, name === "idle" ? 1 : 3)
        .catch(() => this.errors++);
  }
  stats() {
    const frames = this.samples;
    const mean = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
    return { fps: mean ? 1000 / mean : 0, renderErrors: this.errors };
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
    this.observer?.disconnect();
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("click", this.tap);
    this.app?.destroy(true, {
      children: true,
      texture: true,
      baseTexture: true,
    });
  }
}
