/**
 * Browser harness for the renderer.
 *
 * The renderer talks to the outside world only through `window.vibeyard`
 * (the preload bridge). This file installs a fixture-backed stand-in for that
 * bridge so `dist/renderer/index.html` can be opened in a plain browser and the
 * whole UI can be iterated on without rebuilding/relaunching Electron.
 *
 * Only the surface the renderer actually calls is implemented; everything else
 * resolves to an empty result. Data is in-memory: refresh resets it.
 */

/* eslint-disable no-console */

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60_000).toISOString();

const PROJECTS = [
  {
    id: 'p-qis',
    name: 'QIS',
    path: 'E:\\Project\\QIS',
    activeSessionId: 'p-qis-1',
    layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
    defaultProfileId: undefined,
    sessions: [
      {
        id: 'p-qis-1',
        name: 'Refactor auth middleware',
        cliSessionId: '3f9c1a2e-7b44-4c6d-9d21-1a2b3c4d5e6f',
        providerId: 'claude',
        createdAt: iso(42),
      },
      {
        id: 'p-qis-2',
        name: 'Fix flaky upload test',
        cliSessionId: null,
        providerId: 'codex',
        createdAt: iso(12),
      },
      {
        id: 'p-qis-3',
        name: 'state.ts',
        type: 'file-reader',
        fileReaderPath: 'src/renderer/state.ts',
        cliSessionId: null,
        createdAt: iso(6),
      },
    ],
    sessionHistory: [
      { id: 'h-1', name: 'Add retry to uploader', cliSessionId: 'a1b2c3d4-0000-4000-8000-000000000001', providerId: 'claude', closedAt: iso(120), createdAt: iso(200) },
      { id: 'h-2', name: 'Split session store', cliSessionId: 'a1b2c3d4-0000-4000-8000-000000000002', providerId: 'claude', closedAt: iso(60), createdAt: iso(140) },
    ],
  },
  {
    id: 'p-portal',
    name: 'Customer portal',
    path: 'E:\\Project\\portal',
    activeSessionId: null,
    layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
    sessions: [
      { id: 'p-portal-1', name: 'Migrate billing flow', cliSessionId: 'b2c3d4e5-0000-4000-8000-000000000003', providerId: 'claude', createdAt: iso(90) },
    ],
    sessionHistory: [],
  },
  {
    id: 'p-infra',
    name: 'infra-terraform',
    path: 'E:\\Project\\infra',
    activeSessionId: null,
    layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
    sessions: [],
    sessionHistory: [],
  },
];

const state = {
  version: 1,
  projects: PROJECTS,
  activeProjectId: 'p-qis',
  preferences: {
    theme: 'dark',
    locale: 'en',
    debugMode: false,
    defaultProvider: 'claude',
    sidebarViews: { gitPanel: true, sessionHistory: true, fileTree: true, activeSessions: true },
    activeSessionStatuses: { working: true, waiting: false, input: true, completed: true },
  },
  profiles: [
    { id: 'prof-work', name: 'Work', providerId: 'claude', configDir: 'C:\\Users\\dev\\.vibeyard\\profiles\\work', managed: true, createdAt: NOW },
  ],
  sidebarWidth: 300,
  sidebarCollapsed: false,
  explorerPanelOpen: false,
};

const GIT_STATUS = {
  'p-qis': { isGitRepo: true, branch: 'feat/terminal-polish', ahead: 2, behind: 0, staged: 1, modified: 3, untracked: 1, conflicted: 0 },
  'p-portal': { isGitRepo: true, branch: 'main', ahead: 0, behind: 1, staged: 0, modified: 0, untracked: 0, conflicted: 0 },
  'p-infra': { isGitRepo: false, branch: null, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0 },
};

const GIT_FILES = {
  'p-qis': [
    { path: 'src/renderer/components/terminal-pane.ts', status: 'modified', area: 'staged' },
    { path: 'src/renderer/state.ts', status: 'modified', area: 'working' },
    { path: 'src/renderer/styles/sidebar.css', status: 'modified', area: 'working' },
    { path: 'src/main/ipc-handlers.ts', status: 'modified', area: 'working' },
    { path: 'specs/notes.md', status: 'untracked', area: 'untracked' },
  ],
  'p-portal': [],
  'p-infra': [],
};

