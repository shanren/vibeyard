import { appState } from './state.js';
import { initSidebar, promptNewProject } from './components/sidebar.js';
import { initTitleBar } from './components/title-bar.js';
import { initTabBar } from './components/tab-bar.js';
import { initExplorerPanel } from './components/explorer-panel.js';
import { initSplitLayout } from './components/split-layout.js';
import { initKeybindings } from './keybindings.js';
import { handlePtyData, destroyTerminal, updateCostDisplay, updateContextDisplay, applyThemeToAllTerminals, refreshProfileLabels } from './components/terminal-pane.js';
import { setIdle, setHookStatus, notifyInterrupt } from './session-activity.js';
import { parseCost, setCostData, onChange as onCostChange } from './session-cost.js';
import { parseTitle, clearSession as clearTitleSession } from './session-title.js';
import { setContextData, onChange as onContextChange } from './session-context.js';
import { initNotificationSound } from './notification-sound.js';
import { initNotificationDesktop } from './notification-desktop.js';
import { init as initSessionUnread } from './session-unread.js';
import { initProjectTerminal, handleShellPtyData, handleShellPtyExit, isShellSessionId, applyThemeToAllShells } from './components/project-terminal.js';
import { startPolling as startGitPolling } from './git-status.js';
import { initGitPanel } from './components/git-panel.js';
import { initActiveSessions } from './components/active-sessions-panel.js';
import { disconnectInspector } from './components/mcp-inspector.js';
import { initFilePrompt } from './components/file-prompt.js';
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
import { applyThemeToAllRemoteTerminals } from './components/remote-terminal-pane.js';
import { loadProviderMetas } from './provider-availability.js';
import { setLocale as setI18nLocale, getLocale } from './i18n.js';
import { resolveSystemLocale } from './system-locale.js';
import { rerenderOpenPreferencesModal } from './components/preferences-modal.js';
import type { Locale } from '../shared/types.js';

// Startup timing (see the matching instrumentation in src/main/main.ts).
// Enabled by main passing ?timing=1 when VIBEYARD_TIMING is set.
const TIMING = new URLSearchParams(location.search).has('timing');
function mark(label: string): void {
  if (TIMING) console.log(`[startup] ${label} ${Math.round(performance.now())}ms`);
}
mark('renderer:module-loaded');

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
import { initBoard } from './components/board/board-view.js';
import { initBoardSessionSync } from './board-session-sync.js';
import { getZoomFactor } from './zoom.js';
import { confirmAppClose } from './session-close.js';

let isQuitting = false;
window.vibeyard.app.onQuitting(() => {
  isQuitting = true;
});

window.vibeyard.app.onConfirmClose(() => {
  confirmAppClose(() => window.vibeyard.app.closeConfirmed());
});

