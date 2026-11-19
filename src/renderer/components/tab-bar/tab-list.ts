import { appState, MAX_SESSION_NAME_LENGTH, type ProjectRecord, type SessionRecord } from '../../state.js';
import type { ProviderId } from '../../../shared/types.js';
import { getStatus, type SessionStatus } from '../../session-activity.js';
import { isUnread } from '../../session-unread.js';
import { openInspector, isInspectorOpen, getInspectedSessionId, closeInspector } from '../session-inspector.js';
import { hasMultipleAvailableProviders, getProviderCapabilities } from '../../provider-availability.js';
import { buildResumeWithProviderItems } from '../resume-with-provider-menu.js';
import { isCliSession } from '../../session-utils.js';
import { esc } from '../../dom-utils.js';
import { providerMark } from '../../icons.js';
import {
  closeSessionWithConfirm,
  closeSessionWithAlwaysConfirm,
  closeAllSessionsWithConfirm,
  closeOtherSessionsWithConfirm,
  closeSessionsFromRightWithConfirm,
  closeSessionsFromLeftWithConfirm,
} from '../../session-close.js';
import { hideTabContextMenu, setActiveContextMenu, positionMenu } from './menu.js';
import { tabListEl } from './dom.js';
import { t } from '../../i18n.js';

function buildTooltip(status: SessionStatus, cliSessionId?: string): string {
  const statusLine = t('tab.tooltip.statusPrefix', { status });
  return cliSessionId ? `${statusLine}\n${t('tab.tooltip.sessionPrefix', { cliSessionId })}` : statusLine;
}

function startRename(tab: HTMLElement, project: ProjectRecord, session: SessionRecord): void {
  const nameSpan = tab.querySelector('.tab-name') as HTMLElement;
  if (nameSpan.querySelector('input')) return;

  const input = document.createElement('input');
  input.maxLength = MAX_SESSION_NAME_LENGTH;
  input.value = session.name;
  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.remove();
    if (newName && newName !== session.name) {
      appState.renameSession(project.id, session.id, newName, true);
    } else {
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed = true;
      input.remove();
      render();
    }
  });

  input.addEventListener('blur', commit);
}

