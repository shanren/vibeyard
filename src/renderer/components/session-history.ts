import { appState, ArchivedSession, ProjectRecord } from '../state.js';
import { loadProviderAvailability } from '../provider-availability.js';
import { buildResumeWithProviderItems } from './resume-with-provider-menu.js';
import { showConfirmDialog } from './modal.js';
import type { ProjectTranscript, ProviderId } from '../../shared/types.js';

const MAX_VISIBLE = 50;
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  copilot: 'GitHub Copilot',
  gemini: 'Gemini CLI',
};

interface ProjectFilterState {
  searchText: string;
  bookmarkOnly: boolean;
}

const filterStateByProject = new Map<string, ProjectFilterState>();
const activePanels = new Map<string, Map<string, HTMLElement>>();
const DEFAULT_INSTANCE_KEY = 'sidebar';

/** On-disk CLI transcripts per project (the provider's own session history), cached across re-renders. */
const cliTranscriptsByProject = new Map<string, ProjectTranscript[]>();
/** Monotonic load token per project so a newer refresh supersedes an in-flight fetch. */
const cliLoadTokens = new Map<string, number>();

let historyContextMenu: HTMLElement | null = null;

function hideHistoryContextMenu(): void {
  if (historyContextMenu) {
    historyContextMenu.remove();
    historyContextMenu = null;
  }
}

function showHistoryContextMenu(x: number, y: number, project: ProjectRecord, archived: ArchivedSession): void {
  hideHistoryContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  if (archived.cliSessionId) {
    const resumeItem = document.createElement('div');
    resumeItem.className = 'tab-context-menu-item';
    resumeItem.textContent = 'Resume';
    resumeItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideHistoryContextMenu();
      void appState.resumeFromHistorySafe(project.id, archived.id);
    });
    menu.appendChild(resumeItem);
  }

  const resumeWithItems = buildResumeWithProviderItems(
    (archived.providerId || 'claude') as ProviderId,
    (targetId) => {
      hideHistoryContextMenu();
      appState.resumeWithProvider(project.id, { archivedSessionId: archived.id }, targetId);
    },
  );
  for (const el of resumeWithItems) menu.appendChild(el);

  if (menu.firstChild) {
    const separator = document.createElement('div');
    separator.className = 'tab-context-menu-separator';
    menu.appendChild(separator);
  }

  const removeItem = document.createElement('div');
  removeItem.className = 'tab-context-menu-item danger';
  removeItem.textContent = 'Remove from history';
  removeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideHistoryContextMenu();
    appState.removeHistoryEntry(project.id, archived.id);
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);
  historyContextMenu = menu;
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

function getFilterState(projectId: string): ProjectFilterState {
  let state = filterStateByProject.get(projectId);
  if (!state) {
    state = { searchText: '', bookmarkOnly: false };
    filterStateByProject.set(projectId, state);
  }
  return state;
}

let listenersAttached = false;

export function initSessionHistory(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  appState.on('history-changed', rerenderAll);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', hideHistoryContextMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHistoryContextMenu(); });
  }
}

function rerenderAll(): void {
  for (const [projectId, panels] of activePanels) {
    const project = appState.projects.find(p => p.id === projectId);
    if (!project) continue;
    for (const [instanceKey, container] of panels) {
      renderSessionHistory(project, container, instanceKey);
    }
  }
}