async function main(): Promise<void> {
  // Wire PTY data/exit events from main process
  window.vibeyard.pty.onData((sessionId, data) => {
    if (isShellSessionId(sessionId)) {
      handleShellPtyData(sessionId, data);
    } else if (!isMcpSession(sessionId)) {
      handlePtyData(sessionId, data);
      parseCost(sessionId, data);
      parseTitle(sessionId, data);
      if (data.includes('Interrupted')) {
        notifyInterrupt(sessionId);
      }
    }
  });

  window.vibeyard.session.onCostData((sessionId, costData) => {
    if (!appState.hasSession(sessionId)) return;
    setCostData(sessionId, costData);
    const contextBefore = getContext(sessionId);
    setContextData(sessionId, costData.context_window);
    captureInitialContext(sessionId, costData.context_window);

    // Bridge cost/context into inspector events so Costs & Context tabs work.
    // Only emit when context actually changed (avoids filling the event buffer with duplicates).
    const contextAfter = getContext(sessionId);
    if (contextAfter && contextAfter !== contextBefore) {
      const syntheticEvent: InspectorEvent = {
        type: 'status_update',
        timestamp: Date.now(),
        hookEvent: 'StatusLine',
        cost_snapshot: {
          total_cost_usd: costData.cost.total_cost_usd ?? 0,
          total_duration_ms: costData.cost.total_duration_ms ?? 0,
        },
        context_snapshot: {
          total_tokens: contextAfter.totalTokens,
          context_window_size: contextAfter.contextWindowSize,
          used_percentage: contextAfter.usedPercentage,
        },
      };
      addInspectorEvents(sessionId, [syntheticEvent]);
    }
  });

  onCostChange((sessionId, cost) => {
    updateCostDisplay(sessionId, cost);
    appState.updateSessionCost(sessionId, cost);
  });

  onContextChange((sessionId, info) => {
    updateContextDisplay(sessionId, info);
    appState.updateSessionContext(sessionId, info);
  });

  window.vibeyard.session.onHookStatus((sessionId, status, hookName) => {
    if (!appState.hasSession(sessionId)) return;
    setHookStatus(sessionId, status, hookName);
  });

  window.vibeyard.session.onInspectorEvents((sessionId, events) => {
    if (!appState.hasSession(sessionId)) return;
    addInspectorEvents(sessionId, events);
  });

  window.vibeyard.session.onCliSessionId((sessionId, cliSessionId) => {
    // Find the project containing this session and persist the CLI session ID
    const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
    if (project) {
      clearTitleSession(sessionId);
      appState.updateSessionCliId(project.id, sessionId, cliSessionId);
    }
  });

  window.vibeyard.pty.onExit((sessionId, exitCode) => {
    if (isShellSessionId(sessionId)) {
      handleShellPtyExit(sessionId, exitCode);
    } else if (!isMcpSession(sessionId) && !isQuitting) {
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

  // Initialize components
  initSessionUnread();
  initSidebar();
  initTitleBar();
  initTabBar();
  initExplorerPanel();
  initSplitLayout();
  initKeybindings();
  initNotificationSound();
  initNotificationDesktop();
  initProjectTerminal();
  initGitPanel();
  initActiveSessions();
  initSessionHistory();
  initInsightAlert();
  initToolDetector();
  initToolAlert();
  initLargeFileDetector();
  initLargeFileAlert();
  initSettingsGuard();
  initSessionInspector();
  initBoard();
  initBoardSessionSync();
  initFilePrompt();
  startGitPolling();
  mark('renderer:components-init');

  function isMcpSession(sessionId: string): boolean {
    for (const project of appState.projects) {
      const session = project.sessions.find(s => s.id === sessionId);
      if (session) return session.type === 'mcp-inspector';
    }
    return false;
  }

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
  mark('renderer:state-loaded');

  // Initialize the UI locale before anything else renders strings.
  // Persisted choice wins; otherwise fall back to the OS language and persist
  // it so future launches start in the same locale.
  initI18n();

  // Apply theme from loaded preferences
  const initialTheme = appState.preferences.theme ?? 'dark';
  document.documentElement.dataset.theme = initialTheme;

  // Re-apply theme (and re-theme terminals) whenever preferences change.
  // Also handles locale change: re-translate the open preferences modal in
  // place. Out-of-modal strings (sidebar buttons, tab titles) stay English
  // until a follow-up PR translates them.
  let lastLocale = getLocale();
  appState.on('preferences-changed', () => {
    const theme = appState.preferences.theme ?? 'dark';
    document.documentElement.dataset.theme = theme;
    applyThemeToAllTerminals(theme);
    applyThemeToAllShells(theme);
    applyThemeToAllRemoteTerminals(theme);

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
  if (savedZoom !== 1.0) window.vibeyard.zoom.set(savedZoom);

  // Auto-open new project modal when no projects exist
  if (appState.projects.length === 0) {
    promptNewProject();
  }

  mark('renderer:ready');
}

main().catch(console.error);
