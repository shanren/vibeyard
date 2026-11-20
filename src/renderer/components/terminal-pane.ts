import { Terminal } from '@xterm/xterm';
import { getTerminalTheme } from '../terminal-theme.js';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { initSession, removeSession } from '../session-activity.js';
import { markFreshSession } from '../session-insights.js';
import { removeSession as removeContextSession, type ContextWindowInfo } from '../session-context.js';
import type { ProviderId } from '../types.js';
import { getProviderCapabilities } from '../provider-availability.js';
import { TERMINAL_FONT_FAMILY, getTerminalFontSize } from '../terminal-font.js';
import { appState } from '../state.js';
import { FilePathLinkProvider, GithubLinkProvider } from './terminal-link-provider.js';
import { attachAlternateScroll, attachClipboardCopyHandler, attachCopyOnSelect, scheduleWebglUpgrade, wrapBracketedPaste } from './terminal-utils.js';
import { FILE_PATH_DRAG_TYPE, NATIVE_FILES_DRAG_TYPE } from '../drag-types.js';
import { showTerminalContextMenu } from './terminal-context-menu.js';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  sessionId: string;
  projectPath: string;
  cliSessionId: string | null;
  providerId: ProviderId;
  args: string;
  envVars: string;
  /** Resolved profile config dir (CLAUDE_CONFIG_DIR), or undefined for the default ~/.claude. */
  configDir?: string;
  /** Only for providerId === 'custom': the command this session runs. */
  customCommand?: string;
  isResume: boolean;
  wasResumed: boolean;
  spawned: boolean;
  exited: boolean;
  pendingPrompt: string | null;
  pendingPromptTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Peak output-token count seen this session, used to render a stable "out"
   * figure. Claude's `context_window.total_output_tokens` is per-turn, not
   * cumulative — it ramps up while a response streams (2 → … → final) and
   * resets low at each new turn. Holding the peak keeps the rail from
   * flickering down to a tiny number on every turn boundary.
   */
  peakOutputTokens: number;
}

const instances = new Map<string, TerminalInstance>();
let focusedSessionId: string | null = null;

