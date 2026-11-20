import { describe, it, expect, vi } from 'vitest';

// main.ts pulls in Electron; only the pure argv parser is under test here.
vi.mock('electron', () => ({
  app: { getAppPath: () => '', getPath: () => '', whenReady: () => Promise.resolve(), on: vi.fn(), quit: vi.fn(), requestSingleInstanceLock: () => true, disableHardwareAcceleration: vi.fn(), getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }), getVersion: () => '0.0.1' },
  BrowserWindow: class {},
  dialog: {},
  powerMonitor: { on: vi.fn() },
  shell: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}));
vi.mock('./ipc-handlers', () => ({ registerIpcHandlers: vi.fn(), resetHookWatcher: vi.fn() }));
vi.mock('./pty-manager', () => ({ killAllPtys: vi.fn(), getFullPath: () => '' }));
vi.mock('./store', () => ({ flushState: vi.fn(), loadState: () => ({ preferences: {} }) }));
vi.mock('./menu', () => ({ createAppMenu: vi.fn() }));
vi.mock('./hook-status', () => ({ restartAndResync: vi.fn() }));
vi.mock('./providers/registry', () => ({ initProviders: vi.fn(), getAllProviders: () => [] }));
vi.mock('./git-watcher', () => ({ stopGitWatcher: vi.fn() }));
vi.mock('./file-watcher', () => ({ stopAllFileWatchers: vi.fn() }));
vi.mock('./prerequisites', () => ({ checkPythonAvailable: () => null }));
vi.mock('./close-state', () => ({ isCloseConfirmed: () => true, setCloseConfirmed: vi.fn() }));

import { extractOpenPath } from './main';

const ABS = 'E:/workspace/vibeyard';

describe('extractOpenPath', () => {
  it('ignores a dev launch with no path (`.` is not an absolute path)', () => {
    expect(extractOpenPath(['electron.exe', '.'], ABS)).toBeNull();
  });

  it('ignores flags', () => {
    expect(extractOpenPath(['RCode.exe', '--inspect', '.'], ABS)).toBeNull();
  });

  it('returns the hand-off path in OS-native form', () => {
    const appDir = 'C:/Program Files/RCode/resources/app.asar';
    // Resolved with the platform's separator so the stored project path matches
    // what fs/watchers/git report on this OS.
    expect(extractOpenPath(['RCode.exe', 'E:/workspace/vibeyard'], appDir)).toBe(
      require('path').resolve('E:/workspace/vibeyard'),
    );
  });

  it('ignores the app directory itself', () => {
    expect(extractOpenPath(['electron.exe', ABS], ABS)).toBeNull();
  });

  it('rejects paths that do not exist', () => {
    expect(extractOpenPath(['RCode.exe', 'E:/definitely/not/here'], ABS)).toBeNull();
  });
});