export function renderSessionHistory(
  project: ProjectRecord,
  container: HTMLElement,
  instanceKey: string = DEFAULT_INSTANCE_KEY,
): void {
  let panels = activePanels.get(project.id);
  if (!panels) {
    panels = new Map();
    activePanels.set(project.id, panels);
  }
  panels.set(instanceKey, container);

  const history = appState.getSessionHistory(project.id);
  const filter = getFilterState(project.id);

  container.innerHTML = '';

  if (history.length > 0) {
    const searchInput = document.createElement('input');
    searchInput.className = 'history-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter history...';
    searchInput.value = filter.searchText;
    searchInput.addEventListener('input', () => {
      filter.searchText = searchInput.value;
      renderList(project, container, history, filter);
    });
    container.appendChild(searchInput);

    const bookmarkFilter = document.createElement('button');
    const applyFilterState = () => {
      bookmarkFilter.className = `history-bookmark-filter${filter.bookmarkOnly ? ' active' : ''}`;
      bookmarkFilter.textContent = filter.bookmarkOnly ? '★ Bookmarked' : '☆ Bookmarked';
    };
    applyFilterState();
    bookmarkFilter.addEventListener('click', () => {
      filter.bookmarkOnly = !filter.bookmarkOnly;
      applyFilterState();
      renderList(project, container, history, filter);
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'history-clear-btn';
    clearBtn.textContent = 'Clear History';
    clearBtn.addEventListener('click', () => {
      showConfirmDialog(
        'Clear session history',
        `Clear all non-bookmarked sessions for "${project.name}"? Bookmarked sessions will be kept. This cannot be undone.`,
        {
          confirmLabel: 'Clear',
          onConfirm: () => appState.clearSessionHistory(project.id),
        },
      );
    });

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.appendChild(bookmarkFilter);
    actions.appendChild(clearBtn);
    container.appendChild(actions);

    const listEl = document.createElement('div');
    listEl.className = 'history-list';
    container.appendChild(listEl);

    renderList(project, container, history, filter);
  } else {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No session history yet';
    container.appendChild(empty);
  }

  // The provider's own on-disk session history (e.g. Claude Code transcripts) for
  // this project — shown in its own section below the Vibeyard archive. Loaded once
  // per panel open, then cached so re-renders (history-changed, search) don't refetch.
  const cached = cliTranscriptsByProject.get(project.id);
  if (cached) {
    renderCliSection(project, container, instanceKey, cached, history);
  } else {
    void loadCliTranscripts(project, container, instanceKey);
  }
}

function updateEmptyState(container: HTMLElement, history: ArchivedSession[], cliList: ProjectTranscript[]): void {
  container.querySelector('.history-empty')?.remove();
  if (history.length === 0 && cliList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No session history yet';
    container.appendChild(empty);
  }
}

async function loadCliTranscripts(project: ProjectRecord, container: HTMLElement, instanceKey: string): Promise<void> {
  const token = (cliLoadTokens.get(project.id) ?? 0) + 1;
  cliLoadTokens.set(project.id, token);
  let list: ProjectTranscript[] = [];
  try {
    list = await window.vibeyard.session.projectTranscripts(project.path);
  } catch {
    list = [];
  }
  // A newer load for this project supersedes this one.
  if (cliLoadTokens.get(project.id) !== token) return;
  cliTranscriptsByProject.set(project.id, list);
  // The panel may have re-rendered (or closed) while we awaited.
  if (activePanels.get(project.id)?.get(instanceKey) !== container) return;
  renderCliSection(project, container, instanceKey, list, appState.getSessionHistory(project.id));
}

function renderCliSection(
  project: ProjectRecord,
  container: HTMLElement,
  instanceKey: string,
  list: ProjectTranscript[],
  history: ArchivedSession[],
): void {
  container.querySelector('.history-cli')?.remove();

  // Skip sessions already archived in Vibeyard so the same session isn't listed twice.
  const archivedKeys = new Set<string>();
  for (const a of history) {
    if (!a.cliSessionId) continue;
    archivedKeys.add(`${a.providerId || 'claude'}:${a.cliSessionId}`);
  }
  const items = list.filter((t) => !archivedKeys.has(`${t.providerId}:${t.cliSessionId}`));

  if (items.length > 0) {
    const cli = document.createElement('div');
    cli.className = 'history-cli';

    const header = document.createElement('div');
    header.className = 'history-cli-header';
    const title = document.createElement('span');
    title.className = 'history-cli-title';
    title.textContent = 'Session history from CLI';
    const refresh = document.createElement('button');
    refresh.className = 'history-cli-refresh';
    refresh.title = 'Refresh';
    refresh.textContent = '↻';
    refresh.addEventListener('click', (e) => {
      e.stopPropagation();
      void loadCliTranscripts(project, container, instanceKey);
    });
    header.appendChild(title);
    header.appendChild(refresh);

    const listEl = document.createElement('div');
    listEl.className = 'history-cli-list';
    for (const t of items.slice(0, MAX_VISIBLE)) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        appState.setActiveProject(project.id);
        appState.openCliSession(project.id, t.cliSessionId, t.name, t.providerId, t.profileId);
      });

      const info = document.createElement('div');
      info.className = 'history-item-info';

      const name = document.createElement('div');
      name.className = 'history-item-name';
      name.textContent = t.name;
      name.title = `${t.name}\nSession ID: ${t.cliSessionId}`;
      info.appendChild(name);

      const details = document.createElement('div');
      details.className = 'history-item-details';
      const mtimeMs = Number.isFinite(t.mtimeMs) ? t.mtimeMs : Date.now();
      details.textContent = `${formatDate(new Date(mtimeMs).toISOString())} · ${getProviderLabel(t.providerId)}`;
      info.appendChild(details);

      item.appendChild(info);
      listEl.appendChild(item);
    }

    if (items.length > MAX_VISIBLE) {
      const more = document.createElement('div');
      more.className = 'history-item-details';
      more.style.padding = '4px 12px';
      more.textContent = `${items.length - MAX_VISIBLE} more items...`;
      listEl.appendChild(more);
    }

    cli.appendChild(header);
    cli.appendChild(listEl);

    container.appendChild(cli);
  }

  updateEmptyState(container, history, list);
}

