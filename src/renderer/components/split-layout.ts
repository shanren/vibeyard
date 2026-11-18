import { appState, ProjectRecord } from '../state.js';
import { isUnread, onChange as onUnreadChange } from '../session-unread.js';
import type { ProviderId } from '../../shared/types.js';

/** Config dir for a session's pinned profile (provider-matched), or undefined for default ~/.claude. */
function sessionConfigDir(session: { profileId?: string }, providerId: ProviderId): string | undefined {
  if (!session.profileId) return undefined;
  return appState.profiles.find((p) => p.id === session.profileId && p.providerId === providerId)?.configDir;
}
import {
  createTerminalPane,
  attachToContainer,
  showPane,
  hideAllPanes,
  fitAllVisible,
  setFocused,
  spawnTerminal,
  setPendingPrompt,
  destroyTerminal,
  getTerminalInstance,
} from './terminal-pane.js';
import {
  createInspectorPane,
  destroyInspectorPane,
  showInspectorPane,
  hideAllInspectorPanes,
  attachInspectorToContainer,
  getInspectorInstance,
  disconnectInspector,
} from './mcp-inspector.js';
import { isInspectorOpen } from './session-inspector.js';
import {
  createFileViewerPane,
  destroyFileViewerPane,
  showFileViewerPane,
  hideAllFileViewerPanes,
  attachFileViewerToContainer,
  getFileViewerInstance,
} from './file-viewer.js';
import {
  createFileReaderPane,
  destroyFileReaderPane,
  showFileReaderPane,
  hideAllFileReaderPanes,
  attachFileReaderToContainer,
  getFileReaderInstance,
  setFileReaderLine,
} from './file-reader.js';
import { quickNewSession } from './tab-bar.js';
import { isCliSession } from '../session-utils.js';

const container = document.getElementById('terminal-container')!;

/** Set the container's layout class while preserving the inspector-open class if active. */
function setContainerClass(cls: string): void {
  const hasInspector = isInspectorOpen();
  container.className = cls;
  if (hasInspector) container.classList.add('inspector-open');
}

export function initSplitLayout(): void {
  appState.on('state-loaded', renderLayout);
  appState.on('project-changed', renderLayout);
  appState.on('session-added', onSessionAdded);
  appState.on('session-removed', onSessionRemoved);
  appState.on('session-changed', renderLayout);
  appState.on('layout-changed', renderLayout);

  // Refit on window resize
  window.addEventListener('resize', () => {
    requestAnimationFrame(fitAllVisible);
  });

}

function onSessionAdded(data: unknown): void {
  const { projectId, session } = data as { projectId: string; session: { id: string; type?: string; cliSessionId: string | null; providerId?: string; args?: string; envVars?: string; profileId?: string; cwd?: string; diffFilePath?: string; diffArea?: string; worktreePath?: string; fileReaderPath?: string; fileReaderLine?: number } };
  const project = appState.activeProject;
  if (!project) return;

  if (session.type === 'file-reader') {
    createFileReaderPane(session.id, session.fileReaderPath || '', session.fileReaderLine);
    renderLayout();
  } else if (session.type === 'diff-viewer') {
    createFileViewerPane(session.id, session.diffFilePath || '', session.diffArea || '', session.worktreePath);
    renderLayout();
  } else if (session.type === 'mcp-inspector') {
    createInspectorPane(session.id);
    renderLayout();
  } else {
    // Create and spawn immediately
    const cliProviderId = (session.providerId as ProviderId) || 'claude';
    const configDir = sessionConfigDir(session, cliProviderId);
    createTerminalPane(session.id, project.path, session.cliSessionId, !!session.cliSessionId, session.args || '', cliProviderId, project.id, session.envVars || '', configDir);
    const pending = appState.consumePendingInitialPrompt(project.id, session.id);
    if (pending) {
      setPendingPrompt(session.id, pending);
    }
    renderLayout();

    // Spawn after layout is rendered so terminal has dimensions
    requestAnimationFrame(() => {
      spawnTerminal(session.id);
      fitAllVisible();
    });
  }
}

function onSessionRemoved(data: unknown): void {
  const { sessionId } = data as { projectId: string; sessionId: string };
  if (getFileReaderInstance(sessionId)) {
    destroyFileReaderPane(sessionId);
  } else if (getFileViewerInstance(sessionId)) {
    destroyFileViewerPane(sessionId);
  } else if (getInspectorInstance(sessionId)) {
    disconnectInspector(sessionId);
    destroyInspectorPane(sessionId);
  } else {
    destroyTerminal(sessionId);
  }
  renderLayout();
}

