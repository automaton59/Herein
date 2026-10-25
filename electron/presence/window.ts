import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PresenceBounds {
  x: number;
  y: number;
}

export interface PresenceWindowOptions {
  preloadPath: string;
  isDev: boolean;
  devUrl: string;
  productionHtmlPath: string;
  getSavedPosition: () => PresenceBounds | null;
  savePosition: (position: PresenceBounds) => void;
}

const PRESENCE_WIDTH = 380;
const PRESENCE_HEIGHT = 560;

function defaultPosition(): PresenceBounds {
  const { workArea } = screen.getPrimaryDisplay();

  return {
    x: Math.round(workArea.x + workArea.width - PRESENCE_WIDTH - 28),
    y: Math.round(workArea.y + workArea.height - PRESENCE_HEIGHT - 20),
  };
}

function clampPosition(position: PresenceBounds): PresenceBounds {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(position.x + PRESENCE_WIDTH / 2),
    y: Math.round(position.y + PRESENCE_HEIGHT / 2),
  });
  const { workArea } = display;

  // Keep the whole window on screen. Letting it hang off the left edge used to
  // put it in the zone Windows treats as a snap target, and the snap resize
  // made the presence window grow every time it was dragged that way.
  return {
    x: Math.min(
      Math.max(Math.round(position.x), workArea.x),
      Math.max(workArea.x, workArea.x + workArea.width - PRESENCE_WIDTH),
    ),
    y: Math.min(
      Math.max(Math.round(position.y), workArea.y),
      Math.max(workArea.y, workArea.y + workArea.height - PRESENCE_HEIGHT),
    ),
  };
}

export class PresenceWindowManager {
  private win: BrowserWindow | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: PresenceWindowOptions) {}

  get window() {
    return this.win;
  }

  isVisible() {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  ensure(alwaysOnTop: boolean) {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }

    const saved = this.options.getSavedPosition();
    const position = clampPosition(saved ?? defaultPosition());
    const win = new BrowserWindow({
      width: PRESENCE_WIDTH,
      height: PRESENCE_HEIGHT,
      // The presence window has a fixed layout. Pinning min and max to the same
      // value keeps Windows from snapping/resizing it while it is being dragged
      // near a screen edge.
      minWidth: PRESENCE_WIDTH,
      maxWidth: PRESENCE_WIDTH,
      minHeight: PRESENCE_HEIGHT,
      maxHeight: PRESENCE_HEIGHT,
      x: position.x,
      y: position.y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop,
      acceptFirstMouse: true,
      title: '此间 · 桌面形象',
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    win.setMenu(null);
    win.setAlwaysOnTop(alwaysOnTop, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Belt and braces: if the OS still resizes the window (snap assist, a DPI
    // migration between monitors, ...), restore the canonical size instead of
    // letting the transparent layout expand.
    let pinningSize = false;
    const pinSize = () => {
      if (pinningSize || win.isDestroyed()) {
        return;
      }

      const bounds = win.getBounds();

      if (bounds.width === PRESENCE_WIDTH && bounds.height === PRESENCE_HEIGHT) {
        return;
      }

      pinningSize = true;
      const next = clampPosition({ x: bounds.x, y: bounds.y });

      win.setBounds({
        x: next.x,
        y: next.y,
        width: PRESENCE_WIDTH,
        height: PRESENCE_HEIGHT,
      });

      setTimeout(() => {
        pinningSize = false;
      }, 80);
    };

    win.on('resize', pinSize);

    // The presence HUD is a fixed-size overlay; a stray pinch/Ctrl+wheel zoom
    // would scale the whole layout inside the window and make it look like the
    // window itself grew. Pin the zoom level.
    void win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
    win.webContents.setZoomFactor(1);
    win.webContents.on('zoom-changed', () => {
      win.webContents.setZoomFactor(1);
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      const devUrl = this.options.devUrl;
      const prodRoot = pathToFileURL(path.dirname(this.options.productionHtmlPath)).href;
      const allowed = this.options.isDev
        ? url.startsWith(devUrl)
        : url.startsWith(prodRoot);

      if (!allowed) {
        event.preventDefault();
      }
    });

    win.on('moved', () => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }

      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;

        if (this.win && !this.win.isDestroyed()) {
          const [x, y] = this.win.getPosition();
          this.options.savePosition({ x, y });
        }
      }, 400);
    });

    win.once('ready-to-show', () => {
      win.showInactive();
    });

    win.on('closed', () => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.win = null;
    });

    if (this.options.isDev) {
      const url = new URL(this.options.devUrl);
      url.searchParams.set('presence', '1');
      void win.loadURL(url.toString());
    } else {
      void win.loadFile(this.options.productionHtmlPath, { query: { presence: '1' } });
    }

    this.win = win;
    return win;
  }

  show(alwaysOnTop: boolean) {
    const win = this.ensure(alwaysOnTop);
    win.setAlwaysOnTop(alwaysOnTop, 'floating');
    win.showInactive();
    return win;
  }

  hide() {
    this.win?.hide();
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }

    this.win = null;
  }

  setAlwaysOnTop(value: boolean) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.setAlwaysOnTop(value, 'floating');
    }
  }

  send(channel: string, payload: unknown) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  getBounds(): PresenceBounds {
    if (!this.win || this.win.isDestroyed()) {
      return defaultPosition();
    }

    const [x, y] = this.win.getPosition();
    return { x, y };
  }

  moveTo(position: PresenceBounds) {
    const win = this.win;

    if (!win || win.isDestroyed()) {
      return;
    }

    const next = clampPosition(position);

    // Always pass the size as well: a bare setPosition keeps whatever bounds the
    // OS last applied, which is how the window crept larger while dragging.
    win.setBounds({
      x: next.x,
      y: next.y,
      width: PRESENCE_WIDTH,
      height: PRESENCE_HEIGHT,
    });
  }

  reload() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.reload();
    }
  }
}
