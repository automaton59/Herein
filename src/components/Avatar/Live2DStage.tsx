import React from 'react';
import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism2';
import type { PresenceEmotion } from '../../services/desktopPresence';

export type PresenceActivity = 'idle' | 'thinking' | 'replying' | 'reacting';

interface Live2DStageProps {
  modelUrl: string;
  coreUrl: string;
  emotion?: string | null;
  activity?: PresenceActivity;
  /** Legacy mobile prop; desktop is text-only and keeps the mouth closed. */
  mouthOpen?: number;
  expressionMap?: Partial<Record<PresenceEmotion, string | null>>;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  onReady?: () => void;
  onError?: (message: string) => void;
}

const CUBISM2_EXPRESSION_BY_EMOTION: Record<string, string> = {
  neutral: 'f01',
  happy: 'f01',
  excited: 'f01',
  playful: 'f01',
  shy: 'f02',
  sad: 'f03',
  worried: 'f03',
  angry: 'f04',
  serious: 'f04',
};

function isCubism4Model(modelUrl: string) {
  return /\.model3\.json(?:$|[?#])/i.test(modelUrl);
}

function coreIsReady(cubism4: boolean) {
  const globals = window as unknown as {
    Live2D?: unknown;
    Live2DCubismCore?: unknown;
  };

  return cubism4 ? Boolean(globals.Live2DCubismCore) : Boolean(globals.Live2D);
}

function loadCubismCore(coreUrl: string, cubism4: boolean) {
  if (coreIsReady(cubism4)) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-herein-live2d-core="${cubism4 ? '4' : '2'}"]`,
  );

  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Live2D core failed to load')), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = coreUrl;
    script.async = true;
    script.dataset.hereinLive2dCore = cubism4 ? '4' : '2';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Live2D core failed to load: ${coreUrl}`));
    document.head.appendChild(script);
  });
}

function resetModelExpression(model: Live2DModel) {
  const internal = model.internalModel as unknown as {
    motionManager?: {
      expressionManager?: {
        resetExpression?: () => void;
      };
    };
  };

  try {
    internal.motionManager?.expressionManager?.resetExpression?.();
  } catch {
    // Resetting is cosmetic; keep the current face if it fails.
  }
}

function startIdleMotion(model: Live2DModel) {
  try {
    const settings = (model.internalModel as unknown as {
      settings?: { motions?: Record<string, unknown> };
    }).settings;
    const groups = Object.keys(settings?.motions ?? {});
    const idleGroup = groups.find(group => /^idle$/i.test(group))
      ?? groups.find(group => /idle/i.test(group));

    if (idleGroup) {
      void model.motion(idleGroup).catch(() => undefined);
    }
  } catch {
    // The model may not expose motion groups; idle motion is optional.
  }
}

function playMotionByKeyword(model: Live2DModel, groupPattern: string, filePattern: RegExp) {
  try {
    const settings = (model.internalModel as unknown as {
      settings?: { motions?: Record<string, Array<{ File?: string }>> };
    }).settings;
    const group = Object.keys(settings?.motions ?? {}).find(value => new RegExp(groupPattern, 'i').test(value));

    if (!group) {
      return;
    }

    const index = (settings?.motions?.[group] ?? []).findIndex(item => filePattern.test(item.File ?? ''));

    if (index >= 0) {
      void model.motion(group, index, 2).catch(() => undefined);
    }
  } catch {
    // Optional motion.
  }
}