export function renderLayout(): void {
  const project = appState.activeProject;

  if (!project || project.sessions.length === 0) {
    hideAllPanes();
    hideAllInspectorPanes();
    hideAllFileViewerPanes();
    hideAllFileReaderPanes();
    setContainerClass('');
    showEmptyState(project);
    return;
  }

  removeEmptyState();
  // Ensure all sessions have their respective instances
  for (const session of project.sessions) {
    if (session.type === 'file-reader') {
      if (!getFileReaderInstance(session.id)) {
        createFileReaderPane(session.id, session.fileReaderPath || '', session.fileReaderLine);
      }
    } else if (session.type === 'diff-viewer') {
      if (!getFileViewerInstance(session.id)) {
        createFileViewerPane(session.id, session.diffFilePath || '', session.diffArea || '', session.worktreePath);
      }
    } else if (session.type === 'mcp-inspector') {
      if (!getInspectorInstance(session.id)) {
        createInspectorPane(session.id);
      }
    } else {
      if (!getTerminalInstance(session.id)) {
        const cliProviderId = session.providerId || 'claude';
        const configDir = sessionConfigDir(session, cliProviderId);
        createTerminalPane(session.id, project.path, session.cliSessionId, !!session.cliSessionId, session.args || '', cliProviderId, project.id, session.envVars || '', configDir);
      }
    }
  }

  hideAllPanes();
  hideAllInspectorPanes();
  hideAllFileViewerPanes();
  hideAllFileReaderPanes();

  if (project.layout.mode === 'split' && project.layout.splitPanes.length > 1) {
    renderSplitMode(project);
  } else {
    renderTabMode(project);
  }

  requestAnimationFrame(fitAllVisible);
}

/** Attach and show a non-CLI session pane. */
function attachNonCliPane(session: { id: string; type?: string; fileReaderLine?: number }, target: HTMLElement, inSplit: boolean): void {
  if (session.type === 'file-reader') {
    attachFileReaderToContainer(session.id, target);
    showFileReaderPane(session.id, inSplit);
    if (session.fileReaderLine) {
      setFileReaderLine(session.id, session.fileReaderLine);
    }
  } else if (session.type === 'diff-viewer') {
    attachFileViewerToContainer(session.id, target);
    showFileViewerPane(session.id, inSplit);
  } else if (session.type === 'mcp-inspector') {
    attachInspectorToContainer(session.id, target);
    showInspectorPane(session.id, inSplit);
  }
}

function renderTabMode(project: ProjectRecord): void {
  setContainerClass('');
  container.style.gridTemplateColumns = '';
  container.style.gridTemplateRows = '';

  const activeId = project.activeSessionId;
  if (!activeId) return;

  const activeSession = project.sessions.find(s => s.id === activeId);
  if (activeSession && !isCliSession(activeSession)) {
    attachNonCliPane(activeSession, container, false);
    return;
  }

  attachToContainer(activeId, container);
  showPane(activeId, false);

  // Don't steal focus from an active tab rename input
  if (!document.querySelector('#tab-list .tab-name input')) {
    setFocused(activeId);
  }

  const instance = getTerminalInstance(activeId);
  if (instance && !instance.spawned && !instance.exited) {
    requestAnimationFrame(() => {
      spawnTerminal(activeId);
      fitAllVisible();
    });
  }
}

/** Attach, show, and ensure-spawn for each pane in the list. */
function showPanes(project: ProjectRecord, target: HTMLElement = container): void {
  for (const paneId of project.layout.splitPanes) {
    const session = project.sessions.find(s => s.id === paneId);
    if (session && !isCliSession(session)) {
      attachNonCliPane(session, target, true);
      continue;
    }

    attachToContainer(paneId, target);
    showPane(paneId, true);

    const instance = getTerminalInstance(paneId);
    if (instance && !instance.spawned && !instance.exited) {
      requestAnimationFrame(() => spawnTerminal(paneId));
    }
  }
}

function focusActivePane(project: ProjectRecord): void {
  // Don't steal focus from an active tab rename input
  if (document.querySelector('#tab-list .tab-name input')) return;

  if (project.activeSessionId && project.layout.splitPanes.includes(project.activeSessionId)) {
    setFocused(project.activeSessionId);
  } else if (project.layout.splitPanes.length > 0) {
    setFocused(project.layout.splitPanes[0]);
  }
}

function renderSplitMode(project: ProjectRecord): void {
  setContainerClass(`split-${project.layout.splitDirection}`);
  container.style.gridTemplateColumns = '';
  container.style.gridTemplateRows = '';
  showPanes(project);
  focusActivePane(project);
}

const plusIcon =
  '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="2.5" x2="7" y2="11.5"/><line x1="2.5" y1="7" x2="11.5" y2="7"/></svg>';

function showEmptyState(project: ProjectRecord | undefined): void {
  removeEmptyState();
  const el = document.createElement('div');
  el.className = 'empty-state';
  if (!project) {
    el.innerHTML = `
      <div>No project selected</div>
      <div class="hint">Create a project with the + button in the sidebar</div>
    `;
  } else {
    const title = document.createElement('div');
    title.className = 'empty-state-title';
    title.textContent = 'Ready when you are';

    const hint = document.createElement('div');
    hint.className = 'hint';
    const name = document.createElement('span');
    name.className = 'empty-state-project';
    name.textContent = project.name;
    hint.append('No sessions running in ', name, ' yet.');

    const cta = document.createElement('button');
    cta.className = 'btn-primary empty-state-cta';
    cta.innerHTML = `${plusIcon}<span>Start a session</span>`;
    cta.addEventListener('click', () => quickNewSession());

    el.append(title, hint, cta);
  }
  container.appendChild(el);
}

function removeEmptyState(): void {
  container.querySelector('.empty-state')?.remove();
}