export function createTerminalPane(
  sessionId: string,
  projectPath: string,
  cliSessionId: string | null,
  isResume: boolean = false,
  args: string = '',
  providerId: ProviderId = 'claude',
  projectId?: string,
  envVars: string = '',
  configDir?: string,
  customCommand?: string,
): TerminalInstance {
  if (instances.has(sessionId)) {
    return instances.get(sessionId)!;
  }

  const element = document.createElement('div');
  element.className = 'terminal-pane hidden';
  element.dataset.sessionId = sessionId;

  const xtermWrap = document.createElement('div');
  xtermWrap.className = 'xterm-wrap';
  element.appendChild(xtermWrap);

  const terminal = new Terminal({
    theme: getTerminalTheme(appState.preferences.theme ?? 'dark'),
    fontSize: getTerminalFontSize(),
    fontFamily: TERMINAL_FONT_FAMILY,
    cursorBlink: true,
    allowProposedApi: true,
    linkHandler: {
      activate: (event, uri) => {
        if (event.metaKey || event.ctrlKey) {
          window.rcode.app.openExternal(uri);
        }
      },
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  terminal.loadAddon(new WebLinksAddon((event, url) => {
    if (event.metaKey || event.ctrlKey) {
      window.rcode.app.openExternal(url);
    }
  }));

  const writeToPty = (data: string) => window.rcode.pty.write(sessionId, data);

  // Full-screen CLIs get wheel-to-arrow translation; normal scrollback is untouched.
  attachAlternateScroll(terminal, writeToPty);

  // Send CSI u encoding for Shift+Enter so Claude CLI treats it as newline
  attachClipboardCopyHandler(terminal, (e) => {
    if (e.shiftKey && e.key === 'Enter') {
      if (e.type === 'keydown') window.rcode.pty.write(sessionId, '\x1b[13;2u');
      e.preventDefault();
      return false;
    }
  }, writeToPty);

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    searchAddon,
    element,
    sessionId,
    projectPath,
    cliSessionId,
    providerId,
    args,
    envVars,
    configDir,
    customCommand,
    isResume,
    wasResumed: isResume,
    spawned: false,
    exited: false,
    pendingPrompt: null,
    pendingPromptTimer: null,
    peakOutputTokens: 0,
  };

  instances.set(sessionId, instance);

  // Register file path link provider for Cmd+Click
  if (projectId) {
    terminal.registerLinkProvider(new FilePathLinkProvider(projectId, projectPath, terminal));
  }

  // Register GitHub #123 link provider
  window.rcode.git.getRemoteUrl(projectPath).then((repoUrl) => {
    if (repoUrl) {
      terminal.registerLinkProvider(new GithubLinkProvider(repoUrl, terminal));
    }
  });

  // Handle user input → PTY
  terminal.onData((data) => {
    window.rcode.pty.write(sessionId, data);
  });

  // Focus tracking
  element.addEventListener('mousedown', () => {
    setFocused(sessionId);
  });
  // Use onKey (real keystrokes only), NOT onData: onData also fires for
  // terminal-generated responses to query escape sequences (e.g. cursor-position
  // reports under CLAUDE_CODE_NO_FLICKER=1), which would otherwise steal focus
  // back to the terminal on every frame.
  terminal.onKey(() => {
    if (focusedSessionId !== sessionId) {
      setFocused(sessionId);
    }
  });

  element.addEventListener('dragover', (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const types = e.dataTransfer.types;
    if (!types.includes(FILE_PATH_DRAG_TYPE) && !types.includes(NATIVE_FILES_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    element.classList.add('drag-over');
  });
  element.addEventListener('dragleave', (e: DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !element.contains(next)) {
      element.classList.remove('drag-over');
    }
  });
  element.addEventListener('drop', (e: DragEvent) => {
    element.classList.remove('drag-over');
    const paths = collectDroppedPaths(e.dataTransfer);
    if (paths.length === 0) return;
    e.preventDefault();
    if (injectTextIntoRunningSession(sessionId, paths.join(' ') + ' ')) {
      terminal.focus();
    }
  });

  xtermWrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTerminalContextMenu(e.clientX, e.clientY, terminal, writeToPty);
  });

  return instance;
}

export function getTerminalInstance(sessionId: string): TerminalInstance | undefined {
  return instances.get(sessionId);
}

export function getAllInstances(): Map<string, TerminalInstance> {
  return instances;
}

/** Re-font every open CLI terminal after the preference changes, then refit. */
export function applyFontSizeToAllTerminals(): void {
  const size = getTerminalFontSize();
  for (const instance of instances.values()) {
    instance.terminal.options.fontSize = size;
    instance.fitAddon.fit();
  }
}

export function applyThemeToAllTerminals(theme: 'dark' | 'light'): void {
  const termTheme = getTerminalTheme(theme);
  for (const instance of instances.values()) {
    instance.terminal.options.theme = termTheme;
  }
}

export function setPendingPrompt(sessionId: string, prompt: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.pendingPrompt = prompt;
  }
}

function collectDroppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const internal = dt.getData(FILE_PATH_DRAG_TYPE);
  if (internal) return [internal];
  const paths: string[] = [];
  for (const file of dt.files) {
    const path = window.rcode.fs.getDroppedFilePath(file);
    if (path) paths.push(path);
  }
  return paths;
}

export function injectTextIntoRunningSession(sessionId: string, text: string): boolean {
  const instance = instances.get(sessionId);
  if (!instance || !instance.spawned || instance.exited) return false;
  window.rcode.pty.write(sessionId, wrapBracketedPaste(instance.terminal, text));
  return true;
}

export function injectPromptIntoRunningSession(sessionId: string, prompt: string): boolean {
  if (!injectTextIntoRunningSession(sessionId, prompt)) return false;
  window.rcode.pty.write(sessionId, '\r');
  return true;
}

function clearPendingPromptTimer(instance: TerminalInstance): void {
  if (instance.pendingPromptTimer) {
    clearTimeout(instance.pendingPromptTimer);
    instance.pendingPromptTimer = null;
  }
}