const TREE = {
  '': [
    { name: 'src', path: 'src', isDirectory: true },
    { name: 'specs', path: 'specs', isDirectory: true },
    { name: 'package.json', path: 'package.json', isDirectory: false },
    { name: 'README.md', path: 'README.md', isDirectory: false },
    { name: 'tsconfig.json', path: 'tsconfig.json', isDirectory: false },
  ],
  src: [
    { name: 'main', path: 'src/main', isDirectory: true },
    { name: 'renderer', path: 'src/renderer', isDirectory: true },
    { name: 'shared', path: 'src/shared', isDirectory: true },
  ],
  'src/renderer': [
    { name: 'components', path: 'src/renderer/components', isDirectory: true },
    { name: 'styles', path: 'src/renderer/styles', isDirectory: true },
    { name: 'index.ts', path: 'src/renderer/index.ts', isDirectory: false },
    { name: 'state.ts', path: 'src/renderer/state.ts', isDirectory: false },
    { name: 'styles.css', path: 'src/renderer/styles.css', isDirectory: false },
  ],
  'src/renderer/components': [
    { name: 'sidebar.ts', path: 'src/renderer/components/sidebar.ts', isDirectory: false },
    { name: 'tab-bar', path: 'src/renderer/components/tab-bar', isDirectory: true },
    { name: 'terminal-pane.ts', path: 'src/renderer/components/terminal-pane.ts', isDirectory: false },
    { name: 'file-tree.ts', path: 'src/renderer/components/file-tree.ts', isDirectory: false },
  ],
  specs: [
    { name: '2026-11-18-vscode-design-tokens.md', path: 'specs/2026-11-18-vscode-design-tokens.md', isDirectory: false },
  ],
};

const FILE_CONTENT = {
  'src/renderer/state.ts': `import type { ProjectRecord, SessionRecord } from '../shared/types.js';

export const MAX_SESSION_NAME_LENGTH = 60;

/** Reactive singleton: components subscribe, mutations emit. */
export class AppState {
  private state: PersistedState;

  get projects(): ProjectRecord[] {
    return this.state.projects;
  }

  get activeProject(): ProjectRecord | undefined {
    return this.state.projects.find((p) => p.id === this.state.activeProjectId);
  }

  setActiveProject(id: string): void {
    this.state.activeProjectId = id;
    this.persist();
    this.emit('project-changed');
  }
}
`,
  'package.json': `{
  "name": "vibeyard",
  "version": "0.0.1",
  "scripts": {
    "build": "tsc -p tsconfig.main.json && npm run build:renderer",
    "test": "vitest run"
  }
}
`,
};

const PROVIDERS = [
  { id: 'claude', displayName: 'Claude Code', capabilities: { resume: true, hooks: true, hookStatus: true, cost: true, pendingPromptTrigger: 'startup-arg' } },
  { id: 'codex', displayName: 'Codex CLI', capabilities: { resume: true, hooks: true, hookStatus: true, cost: false, pendingPromptTrigger: 'first-output' } },
  { id: 'copilot', displayName: 'Copilot CLI', capabilities: { resume: true, hooks: true, hookStatus: true, cost: false } },
  { id: 'gemini', displayName: 'Gemini CLI', capabilities: { resume: true, hooks: true, hookStatus: true, cost: false } },
  { id: 'pi', displayName: 'Pi', capabilities: { resume: true, hooks: false, hookStatus: false } },
  { id: 'opencode', displayName: 'OpenCode', capabilities: { resume: true, hooks: false, hookStatus: false } },
  { id: 'custom', displayName: 'Custom CLI', capabilities: { resume: false, hooks: false, hookStatus: false, cost: false } },
];

const listeners = new Map();

/** Register a channel listener; returns the unsubscribe the renderer expects. */
function on(channel, cb) {
  const set = listeners.get(channel) ?? new Set();
  set.add(cb);
  listeners.set(channel, set);
  return () => set.delete(cb);
}

/** Fire a channel (used by the harness controls in dev/index.html). */
function emit(channel, ...args) {
  for (const cb of listeners.get(channel) ?? []) {
    try {
      cb(...args);
    } catch (err) {
      console.error('[mock]', channel, err);
    }
  }
}

const noop = () => {};
const resolved = (value) => Promise.resolve(value);
const unsubscribe = () => noop;

