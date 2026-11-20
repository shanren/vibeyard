import { appState, ProjectRecord } from '../state.js';
import { providerMark } from '../icons.js';
import type { ProjectTranscript, ProviderId } from '../../shared/types.js';

/**
 * Per-project Sessions panel.
 *
 * Every row here is a real session on disk, owned by the CLI tool itself — Claude
 * Code's JSONL transcripts, Pi's session files, OpenCode's database rows, and so
 * on. RCode keeps no copy of its own: the CLIs are the source of truth, so a
 * session started in a plain terminal shows up here too.
 *
 * Because one project is usually worked on with more than one tool, all providers
 * are merged into a single newest-first timeline with the tool's glyph on each row.
 * Filters appear only when a project actually has sessions from several tools.
 */

const MAX_VISIBLE = 50;

interface ProjectFilterState {
  searchText: string;
  /** Provider filter; 'all' shows the merged timeline. */
  provider: 'all' | ProviderId;
}

const filterStateByProject = new Map<string, ProjectFilterState>();
const activePanels = new Map<string, Map<string, HTMLElement>>();
const DEFAULT_INSTANCE_KEY = 'sidebar';

/** On-disk CLI transcripts per project, cached across re-renders. */
const transcriptsByProject = new Map<string, ProjectTranscript[]>();
/** Monotonic load token per project so a newer refresh supersedes an in-flight fetch. */
const loadTokens = new Map<string, number>();
/** Projects with a fetch in flight, so re-renders don't stack requests. */
const inFlight = new Set<string>();

function getFilterState(projectId: string): ProjectFilterState {
  let state = filterStateByProject.get(projectId);
  if (!state) {
    state = { searchText: '', provider: 'all' };
    filterStateByProject.set(projectId, state);
  }
  return state;
}

let listenersAttached = false;

export function initSessionHistory(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  appState.on('state-loaded', () => {
    // Projects changed on disk; force a refetch on the next render.
    transcriptsByProject.clear();
    rerenderAll();
  });
  appState.on('project-changed', rerenderAll);
  appState.on('session-added', rerenderAll);
  appState.on('session-removed', rerenderAll);
  appState.on('session-changed', rerenderAll);
}

