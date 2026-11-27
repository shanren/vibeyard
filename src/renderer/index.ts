import { appState } from './state.js';
import { planShellOpen, findProjectForDirectory } from './state/shell-open.js';
import { initSidebar } from './components/sidebar.js';
import { initTitleBar } from './components/title-bar.js';
import { initTabBar } from './components/tab-bar.js';
import { initExplorerPanel } from './components/explorer-panel.js';
import { initSplitLayout } from './components/split-layout.js';
import { initKeybindings } from './keybindings.js';
import { handlePtyData, destroyTerminal, updateContextDisplay, applyThemeToAllTerminals, applyFontSizeToAllTerminals, applyScrollbackToAllTerminals, refreshProfileLabels } from './components/terminal-pane.js';
import { setIdle, setHookStatus, notifyInterrupt } from './session-activity.js';
import { parseTitle, clearSession as clearTitleSession } from './session-title.js';
import { setContextData, onChange as onContextChange } from './session-context.js';
import { initNotificationSound } from './notification-sound.js';
import { initNotificationDesktop } from './notification-desktop.js';
import { init as initSessionUnread } from './session-unread.js';
import { initProjectTerminal, handleShellPtyData, handleShellPtyExit, isShellSessionId, applyThemeToAllShells, applyFontSizeToAllShells, applyScrollbackToAllShells } from './components/project-terminal.js';
import { startPolling as startGitPolling } from './git-status.js';
import { initGitPanel } from './components/git-panel.js';
import { initActiveSessions } from './components/active-sessions-panel.js';
import { initSessionHistory } from './components/session-history.js';
import { captureInitialContext } from './session-insights.js';
import { initInsightAlert } from './components/insight-alert.js';
import { initToolDetector } from './tools/missing-tool-detector.js';
import { initToolAlert } from './components/tool-alert.js';
import { initLargeFileDetector } from './tools/large-file-detector.js';
import { initLargeFileAlert } from './components/large-file-alert.js';
import { initSettingsGuard } from './components/settings-guard-ui.js';
import { addEvents as addInspectorEvents } from './session-inspector-state.js';
import type { InspectorEvent } from '../shared/types.js';
import { getContext } from './session-context.js';
import { initSessionInspector } from './components/session-inspector.js';
import { loadProviderMetas } from './provider-availability.js';
import { setLocale as setI18nLocale, getLocale } from './i18n.js';
import { resolveSystemLocale } from './system-locale.js';
import { rerenderOpenPreferencesModal } from './components/preferences-modal.js';
import type { Locale } from '../shared/types.js';

// Startup timing (see the matching instrumentation in src/main/main.ts).
// Enabled by main passing ?timing=1 when RCODE_TIMING is set.
const TIMING = new URLSearchParams(location.search).has('timing');
const rendererMarks: [string, number][] = [];
function mark(label: string): void {
  const at = performance.now();
  rendererMarks.push([label, Math.round(at)]);
  if (TIMING) console.log(`[startup] ${label} ${Math.round(at)}ms`);
}

/**
 * Hand the renderer's own timing to the main process once pixels are actually on
 * screen. Reading paint entries any earlier reports nothing, and the gap between
 * "window exists" and "first paint" is exactly what a user perceives as a black
 * screen, so it is worth recording rather than inferring.
 */
function reportStartupTiming(): void {
  const readPaint = (name: string): number | undefined => {
    const entry = performance.getEntriesByName(name)[0];
    return entry ? Math.round(entry.startTime) : undefined;
  };
  const send = (): void => {
    const longFrames = (performance.getEntriesByType('long-animation-frame') as PerformanceEntry[]).map((e) => {
      const frame = e as PerformanceEntry & { duration: number };
      return { start: frame.startTime, duration: frame.duration };
    });
    window.rcode.app.startupReport({
      fcp: readPaint('first-contentful-paint'),
      fp: readPaint('first-paint'),
      timeOrigin: performance.timeOrigin,
      marks: rendererMarks,
      longFrames,
    });
  };

  // Paint entries appear only after the frame is painted, and `buffered: true`
  // does not deliver them here, so poll briefly instead of guessing with rAF.
  let waited = 0;
  const poll = (): void => {
    if (readPaint('first-contentful-paint') !== undefined || waited >= 3000) {
      send();
      return;
    }
    waited += 50;
    setTimeout(poll, 50);
  };
  poll();
}
function initI18n(): void {
  const saved = appState.preferences.locale;
  const initial: Locale = saved ?? resolveSystemLocale(navigator.language);
  setI18nLocale(initial);
  document.documentElement.lang = initial;
  // Persist the resolved locale on first launch so subsequent runs reuse it.
  if (!saved) {
    appState.setPreference('locale', initial);
  }
}
import { getZoomFactor } from './zoom.js';
import { confirmAppClose } from './session-close.js';