export async function spawnTerminal(sessionId: string): Promise<void> {
  const instance = instances.get(sessionId);
  if (!instance || instance.spawned) return;

  instance.spawned = true;
  instance.exited = false;

  // Remove any exit overlay
  const overlay = instance.element.querySelector('.terminal-exit-overlay');
  if (overlay) overlay.remove();

  if (!instance.isResume) {
    markFreshSession(sessionId);
  }
  initSession(sessionId);
  let initialPrompt: string | undefined;
  if (instance.pendingPrompt && getProviderCapabilities(instance.providerId)?.pendingPromptTrigger === 'startup-arg') {
    initialPrompt = instance.pendingPrompt;
    instance.pendingPrompt = null;
  }
  await window.rcode.pty.create(sessionId, instance.projectPath, instance.cliSessionId, instance.isResume, instance.args, instance.providerId, initialPrompt, instance.envVars, instance.configDir, instance.customCommand);
  instance.isResume = true; // subsequent spawns (e.g. Restart Session) should resume
}

export function attachToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  const xtermWrap = instance.element.querySelector('.xterm-wrap')!;
  if (!xtermWrap.querySelector('.xterm')) {
    container.appendChild(instance.element);
    instance.terminal.open(xtermWrap as HTMLElement);

    attachCopyOnSelect(instance.terminal);
    // Not awaited on purpose: see scheduleWebglUpgrade.
    scheduleWebglUpgrade(instance.terminal);
  } else {
    // Always re-append to ensure correct DOM order (appendChild moves existing children)
    container.appendChild(instance.element);
  }
}

export function showPane(sessionId: string, split: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  if (split) {
    instance.element.classList.add('split');
  } else {
    instance.element.classList.remove('split');
  }
}

export function hidePane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.add('hidden');
}

export function hideAllPanes(): void {
  for (const [, instance] of instances) {
    instance.element.classList.add('hidden');
  }
}

export function fitTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance || instance.element.classList.contains('hidden')) return;

  try {
    instance.fitAddon.fit();
    const { cols, rows } = instance.terminal;
    window.rcode.pty.resize(sessionId, cols, rows);
  } catch {
    // Element not yet visible
  }
}

export function fitAllVisible(): void {
  for (const [sessionId, instance] of instances) {
    if (!instance.element.classList.contains('hidden')) {
      fitTerminal(sessionId);
    }
  }
}

export function getSearchAddon(sessionId: string): SearchAddon | undefined {
  return instances.get(sessionId)?.searchAddon;
}

export function getFocusedSessionId(): string | null {
  return focusedSessionId;
}

export function setFocused(sessionId: string): void {
  focusedSessionId = sessionId;

  // Only move DOM focus if it's currently on a session terminal (or nothing).
  // This prevents stealing focus from the project terminal panel, search bar, modals, etc.
  const activeEl = document.activeElement;
  const shouldFocusTerminal =
    !activeEl ||
    activeEl === document.body ||
    !!activeEl.closest('.terminal-pane');

  for (const [id, instance] of instances) {
    if (id === sessionId) {
      instance.element.classList.add('focused');
      if (shouldFocusTerminal) {
        instance.terminal.focus();
      }
    } else {
      instance.element.classList.remove('focused');
    }
  }
}

export function handlePtyData(sessionId: string, data: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.terminal.write(data);
  }
}

export function destroyTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  clearPendingPromptTimer(instance);
  window.rcode.pty.kill(sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  instances.delete(sessionId);
  removeSession(sessionId);
  removeContextSession(sessionId);
}

/** Resolve the display name of the profile backing this session, or null when
 *  there is only a single (implicit) profile for the provider. */
function resolveProfileName(providerId: ProviderId, configDir?: string): string | null {
  const providerProfiles = appState.profiles.filter((p) => p.providerId === providerId);
  if (providerProfiles.length <= 1) return null;
  const profile = configDir ? providerProfiles.find((p) => p.configDir === configDir) : undefined;
  return profile?.name ?? 'Default';
}

/**
 * The terminal pane no longer renders its own status rail (the bottom bar was
 * removed). Context data keeps flowing into the session inspector's Context tab;
 * this stays as a no-op seam so callers do not need to know that.
 */
export function updateContextDisplay(_sessionId: string, _info: ContextWindowInfo): void {}


/** Profile badges live in the tab/rail chrome; nothing in the pane needs
 *  re-rendering when the profile set changes, but the export stays for callers. */
export function refreshProfileLabels(): void {}