function dropCliCache(projectId: string): void {
  cliTranscriptsByProject.delete(projectId);
  cliLoadTokens.delete(projectId);
}

export function closeSessionHistory(projectId: string, instanceKey?: string): void {
  const panels = activePanels.get(projectId);
  if (!panels) return;
  if (instanceKey === undefined) {
    for (const container of panels.values()) container.innerHTML = '';
    activePanels.delete(projectId);
    dropCliCache(projectId);
    return;
  }
  const container = panels.get(instanceKey);
  if (container) container.innerHTML = '';
  panels.delete(instanceKey);
  if (panels.size === 0) {
    activePanels.delete(projectId);
    dropCliCache(projectId);
  }
}

export function clearProjectState(projectId: string): void {
  filterStateByProject.delete(projectId);
  activePanels.delete(projectId);
  dropCliCache(projectId);
}

function renderList(
  project: ProjectRecord,
  container: HTMLElement,
  history: ArchivedSession[],
  filter: ProjectFilterState,
): void {
  const listEl = container.querySelector('.history-list') as HTMLElement | null;
  if (!listEl) return;

  const needle = filter.searchText.toLowerCase();
  const filtered = history
    .filter((a) => a.name.toLowerCase().includes(needle))
    .filter((a) => !filter.bookmarkOnly || a.bookmarked)
    .slice()
    .reverse();

  listEl.innerHTML = '';

  const visible = filtered.slice(0, MAX_VISIBLE);
  for (const archived of visible) {
    const item = document.createElement('div');
    item.className = 'history-item';

    if (archived.cliSessionId) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        void appState.resumeFromHistorySafe(project.id, archived.id);
      });
    }
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadProviderAvailability().catch(() => {});
      showHistoryContextMenu(e.clientX, e.clientY, project, archived);
    });

    const info = document.createElement('div');
    info.className = 'history-item-info';

    const name = document.createElement('div');
    name.className = 'history-item-name';
    name.textContent = archived.name;
    name.title = archived.cliSessionId
      ? `${archived.name}\nSession ID: ${archived.cliSessionId}`
      : archived.name;
    info.appendChild(name);

    const details = document.createElement('div');
    details.className = 'history-item-details';
    const parts: string[] = [];
    parts.push(formatDate(archived.closedAt));
    parts.push(getProviderLabel(archived.providerId));
    details.textContent = parts.join(' · ');
    info.appendChild(details);

    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'history-item-actions';

    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = `history-bookmark-btn${archived.bookmarked ? ' bookmarked' : ''}`;
    bookmarkBtn.innerHTML = archived.bookmarked ? '&#9733;' : '&#9734;';
    bookmarkBtn.title = archived.bookmarked ? 'Remove bookmark' : 'Bookmark session';
    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.toggleBookmark(project.id, archived.id);
    });
    actions.appendChild(bookmarkBtn);

    item.appendChild(actions);

    listEl.appendChild(item);
  }

  if (filtered.length > MAX_VISIBLE) {
    const more = document.createElement('div');
    more.className = 'history-item-details';
    more.style.padding = '4px 12px';
    more.textContent = `${filtered.length - MAX_VISIBLE} more items...`;
    listEl.appendChild(more);
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getProviderLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}