let isQuitting = false;
window.rcode.app.onQuitting(() => {
  isQuitting = true;
});

window.rcode.app.onConfirmClose(() => {
  confirmAppClose(() => window.rcode.app.closeConfirmed());
});

async function main(): Promise<void> {
  // Wire PTY data/exit events from main process
  window.rcode.pty.onData((sessionId, data) => {
    if (isShellSessionId(sessionId)) {
      handleShellPtyData(sessionId, data);
    } else {
      handlePtyData(sessionId, data);
      parseTitle(sessionId, data);
      if (data.includes('Interrupted')) {
        notifyInterrupt(sessionId);
      }
    }
  });

  window.rcode.session.onCostData((sessionId, costData) => {
    if (!appState.hasSession(sessionId)) return;
    const contextBefore = getContext(sessionId);
    setContextData(sessionId, costData.context_window);
    captureInitialContext(sessionId, costData.context_window);

    // Bridge the context snapshot into inspector events so the Context tab works.
    // Only emit when it actually changed (avoids filling the event buffer with duplicates).
    const contextAfter = getContext(sessionId);
    if (contextAfter && contextAfter !== contextBefore) {
      const syntheticEvent: InspectorEvent = {
        type: 'status_update',
        timestamp: Date.now(),
        hookEvent: 'StatusLine',
        context_snapshot: {
          total_tokens: contextAfter.totalTokens,
          context_window_size: contextAfter.contextWindowSize,
          used_percentage: contextAfter.usedPercentage,
        },
      };
      addInspectorEvents(sessionId, [syntheticEvent]);
    }
  });

  onContextChange((sessionId, info) => {
    updateContextDisplay(sessionId, info);
    appState.updateSessionContext(sessionId, info);
  });

  // "Open with RCode" from the OS shell: switch to the project if we have it,
  // add it if we don't, and open the file when a file was what got clicked.
  // Runs after the first state load so `appState.projects` is populated.
  let shellOpenWired = false;
  const wireShellOpen = (): void => {
    if (shellOpenWired) return;
    shellOpenWired = true;
    window.rcode.app.onOpenPath?.((target) => {
      void openPathFromShell(target);
    });
    // A cold start from the Explorer context menu stashed its path in the main
    // process; pull it now that state is loaded and the listener is live.
    void Promise.resolve()
      .then(() => window.rcode.app.takePendingOpenPath?.())
      .then((target) => (target ? openPathFromShell(target) : undefined))
      .catch(() => undefined);
  };
  async function openPathFromShell(raw: string): Promise<void> {
    let isDirectory = false;
    try {
      isDirectory = await window.rcode.fs.isDirectory(raw);
    } catch {
      isDirectory = false;
    }
    const plan = planShellOpen(raw, isDirectory);
    if (!plan) return;

    let project = findProjectForDirectory(appState.projects, plan.directory);
    if (!project) {
      project = appState.addProject(plan.name, plan.directory);
    }
    if (!project) return;
    if (appState.activeProjectId !== project.id) appState.setActiveProject(project.id);
    if (plan.file) appState.addFileReaderSession(project.id, plan.file);
  }

  window.rcode.session.onHookStatus((sessionId, status, hookName) => {
    if (!appState.hasSession(sessionId)) return;
    setHookStatus(sessionId, status, hookName);
  });

  window.rcode.session.onInspectorEvents((sessionId, events) => {
    if (!appState.hasSession(sessionId)) return;
    addInspectorEvents(sessionId, events);
  });

  window.rcode.session.onCliSessionId((sessionId, cliSessionId) => {
    // Find the project containing this session and persist the CLI session ID
    const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
    if (project) {
      clearTitleSession(sessionId);
      appState.updateSessionCliId(project.id, sessionId, cliSessionId);
    }
  });

  window.rcode.pty.onExit((sessionId, exitCode) => {
    if (isShellSessionId(sessionId)) {
      handleShellPtyExit(sessionId, exitCode);
    } else if (!isQuitting) {
      // Auto-close the session when CLI exits (skip during app quit to preserve session state)
      const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
      if (project) {
        destroyTerminal(sessionId);
        clearTitleSession(sessionId);
        appState.removeSession(project.id, sessionId);
      }
    }
  });

  // Load provider metadata before components so capabilities are available synchronously
  await loadProviderMetas();
  mark('renderer:provider-metas');

  // Initialize components (per-step timing under RCODE_TIMING)
  const inits: [string, () => void][] = [
    ['session-unread', initSessionUnread], ['sidebar', initSidebar], ['title-bar', initTitleBar],
    ['tab-bar', initTabBar], ['explorer', initExplorerPanel], ['split-layout', initSplitLayout],
    ['keybindings', initKeybindings], ['notif-sound', initNotificationSound], ['notif-desktop', initNotificationDesktop],
    ['project-terminal', initProjectTerminal], ['git-panel', initGitPanel], ['active-sessions', initActiveSessions],
    ['session-history', initSessionHistory], ['insight-alert', initInsightAlert], ['tool-detector', initToolDetector],
    ['tool-alert', initToolAlert], ['large-file-detector', initLargeFileDetector], ['large-file-alert', initLargeFileAlert],
    ['settings-guard', initSettingsGuard], ['session-inspector', initSessionInspector],
    ['git-polling', startGitPolling],
  ];
  for (const [label, fn] of inits) {
    const started = TIMING ? performance.now() : 0;
    fn();
    if (TIMING) console.log(`[startup] init.${label} ${Math.round(performance.now() - started)}ms`);
  }
  mark('renderer:components-init');

  // Log AppState events to debug panel
  const stateEvents = [
    'project-added', 'project-removed', 'project-changed',
    'session-added', 'session-removed', 'session-changed',
    'layout-changed', 'history-changed', 'insights-changed', 'state-loaded',
  ] as const;
  for (const evt of stateEvents) {
    appState.on(evt as Parameters<typeof appState.on>[0], (data) => {
    });
  }

  // Load persisted state
  await appState.load();
  wireShellOpen();
  mark('renderer:state-loaded');

  // Initialize the UI locale before anything else renders strings.
  // Persisted choice wins; otherwise fall back to the OS language and persist
  // it so future launches start in the same locale.
  initI18n();

  // Apply theme from loaded preferences
  // Windows title-bar overlay must follow the theme (VS Code does the same).
  const syncTitleBarOverlay = (theme: 'dark' | 'light') => {
    const dark = theme !== 'light';
    void window.rcode.app.setTitleBarOverlay({
      color: dark ? '#181818' : '#f8f8f8',
      symbolColor: dark ? '#cccccc' : '#1e1e1e',
      height: 35,
    });
  };

  const initialTheme = appState.preferences.theme ?? 'dark';
  document.documentElement.dataset.theme = initialTheme;
  syncTitleBarOverlay(initialTheme);

  // Re-apply theme (and re-theme terminals) whenever preferences change.
  // Also handles locale change: re-translate the open preferences modal in
  // place. Out-of-modal strings (sidebar buttons, tab titles) stay English
  // until a follow-up PR translates them.
  let lastLocale = getLocale();
  appState.on('preferences-changed', () => {
    const theme = appState.preferences.theme ?? 'dark';
    document.documentElement.dataset.theme = theme;
    syncTitleBarOverlay(theme);
    applyThemeToAllTerminals(theme);
    applyThemeToAllShells(theme);
    // Font size lives on the same preferences-changed event.
    applyFontSizeToAllTerminals();
    applyFontSizeToAllShells();
    // Scrollback depth: only affects rows kept from here on, never the past.
    applyScrollbackToAllTerminals();
    applyScrollbackToAllShells();

    const newLocale = appState.preferences.locale;
    if (newLocale && newLocale !== lastLocale) {
      lastLocale = newLocale;
      setI18nLocale(newLocale);
      document.documentElement.lang = newLocale;
      rerenderOpenPreferencesModal();
    }
  });
  // Adding/removing a profile changes whether the status-line profile label is shown.
  appState.on('profiles-changed', () => refreshProfileLabels());

  const savedZoom = getZoomFactor();
  if (savedZoom !== 1.0) window.rcode.zoom.set(savedZoom);

  mark('renderer:ready');
  reportStartupTiming();
}

main().catch(console.error);