function showTabContextMenu(x: number, y: number, project: ProjectRecord, session: SessionRecord, tab: HTMLElement): void {
  hideTabContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renamable = true;
  const renameItem = document.createElement('div');
  renameItem.className = 'tab-context-menu-item' + (renamable ? '' : ' disabled');
  renameItem.textContent = t('contextMenu.tab.rename');
  if (renamable) {
    renameItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      startRename(tab, project, session);
    });
  }

  const closeItem = document.createElement('div');
  closeItem.className = 'tab-context-menu-item';
  closeItem.textContent = t('contextMenu.tab.close');
  closeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    closeSessionWithConfirm(project.id, session.id);
  });

  const sessionIdx = project.sessions.findIndex((s) => s.id === session.id);
  const totalSessions = project.sessions.length;

  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';

  const closeAllItem = document.createElement('div');
  closeAllItem.className = 'tab-context-menu-item';
  closeAllItem.textContent = t('contextMenu.tab.closeAll');
  closeAllItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    closeAllSessionsWithConfirm(project.id);
  });

  const closeOthersItem = document.createElement('div');
  closeOthersItem.className = 'tab-context-menu-item' + (totalSessions <= 1 ? ' disabled' : '');
  closeOthersItem.textContent = t('contextMenu.tab.closeOthers');
  if (totalSessions > 1) {
    closeOthersItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      closeOtherSessionsWithConfirm(project.id, session.id);
    });
  }

  const closeRightItem = document.createElement('div');
  closeRightItem.className = 'tab-context-menu-item' + (sessionIdx >= totalSessions - 1 ? ' disabled' : '');
  closeRightItem.textContent = t('contextMenu.tab.closeRight');
  if (sessionIdx < totalSessions - 1) {
    closeRightItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      closeSessionsFromRightWithConfirm(project.id, session.id);
    });
  }

  const closeLeftItem = document.createElement('div');
  closeLeftItem.className = 'tab-context-menu-item' + (sessionIdx <= 0 ? ' disabled' : '');
  closeLeftItem.textContent = t('contextMenu.tab.closeLeft');
  if (sessionIdx > 0) {
    closeLeftItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      closeSessionsFromLeftWithConfirm(project.id, session.id);
    });
  }

  const moveLeftItem = document.createElement('div');
  moveLeftItem.className = 'tab-context-menu-item' + (sessionIdx <= 0 ? ' disabled' : '');
  moveLeftItem.textContent = t('contextMenu.tab.moveLeft');
  if (sessionIdx > 0) {
    moveLeftItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      appState.reorderSession(project.id, session.id, sessionIdx - 1);
    });
  }

  const moveRightItem = document.createElement('div');
  moveRightItem.className = 'tab-context-menu-item' + (sessionIdx >= totalSessions - 1 ? ' disabled' : '');
  moveRightItem.textContent = t('contextMenu.tab.moveRight');
  if (sessionIdx < totalSessions - 1) {
    moveRightItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      appState.reorderSession(project.id, session.id, sessionIdx + 1);
    });
  }

  const isCli = isCliSession(session);
  const providerCapabilities = getProviderCapabilities(session.providerId || 'claude');
  const canInspect = isCli && providerCapabilities?.hookStatus !== false;

  menu.appendChild(renameItem);
  menu.appendChild(moveLeftItem);
  menu.appendChild(moveRightItem);

  if (appState.preferences.debugMode) {
    const sessionSeparator = document.createElement('div');
    sessionSeparator.className = 'tab-context-menu-separator';

    const cliSessionId = session.cliSessionId;
    const hasCliSession = !!cliSessionId;

    const copySessionIdItem = document.createElement('div');
    copySessionIdItem.className = 'tab-context-menu-item' + (!hasCliSession ? ' disabled' : '');
    copySessionIdItem.textContent = t('contextMenu.tab.copyCliSessionId');
    if (hasCliSession) {
      copySessionIdItem.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTabContextMenu();
        navigator.clipboard.writeText(cliSessionId);
      });
    }

    const copyInternalIdItem = document.createElement('div');
    copyInternalIdItem.className = 'tab-context-menu-item';
    copyInternalIdItem.textContent = t('contextMenu.tab.copyInternalId');
    copyInternalIdItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      navigator.clipboard.writeText(session.id);
    });

    menu.appendChild(sessionSeparator);
    menu.appendChild(copyInternalIdItem);
    menu.appendChild(copySessionIdItem);
  }

  // Inspect item — only for CLI sessions
  const inspectItem = document.createElement('div');
  const isCurrentlyInspecting = isInspectorOpen() && getInspectedSessionId() === session.id;
  inspectItem.className = 'tab-context-menu-item' + (!canInspect ? ' disabled' : '');
  inspectItem.textContent = isCurrentlyInspecting ? t('contextMenu.tab.closeInspector') : t('contextMenu.tab.inspect');
  if (canInspect) {
    inspectItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      if (isCurrentlyInspecting) {
        closeInspector();
      } else {
        openInspector(session.id);
      }
    });
  }

  const moveSeparator = document.createElement('div');
  moveSeparator.className = 'tab-context-menu-separator';
  menu.appendChild(moveSeparator);
  if (canInspect) {
    const inspectSeparator = document.createElement('div');
    inspectSeparator.className = 'tab-context-menu-separator';
    menu.appendChild(inspectSeparator);
    menu.appendChild(inspectItem);
  }

  // Resume with <other provider> — only for CLI sessions
  if (isCli) {
    const items = buildResumeWithProviderItems(
      (session.providerId || 'claude') as ProviderId,
      (targetId) => {
        hideTabContextMenu();
        appState.resumeWithProvider(project.id, { sessionId: session.id }, targetId);
      },
    );
    for (const el of items) menu.appendChild(el);
  }

  menu.appendChild(closeItem);
  menu.appendChild(separator);
  menu.appendChild(closeAllItem);
  menu.appendChild(closeOthersItem);
  menu.appendChild(closeRightItem);
  menu.appendChild(closeLeftItem);
  document.body.appendChild(menu);
  setActiveContextMenu(menu);

  positionMenu(menu);
}

