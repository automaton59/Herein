import React from 'react';
import type { Application } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism2';

interface Live2DStageProps {
  modelUrl: string;
  coreUrl: string;
  emotion?: string | null;
  mouthOpen?: number;
}

const EXPRESSION_BY_EMOTION: Record<string, string> = {
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

function loadCubismCore(coreUrl: string) {
  if ((window as unknown as { Live2D?: unknown }).Live2D) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>('script[data-herein-live2d-core]');

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
    script.dataset.hereinLive2dCore = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Live2D core failed to load: ${coreUrl}`));
    document.head.appendChild(script);
  });
}

export function Live2DStage({ modelUrl, coreUrl, emotion, mouthOpen = 0 }: Live2DStageProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const modelRef = React.useRef<Live2DModel | null>(null);
  const mouthRef = React.useRef(0);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let disposed = false;
    let app: Application | null = null;
    let model: Live2DModel | null = null;

    const boot = async () => {
      const host = hostRef.current;

      if (!host) {
        return;
      }

      try {
        await loadCubismCore(coreUrl);
        const [{ Live2DModel: Model }, { Application: PixiApplication }] = await Promise.all([
          import('pixi-live2d-display/cubism2'),
          import('pixi.js'),
        ]);

        if (disposed) {
          return;
        }

        app = new PixiApplication({
          resizeTo: host,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
        const canvas = app.view as unknown as HTMLCanvasElement;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        host.appendChild(canvas);

        model = await Model.from(modelUrl, { autoInteract: false });

        if (disposed) {
          model.destroy();
          app.destroy(true, { children: true });
          return;
        }

        model.anchor.set(0.5, 0.5);
        model.x = app.screen.width / 2;
        model.y = app.screen.height / 2;
        const fit = Math.min(
          (app.screen.width * 0.92) / Math.max(model.width, 1),
          (app.screen.height * 0.92) / Math.max(model.height, 1),
        );
        model.scale.set(fit);
        app.stage.addChild(model);
        modelRef.current = model;

        const syncMouth = () => {
          const core = model?.internalModel.coreModel as unknown as {
            setParamFloat?: (id: string, value: number) => void;
            setParameterValueById?: (id: string, value: number) => void;
          } | undefined;
          const value = Math.max(0, Math.min(1, mouthRef.current));
          core?.setParamFloat?.('PARAM_MOUTH_OPEN_Y', value);
          core?.setParameterValueById?.('ParamMouthOpenY', value);
        };
        app.ticker.add(syncMouth);
        setError('');
      } catch (bootError) {
        if (!disposed) {
          setError(bootError instanceof Error ? bootError.message : 'Live2D 加载失败');
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
      modelRef.current = null;
      model?.destroy();
      app?.destroy(true, { children: true });
    };
  }, [coreUrl, modelUrl]);

  React.useEffect(() => {
    mouthRef.current = mouthOpen;
  }, [mouthOpen]);

  React.useEffect(() => {
    const expression = EXPRESSION_BY_EMOTION[(emotion ?? 'neutral').toLowerCase()];
    const model = modelRef.current;

    if (!model || !expression) {
      return;
    }

    try {
      model.expression(expression);
    } catch {
      // Missing expression is non-fatal; keep the current face.
    }
  }, [emotion]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-x-4 bottom-4 rounded-xl bg-black/60 px-3 py-2 text-xs text-rose-100/80">
          {error}
        </div>
      )}
    </div>
  );
}
