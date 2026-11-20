import { app, BrowserWindow, dialog, powerMonitor, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ipcMain } from 'electron';
import { registerIpcHandlers, resetHookWatcher } from './ipc-handlers';
import { killAllPtys } from './pty-manager';
import { flushState, loadState } from './store';
import { createAppMenu } from './menu';
import { restartAndResync } from './hook-status';
import { initProviders, getAllProviders } from './providers/registry';
import { stopGitWatcher } from './git-watcher';
import { stopAllFileWatchers } from './file-watcher';
import { checkPythonAvailable } from './prerequisites';
import { isMac, isWin } from './platform';
import { isCloseConfirmed, setCloseConfirmed } from './close-state';
import { isAbsolutePath, normalizeShellPath } from '../shared/platform';

let mainWindow: BrowserWindow | null = null;

/**
 * A folder (or file) handed to us by the OS — a file-manager context menu entry,
 * a `rcode <path>` invocation, or a second-instance launch. It is forwarded to the
 * renderer, which owns the project list, once that window is ready.
 */
let pendingOpenPath: string | null = null;

/**
 * Pull the path out of a command line. Packaged launches arrive as
 * `RCode.exe "<path>"`; dev launches as `electron . "<path>"` — in both cases the
 * path is whatever argv entry exists after the first one that is neither a flag
 * nor the app directory.
 */
export function extractOpenPath(argv: string[], appPath: string): string | null {
  const rest = argv.slice(1).filter((arg) => {
    if (!arg || arg.startsWith('-')) return false;
    // Only absolute paths count. A dev launch is `electron .`, and `.` would
    // otherwise resolve against the cwd and register the app dir as a project.
    if (!isAbsolutePath(arg)) return false;
    if (appPath && normalizeShellPath(arg) === normalizeShellPath(appPath)) return false;
    return true;
  });
  const candidate = rest[rest.length - 1];
  if (!candidate) return null;
  const normalized = normalizeShellPath(candidate);
  try {
    // Only hand over paths that exist; a stray argv entry must not add a project.
    // Resolve to the OS-native form so the project path we store matches what the
    // rest of the app (fs, watchers, git) sees on this platform.
    if (fs.existsSync(normalized)) return path.resolve(normalized);
  } catch {
    return null;
  }
  return null;
}

function openPathInWindow(win: BrowserWindow, target: string): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('app:openPath', target);
}

/** Focus the existing window and forward the path, or remember it until ready. */
function requestOpenPath(target: string): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    openPathInWindow(win, target);
    return;
  }
  pendingOpenPath = target;
}

// Startup timing instrumentation. Enable with RCODE_TIMING=1; every mark
// prints "[startup] <label> <ms since process start>" so cold-start work can be
// attributed to a phase. Used as the verification instrument for the
// fast-startup effort; harmless when disabled.
const TIMING = !!process.env.RCODE_TIMING;
function mark(label: string): void {
  if (TIMING) console.log(`[startup] ${label} ${Math.round(process.uptime() * 1000)}ms`);
}
mark('main:module-loaded');

function requestConfirmClose(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:confirmClose');
  } else {
    setCloseConfirmed(true);
    app.quit();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'RCode',
    icon: path.join(__dirname, '..', '..', '..', 'build', 'icon.png'),
    backgroundColor: '#000000',
    // The app draws its own 35px title bar on every platform, so the native
    // frame is hidden everywhere. Windows keeps the system min/max/close
    // buttons via titleBarOverlay (tinted to the dark chrome); macOS keeps its
    // traffic lights inset at the same height.
    ...(isWin ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#181818', symbolColor: '#cccccc', height: 35 },
    } : isMac ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 12, y: 11 },
    } : {
      titleBarStyle: 'hidden' as const,
    }),
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for node-pty IPC
    },
  });

  mainWindow.loadFile(
    path.join(__dirname, '..', '..', 'renderer', 'index.html'),
    TIMING ? { query: { timing: '1' } } : undefined,
  );

  mainWindow.webContents.on('did-finish-load', () => {
    if (TIMING) mark('main:did-finish-load');
    // NOTE: a pending OS hand-off is NOT pushed from here. `did-finish-load` fires
    // before the renderer has registered its listener (it wires up after loading
    // state), so a push would be dropped *and* clear the pending path before the
    // renderer can pull it. The renderer calls app:takePendingOpenPath instead;
    // only the already-running case (second-instance) pushes.
  });

  if (TIMING) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log(`[renderer] ${message}`);
    });
  }

  // Open external links in default browser instead of inside the app
  const isHttpUrl = (url: string) => url.startsWith('http://') || url.startsWith('https://');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isCloseConfirmed()) {
      event.preventDefault();
      requestConfirmClose();
      return;
    }
    flushState();
  });

  mainWindow.on('closed', () => {
    killAllPtys();
    resetHookWatcher();
    stopAllFileWatchers();
    mainWindow = null;
  });
}