export function render(): void {
  if (tabListEl.querySelector('.tab-name input')) return;
  tabListEl.innerHTML = '';
  const project = appState.activeProject;
  if (!project) return;

  for (const session of project.sessions) {
    const tab = document.createElement('div');
    const isActive = session.id === project.activeSessionId;
    const isMcp = session.type === 'mcp-inspector';
    const isDiff = session.type === 'diff-viewer';
    const isFileReader = session.type === 'file-reader';
    const unread = !isActive && isUnread(session.id);
    const isSpecial = isMcp || isDiff || isFileReader;
    const displayName = session.name;
    tab.className = 'tab-item' + (isActive ? ' active' : '') + (unread ? ' unread' : '');
    tab.dataset.sessionId = session.id;
    tab.draggable = true;
    tab.title = isDiff ? t('tab.tooltip.diff', { name: session.diffFilePath || session.name }) : isMcp ? t('tab.tooltip.mcpInspector') : isFileReader ? t('tab.tooltip.file', { name: session.fileReaderPath || session.name }) : buildTooltip(getStatus(session.id), session.cliSessionId ?? undefined);
    const providerId = session.providerId || 'claude';
    const providerIcon = hasMultipleAvailableProviders() ? providerTabIcon(providerId) : '';
    const namePrefix = isDiff ? '<span class="tab-diff-badge">DIFF</span> ' : isMcp ? '<span class="tab-mcp-badge">MCP</span> ' : isFileReader ? '<span class="tab-file-badge">FILE</span> ' : !isSpecial ? providerIcon : '';
    const statusDot = isSpecial ? '' : `<span class="tab-status ${getStatus(session.id)}"></span>`;
    tab.innerHTML = `
      ${statusDot}
      <span class="tab-name">${namePrefix}${esc(displayName)}</span>
      <span class="tab-close" title="${esc(t('tab.closeTooltip'))}">&times;</span>
    `;

    // Click to switch
    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('tab-close')) return;
      if (tab.querySelector('.tab-name input')) return;
      if (session.id !== project.activeSessionId) {
        appState.setActiveSession(project.id, session.id);
      }
    });

    // Middle-click to close (always confirmed — an accidental middle-press must
    // never silently destroy a session, especially a file reader or completed one)
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeSessionWithAlwaysConfirm(project.id, session.id);
      }
    });

    // Double-click to rename
    tab.addEventListener('dblclick', () => startRename(tab, project, session));

    // Right-click context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, project, session, tab);
    });

    // Close button
    tab.querySelector('.tab-close')!.addEventListener('click', () => {
      closeSessionWithConfirm(project.id, session.id);
    });

    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', session.id);
      tab.classList.add('dragging');
    });

    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      // Determine left/right half
      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      tab.classList.remove('drag-over-left', 'drag-over-right');
      if (e.clientX < midX) {
        tab.classList.add('drag-over-left');
      } else {
        tab.classList.add('drag-over-right');
      }
    });

    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drag-over-left', 'drag-over-right');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drag-over-left', 'drag-over-right');
      const draggedId = e.dataTransfer!.getData('text/plain');
      if (!draggedId || draggedId === session.id) return;

      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      let targetIndex = project.sessions.findIndex(s => s.id === session.id);
      if (e.clientX >= midX) targetIndex++;

      // Adjust for the fact that removing the dragged item shifts indices
      const fromIndex = project.sessions.findIndex(s => s.id === draggedId);
      if (fromIndex < targetIndex) targetIndex--;

      appState.reorderSession(project.id, draggedId, targetIndex);
    });

    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      // Clean up all drag indicators
      tabListEl.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });
    });

    tabListEl.appendChild(tab);
  }
}

// Surgically update a single tab's status dot + tooltip without a full re-render.
export function updateTabStatus(sessionId: string, status: SessionStatus): void {
  const dot = tabListEl.querySelector(`.tab-item[data-session-id="${sessionId}"] .tab-status`) as HTMLElement | null;
  if (dot) {
    dot.className = `tab-status ${status}`;
  }
  const tab = tabListEl.querySelector(`.tab-item[data-session-id="${sessionId}"]`) as HTMLElement | null;
  if (tab) {
    const session = appState.activeProject?.sessions.find(s => s.id === sessionId);
    tab.title = buildTooltip(status, session?.cliSessionId ?? undefined);
  }
}

/**
 * Provider mark shown before a CLI tab title. Bundled CLIs ship a brand PNG;
 * providers added later (pi, opencode, custom) have no logo file, so they fall
 * back to the stroke glyph in icons.ts. Both occupy the same 14px box.
 */
function providerTabIcon(providerId: string): string {
  return `${providerMark(providerId, 'tab')} `;
}