export function Live2DStage({
  modelUrl,
  coreUrl,
  emotion,
  activity = 'idle',
  expressionMap,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  onReady,
  onError,
}: Live2DStageProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const modelRef = React.useRef<Live2DModel | null>(null);
  const activityRef = React.useRef<PresenceActivity>(activity);
  const onReadyRef = React.useRef(onReady);
  const onErrorRef = React.useRef(onError);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onError, onReady]);

  React.useEffect(() => {
    let disposed = false;
    let app: Application | null = null;
    let model: Live2DModel | null = null;
    let cleanupVisibility: (() => void) | null = null;
    const cubism4 = isCubism4Model(modelUrl);

    const boot = async () => {
      const host = hostRef.current;

      if (!host) {
        return;
      }

      try {
        await loadCubismCore(coreUrl, cubism4);
        const [{ Live2DModel: Model }, { Application: PixiApplication }] = await Promise.all([
          cubism4
            ? import('pixi-live2d-display/cubism4')
            : import('pixi-live2d-display/cubism2'),
          import('pixi.js'),
        ]);

        if (disposed) {
          return;
        }

        app = new PixiApplication({
          resizeTo: host,
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          powerPreference: 'high-performance',
          resolution: Math.min(window.devicePixelRatio || 1, 1.5),
        });
        app.ticker.maxFPS = 60;
        const canvas = app.view as unknown as HTMLCanvasElement;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        host.appendChild(canvas);

        // Pass the app ticker explicitly. `Model.from()` otherwise falls back
        // to a global `PIXI.Ticker.shared`, which does not exist when Pixi is
        // bundled as an ES module. Without a ticker the model's update loop
        // never runs and the stage stays blank.
        model = await Model.from(modelUrl, {
          autoHitTest: false,
          autoFocus: false,
          ticker: app.ticker,
        });

        if (disposed) {
          model.destroy();
          app.destroy(true, { children: true });
          return;
        }

        model.anchor.set(0.5, 0.5);
        const fit = Math.min(
          (app.screen.width * 0.96) / Math.max(model.width, 1),
          (app.screen.height * 0.96) / Math.max(model.height, 1),
        ) * (Number.isFinite(scale) && scale > 0 ? scale : 1);
        model.scale.set(fit);
        model.x = app.screen.width / 2 + offsetX;
        model.y = app.screen.height / 2 + offsetY;
        app.stage.addChild(model);
        modelRef.current = model;
        startIdleMotion(model);

        const core = model.internalModel.coreModel as unknown as {
          setParamFloat?: (id: string, value: number) => void;
          setParameterValueById?: (id: string, value: number) => void;
        } | undefined;
        const setParam = (id4: string, id2: string, value: number) => {
          try {
            core?.setParameterValueById?.(id4, value);
            core?.setParamFloat?.(id2, value);
          } catch {
            // Parameter names differ between Cubism 2 and 4.
          }
        };

        const startedAt = performance.now();
        let blinkUntil = 0;
        let nextBlink = performance.now() + 1800;
        const focusController = (model.internalModel as unknown as {
          focusController?: {
            focus: (x: number, y: number, instant?: boolean) => void;
          };
        }).focusController;

        // Drive the focus controller directly instead of mapping the pointer
        // through the model's projection. That keeps the gaze centered when the
        // pointer leaves, and lets us lower the sensitivity.
        const focusToPointer = (event: PointerEvent) => {
          const rect = host.getBoundingClientRect();

          if (!rect.width || !rect.height || !focusController) {
            return;
          }

          const nx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
          const ny = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
          // The model's focus Y is inverted; scale both axes down so small
          // mouse movements don't throw the head across the screen.
          focusController.focus(nx * 0.55, -ny * 0.38);
        };
        window.addEventListener('pointermove', focusToPointer);
        focusController?.focus(0, 0, true);

        const resetFocus = () => {
          focusController?.focus(0, 0);
        };
        // When the pointer leaves the presence window, relax back to the
        // neutral center pose rather than looking up at a fixed point.
        document.addEventListener('mouseleave', resetFocus);
        window.addEventListener('pointerleave', resetFocus);

        const syncAnimation = () => {
          if (!app || !model) {
            return;
          }

          const now = performance.now();
          const time = (now - startedAt) / 1000;
          const mode = activityRef.current;
          let bodyX = Math.sin(time * 0.35) * 1.4;
          let bodyZ = Math.sin(time * 0.25) * 0.7;

          if (mode === 'thinking') {
            bodyX -= 1.5;
          } else if (mode === 'replying') {
            bodyX += Math.sin(time * 2.6) * 0.6;
          } else if (mode === 'reacting') {
            bodyZ += 4;
          }

          setParam('ParamBodyAngleX', 'PARAM_BODY_ANGLE_X', bodyX);
          setParam('ParamBodyAngleZ', 'PARAM_BODY_ANGLE_Z', bodyZ);
          setParam('ParamBreath', 'PARAM_BREATH', 0.5 + Math.sin(time * 1.8) * 0.35);
          // The companion is text-only: motions may contain mouth curves, so
          // force the mouth closed every frame.
          setParam('ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y', 0);
          setParam('ParamMouthForm', 'PARAM_MOUTH_FORM', 0);

          if (now > nextBlink) {
            blinkUntil = now + 90;
            nextBlink = now + 2200 + Math.random() * 4200;
          }

          const eyeOpen = now < blinkUntil ? 0.05 : 1;
          setParam('ParamEyeLOpen', 'PARAM_EYE_L_OPEN', eyeOpen);
          setParam('ParamEyeROpen', 'PARAM_EYE_R_OPEN', eyeOpen);
        };
        // Run after the motion/expression update, before the model applies its
        // parameters. Writing from the ticker lets motions overwrite the head
        // and produces the "snap back" glitch.
        const internal = model.internalModel as unknown as {
          on: (event: string, listener: () => void) => void;
          off: (event: string, listener: () => void) => void;
        };
        internal.on('beforeModelUpdate', syncAnimation);

        const onVisibility = () => {
          if (!app) {
            return;
          }

          if (document.hidden) {
            app.ticker.stop();
          } else {
            app.ticker.start();
          }
        };
        document.addEventListener('visibilitychange', onVisibility);
        cleanupVisibility = () => {
          document.removeEventListener('visibilitychange', onVisibility);
          document.removeEventListener('mouseleave', resetFocus);
          window.removeEventListener('pointerleave', resetFocus);
          window.removeEventListener('pointermove', focusToPointer);
          internal.off('beforeModelUpdate', syncAnimation);
        };
        setError('');
        onReadyRef.current?.();
      } catch (bootError) {
        const message = bootError instanceof Error ? bootError.message : 'Live2D 加载失败';

        if (!disposed) {
          setError(message);
          onErrorRef.current?.(message);
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
      modelRef.current = null;
      cleanupVisibility?.();
      cleanupVisibility = null;
      app?.ticker.stop();
      model?.destroy();
      app?.destroy(true, { children: true });
    };
  }, [coreUrl, modelUrl, offsetX, offsetY, scale]);

  React.useEffect(() => {
    activityRef.current = activity;
    const model = modelRef.current;

    if (!model) {
      return;
    }

    if (activity === 'idle') {
      startIdleMotion(model);
    } else if (activity === 'thinking') {
      playMotionByKeyword(model, 'anima', /thinking/i);
    }
  }, [activity]);

  React.useEffect(() => {
    const model = modelRef.current;
    const normalizedEmotion = (emotion ?? 'neutral').toLowerCase() as PresenceEmotion;

    if (!model) {
      return;
    }

    const mapped = expressionMap
      ? expressionMap[normalizedEmotion]
      : CUBISM2_EXPRESSION_BY_EMOTION[normalizedEmotion];

    if (mapped === null) {
      resetModelExpression(model);
      return;
    }

    if (!mapped) {
      return;
    }

    try {
      void model.expression(mapped).catch(() => undefined);
    } catch {
      // Missing expression is non-fatal; keep the current face.
    }
  }, [emotion, expressionMap]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {error && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl bg-black/60 px-3 py-2 text-xs text-sky-100/80">
          {error}
        </div>
      )}
    </div>
  );
}