// One instance only: this process owns the state file, and a second instance would
// overwrite it. A second launch — icon double-click, or a context-menu entry while
// we are already running — forwards its path here instead of starting over.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const target = extractOpenPath(argv, app.getAppPath());
    if (target) {
      requestOpenPath(target);
      return;
    }
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // macOS hands paths to an already-running app through `open-file`, not argv.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    requestOpenPath(normalizeShellPath(filePath));
  });
}

app.whenReady().then(async () => {
  initProviders();
  mark('main:providers-inited');

  registerIpcHandlers();
  mark('main:ipc-registered');

  // Cold start from a context-menu entry / `rcode <path>`. The renderer pulls this
  // once it has loaded its state (app:takePendingOpenPath) — pushing it from here
  // raced with the listener registration whenever startup was slow.
  const initialPath = extractOpenPath(process.argv, app.getAppPath());
  if (initialPath) pendingOpenPath = initialPath;

  // The renderer asks for this right after loading state: the hand-off cannot be
  // pushed from here because the listener does not exist yet.
  ipcMain.handle('app:takePendingOpenPath', () => {
    const target = pendingOpenPath;
    pendingOpenPath = null;
    return target;
  });
  const state = loadState();
  mark('main:state-loaded');
  createAppMenu(state.preferences?.debugMode ?? false);
  createWindow();
  mark('main:window-created');

  // Post-first-paint work. This used to run right after createWindow(), where the
  // synchronous `python --version` probe and the provider hook installs blocked the
  // main thread and stalled the renderer's `store:load` for seconds — on Windows
  // that delayed the first usable window and could drop an OS hand-off entirely.
  const runDeferredStartupWork = async (): Promise<void> => {
    // Provider validation used to run before the window existed, so every launch
    // paid for seven `where`/`which` spawns before anything was on screen. Its
    // only job is the "no CLI installed" error box, so it belongs here.
    const providers = getAllProviders();
    // Memoised: each check is a synchronous `where`/`which` spawn, and the same
    // answers are needed again below. Re-running them cost ~415ms of blocked
    // main thread per pass.
    const availability = new Map<string, boolean>();
    const isAvailable = (p: (typeof providers)[number]): boolean => {
      const cached = availability.get(p.meta.id);
      if (cached !== undefined) return cached;
      const ok = p.validatePrerequisites();
      availability.set(p.meta.id, ok);
      return ok;
    };
    const missing = providers.filter((p) => !isAvailable(p));
    for (const p of missing) console.warn('Provider not available: ' + p.meta.displayName);
    if (providers.length > 0 && missing.length === providers.length) {
      const bullets = providers.map((p) => '  - ' + p.meta.displayName).join('\n');
      dialog.showErrorBox(
        'RCode - No CLI Provider Found',
        'RCode needs at least one supported CLI provider installed to run.\n\n' +
          'Install one of the following, then restart RCode:\n\n' + bullets,
      );
      setCloseConfirmed(true);
      app.quit();
      return;
    }

    const pythonWarning = checkPythonAvailable();
    if (pythonWarning) {
      console.warn(pythonWarning);
      if (mainWindow && !mainWindow.isDestroyed()) {
        void dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'RCode — Python Not Found',
          message: pythonWarning,
        });
      }
    }

    // Install hooks and status scripts for available providers. Yield to the
    // event loop between providers so renderer IPC (state load, PTY spawn) is
    // not held behind this loop.
    for (const provider of providers) {
      if (!isAvailable(provider)) continue;
      await new Promise((resolve) => setImmediate(resolve));
      try {
        await provider.installHooks(mainWindow);
        provider.installStatusScripts();
      } catch (err) {
        console.warn('Provider startup work failed:', err);
      }
    }
    mark('main:deferred-work-done');
  };

  const win = mainWindow;
  if (win) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => void runDeferredStartupWork(), 0);
    });
  }

  mark('main:ready');

  if (TIMING) setTimeout(() => app.exit(0), 12000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        restartAndResync(win);
      }
    }
  });

  powerMonitor.on('resume', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      restartAndResync(win);
    }
  });
});

app.on('before-quit', (event) => {
  if (!isCloseConfirmed()) {
    event.preventDefault();
    requestConfirmClose();
    return;
  }
  flushState();
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:quitting');
  }
  killAllPtys();
  stopGitWatcher();
  stopAllFileWatchers();
  // Cleanup all providers
  for (const provider of getAllProviders()) {
    provider.cleanup();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