const api = {
  pty: {
    create: () => resolved(),
    createShell: () => resolved(),
    write: noop,
    resize: noop,
    kill: () => resolved(),
    getCwd: () => resolved('E:\\Project\\QIS'),
    onData: unsubscribe,
    onExit: unsubscribe,
  },
  session: {
    buildResumeWithPrompt: () => '',
    transcriptExists: () => resolved(true),
    transcriptExistsSync: () => true,
    deepSearch: () => resolved([]),
    projectTranscripts: () => resolved([]),
    onHookStatus: unsubscribe,
    onCliSessionId: unsubscribe,
    onClaudeSessionId: unsubscribe,
    onCostData: unsubscribe,
    onToolFailure: unsubscribe,
    onInspectorEvents: unsubscribe,
  },
  fs: {
    isDirectory: () => resolved(true),
    expandPath: (p) => resolved(p),
    listDirs: () => resolved([]),
    listDir: (_projectPath, rel) => resolved(TREE[rel ?? ''] ?? []),
    browseDirectory: () => resolved(null),
    listFiles: () => resolved(Object.keys(TREE).flatMap((k) => TREE[k].filter((e) => !e.isDirectory).map((e) => e.path))),
    searchFiles: () => resolved([]),
    topFilesByTokens: () => resolved({ files: [], totalTokens: 0 }),
    exists: () => resolved(true),
    readFile: (_p, rel) => resolved({ ok: true, content: FILE_CONTENT[rel] ?? `// fixture: ${rel}\n` }),
    writeFile: () => resolved(),
    stat: () => resolved({ exists: true, isDirectory: false, size: 1024, mtimeMs: NOW }),
    readImage: () => resolved(null),
    trashItem: () => resolved(),
    openInFolder: () => resolved(),
    watchDir: noop,
    unwatchDir: noop,
    onFsChange: unsubscribe,
    getDroppedFilePath: () => null,
  },
  store: {
    load: () => resolved(JSON.parse(JSON.stringify(state))),
    save: (next) => {
      Object.assign(state, next);
      return resolved();
    },
  },
  profiles: {
    provision: (id) => resolved({ configDir: `C:\\fixture\\${id}`, managed: true }),
    keychainStatus: () => resolved({ status: 'supported', version: '2.1.159' }),
  },
  provider: {
    getConfig: () => resolved({ mcpServers: [], agents: [], skills: [], commands: [] }),
    getMeta: (id) => resolved(PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]),
    listProviders: () => resolved(PROVIDERS),
    checkBinary: () => resolved(true),
    watchProject: noop,
    onConfigChanged: unsubscribe,
  },
  git: {
    getStatus: (projectPath) => {
      const key = PROJECTS.find((p) => p.path === projectPath)?.id ?? 'p-qis';
      return resolved(GIT_STATUS[key]);
    },
    getFiles: (projectPath) => {
      const key = PROJECTS.find((p) => p.path === projectPath)?.id ?? 'p-qis';
      return resolved(GIT_FILES[key] ?? []);
    },
    getDiff: () => resolved('--- a/file\n+++ b/file\n@@ -1,3 +1,4 @@\n context\n-removed line\n+added line\n+another line\n'),
    getWorktrees: () => resolved([]),
    getRemoteUrl: () => resolved('git@github.com:acme/qis.git'),
    stageFile: () => resolved(),
    unstageFile: () => resolved(),
    discardFile: () => resolved(),
    openInEditor: () => resolved(),
    listBranches: () => resolved([{ name: 'feat/terminal-polish', current: true }, { name: 'main', current: false }]),
    checkoutBranch: () => resolved(),
    createBranch: () => resolved(),
    watchProject: noop,
    onChanged: unsubscribe,
  },
  app: {
    focus: noop,
    getVersion: () => resolved('0.0.1'),
    setTitleBarOverlay: () => resolved(),
    openExternal: () => resolved(),
    onQuitting: unsubscribe,
    onConfirmClose: unsubscribe,
    closeConfirmed: noop,
  },
  mcp: {
    connect: () => resolved({ success: true, data: {} }),
    disconnect: () => resolved({ success: true }),
    listTools: () => resolved({ success: true, data: [] }),
    listResources: () => resolved({ success: true, data: [] }),
    listPrompts: () => resolved({ success: true, data: [] }),
    callTool: () => resolved({ success: true, data: {} }),
    readResource: () => resolved({ success: true, data: {} }),
    getPrompt: () => resolved({ success: true, data: {} }),
  },
  settings: {
    onWarning: unsubscribe,
    onConflictDialog: unsubscribe,
    respondConflictDialog: noop,
    reinstall: () => resolved(),
    validate: () => resolved({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} }),
  },
  clipboard: {
    write: (text) => navigator.clipboard?.writeText(text),
  },
  zoom: {
    set: noop,
  },
  menu: {
    onNewProject: unsubscribe,
    onNewSession: unsubscribe,
    onToggleSplit: unsubscribe,
    onNextSession: unsubscribe,
    onPrevSession: unsubscribe,
    onGotoSession: unsubscribe,
    onToggleInspector: unsubscribe,
    onCloseSession: unsubscribe,
    rebuild: noop,
    runEditAction: noop,
    toggleDevTools: noop,
    reloadMainWindow: noop,
    quitApp: noop,
  },
};

window.vibeyard = api;
// Exposed so a harness page can simulate main-process pushes.
window.__mock = { state, emit, listeners };

console.info('[mock] window.vibeyard installed (browser harness)');