function rerenderAll(): void {
  for (const [projectId, panels] of activePanels) {
    const project = appState.projects.find((p) => p.id === projectId);
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

  paintPanel(project, container, instanceKey);

  // Fetch only when there is nothing cached and nothing already in flight.
  // `paintPanel` must never trigger a fetch: doing that from the fetch callback
  // recursed into an endless IPC + innerHTML loop that starved the whole renderer
  // (no scrolling, no clicks, no typing anywhere).
  if (!transcriptsByProject.has(project.id) && !inFlight.has(project.id)) {
    void loadTranscripts(project, container, instanceKey);
  }
}

/** Redraw from the cached list. Pure DOM: never starts a request. */
function paintPanel(project: ProjectRecord, container: HTMLElement, instanceKey: string): void {
  // Re-rendering replaces the search input, so carry the typed text and focus
  // across a repaint — otherwise typing stops after the first refresh lands.
  const previous = container.querySelector('.history-search') as HTMLInputElement | null;
  const hadFocus = previous !== null && document.activeElement === previous;
  const caret = previous?.selectionStart ?? null;

  const filter = getFilterState(project.id);
  container.innerHTML = '';
  container.classList.add('history-panel');

  const list = transcriptsByProject.get(project.id) ?? [];
  const presentProviders = [...new Set(list.map((t) => t.providerId))].sort();

  if (presentProviders.length > 1) {
    container.appendChild(renderProviderFilters(project, container, instanceKey, presentProviders));
  } else if (filter.provider !== 'all') {
    // The last provider disappeared (or this project only has one); a stale
    // filter would hide everything with no chip to clear it.
    filter.provider = 'all';
  }

  const searchInput = document.createElement('input');
  searchInput.className = 'history-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Filter sessions...';
  searchInput.value = filter.searchText;
  searchInput.addEventListener('input', () => {
    filter.searchText = searchInput.value;
    renderList(project, container, instanceKey);
  });
  container.appendChild(searchInput);

  const listEl = document.createElement('div');
  listEl.className = 'history-list';
  container.appendChild(listEl);

  renderList(project, container, instanceKey);

  if (hadFocus) {
    searchInput.focus();
    if (caret !== null) searchInput.setSelectionRange(caret, caret);
  }
}

function renderProviderFilters(
  project: ProjectRecord,
  container: HTMLElement,
  instanceKey: string,
  providers: ProviderId[],
): HTMLElement {
  const filter = getFilterState(project.id);
  const row = document.createElement('div');
  row.className = 'history-filters';

  const makeChip = (value: 'all' | ProviderId, label: string, glyph?: string): HTMLElement => {
    const chip = document.createElement('button');
    chip.className = 'history-filter' + (filter.provider === value ? ' active' : '');
    if (glyph) {
      const icon = document.createElement('span');
      icon.className = 'history-filter-icon';
      icon.innerHTML = glyph;
      chip.appendChild(icon);
    }
    const text = document.createElement('span');
    text.textContent = label;
    chip.appendChild(text);
    chip.addEventListener('click', () => {
      filter.provider = value;
      renderSessionHistory(project, container, instanceKey);
    });
    return chip;
  };

  row.appendChild(makeChip('all', 'All'));
  for (const providerId of providers) {
    row.appendChild(makeChip(providerId, providerLabel(providerId), providerMark(providerId, 'tab')));
  }
  return row;
}

function renderList(project: ProjectRecord, container: HTMLElement, instanceKey: string): void {
  const listEl = container.querySelector('.history-list') as HTMLElement | null;
  if (!listEl) return;

  const filter = getFilterState(project.id);
  const list = transcriptsByProject.get(project.id) ?? [];
  const needle = filter.searchText.trim().toLowerCase();

  const items = list
    .filter((t) => filter.provider === 'all' || t.providerId === filter.provider)
    .filter((t) => !needle || t.name.toLowerCase().includes(needle))
    .slice(0, MAX_VISIBLE);

  listEl.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = needle
      ? 'No session matches that filter.'
      : 'No sessions from your CLI tools in this project yet.';
    listEl.appendChild(empty);
    // A stale panel (project switched while loading) must not resurrect a list.
    if (activePanels.get(project.id)?.get(instanceKey) !== container) return;
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.style.cursor = 'pointer';
    row.title = `${item.name}\n${providerLabel(item.providerId)} · ${item.cliSessionId}`;
    row.addEventListener('click', () => {
      appState.setActiveProject(project.id);
      appState.openCliSession(project.id, item.cliSessionId, item.name, item.providerId, item.profileId);
    });

    const icon = document.createElement('span');
    icon.className = 'history-provider-mark';
    icon.innerHTML = providerMark(item.providerId, 'tab');
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'history-item-info';

    const name = document.createElement('div');
    name.className = 'history-item-name';
    name.textContent = item.name;
    info.appendChild(name);

    const details = document.createElement('div');
    details.className = 'history-item-details';
    const when = Number.isFinite(item.mtimeMs) && item.mtimeMs > 0 ? relativeTime(item.mtimeMs) : '';
    details.textContent = when ? `${providerLabel(item.providerId)} · ${when}` : providerLabel(item.providerId);
    info.appendChild(details);

    row.appendChild(info);
    listEl.appendChild(row);
  }
}

async function loadTranscripts(
  project: ProjectRecord,
  container: HTMLElement,
  instanceKey: string,
): Promise<void> {
  const token = (loadTokens.get(project.id) ?? 0) + 1;
  loadTokens.set(project.id, token);
  inFlight.add(project.id);

  let list: ProjectTranscript[] = [];
  try {
    list = await window.rcode.session.projectTranscripts(project.path);
  } catch {
    list = [];
  } finally {
    inFlight.delete(project.id);
  }

  // A newer load for this project supersedes this one.
  if (loadTokens.get(project.id) !== token) return;
  transcriptsByProject.set(project.id, list);

  // The panel may have re-rendered (or been closed) while we awaited.
  if (activePanels.get(project.id)?.get(instanceKey) !== container) return;
  paintPanel(project, container, instanceKey);
}

export function closeSessionHistory(projectId: string, instanceKey: string = DEFAULT_INSTANCE_KEY): void {
  const panels = activePanels.get(projectId);
  panels?.delete(instanceKey);
  if (panels && panels.size === 0) activePanels.delete(projectId);
  dropCache(projectId);
}

export function clearProjectState(projectId: string): void {
  filterStateByProject.delete(projectId);
  activePanels.delete(projectId);
  dropCache(projectId);
}

function dropCache(projectId: string): void {
  transcriptsByProject.delete(projectId);
  loadTokens.delete(projectId);
  inFlight.delete(projectId);
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  copilot: 'GitHub Copilot',
  gemini: 'Gemini CLI',
  pi: 'Pi',
  opencode: 'OpenCode',
  custom: 'Custom CLI',
};

function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

/** Compact relative timestamp: "just now", "3h ago", "2d ago", then a date. */
function relativeTime(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  if (!Number.isFinite(diff) || diff < 0) return '';
  const minute = 60_000;
  if (diff < minute) return 'just now';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}m ago`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))}h ago`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))}d ago`;
  return new Date(mtimeMs).toLocaleDateString();
}
