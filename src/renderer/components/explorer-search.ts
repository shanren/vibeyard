import { appState } from '../state.js';
import { t } from '../i18n.js';
import type { SearchFilesResult, SearchTextMatch, SearchTextResult } from '../../shared/types.js';

/** Which result kind the Explorer search shows; persisted via Preferences.explorerSearchMode. */
export type ExplorerSearchMode = 'path' | 'content';

// Module-level state, cleared by resetExplorerSearch() so switching projects or
// closing the panel invalidates any in-flight results and restores the tree.
let searchSeq = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inputEl: HTMLInputElement | null = null;
let resultsEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;
let pathTabEl: HTMLElement | null = null;
let contentTabEl: HTMLElement | null = null;
let mode: ExplorerSearchMode = 'path';

const PATH_DEBOUNCE_MS = 150;
const CONTENT_DEBOUNCE_MS = 300;

/** Trim a raw query; a whitespace-only query collapses to '' (AC-10). */
export function normalizeQuery(raw: string): string {
  return raw.trim();
}

/**
 * Split a repo-relative result path into its directory and filename parts,
 * accepting both `/` (git fast path) and `\` (fallback walk on Windows).
 */
export function splitResultPath(filePath: string): { dir: string; name: string } {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (idx < 0) return { dir: '', name: filePath };
  return { dir: filePath.slice(0, idx), name: filePath.slice(idx + 1) };
}

/** Switch the search mode, persist the choice, and re-run the current query. */
export function setExplorerSearchMode(next: ExplorerSearchMode): void {
  mode = next;
  appState.setPreference('explorerSearchMode', next);
  applyModeUi();
  inputEl?.focus();

  // A mode switch counts as a new search: drop any in-flight result from the
  // other mode and re-run the current query immediately (no extra typing).
  searchSeq++;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (inputEl && normalizeQuery(inputEl.value) !== '') void runSearch();
}

function onInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { void runSearch(); }, mode === 'content' ? CONTENT_DEBOUNCE_MS : PATH_DEBOUNCE_MS);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    resetExplorerSearch();
  }
}

async function runSearch(): Promise<void> {
  const project = appState.activeProject;
  if (!project || !inputEl) return;

  const query = normalizeQuery(inputEl.value);
  if (query === '') {
    resetExplorerSearch();
    return;
  }

  const seq = ++searchSeq;
  if (mode === 'content') renderSearching();
  if (mode === 'content') {
    let result: SearchTextResult;
    try {
      result = await window.rcode.fs.searchText(project.path, query);
    } catch {
      result = { matches: [], truncated: false, engine: 'git', tookMs: 0 };
    }
    if (seq !== searchSeq) return; // a newer query is in flight — drop this stale result
    renderContentResults(result);
  } else {
    let result: SearchFilesResult;
    try {
      result = await window.rcode.fs.searchFiles(project.path, query);
    } catch {
      result = { files: [], truncated: false };
    }
    if (seq !== searchSeq) return; // a newer query is in flight — drop this stale result
    renderResults(result);
  }
}

/** Show the results pane and hide the tree (the tree DOM is preserved, not destroyed). */
function showResults(): void {
  if (!resultsEl || !contentEl) return;
  contentEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '';
}

function renderResults(result: SearchFilesResult): void {
  if (!resultsEl || !contentEl) return;

  showResults();

  if (result.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'explorer-search-empty';
    empty.textContent = t('explorer.searchNoResults');
    resultsEl.appendChild(empty);
    return;
  }

  for (const filePath of result.files) {
    resultsEl.appendChild(createResultRow(filePath));
  }

  if (result.truncated) {
    const footnote = document.createElement('div');
    footnote.className = 'explorer-search-footnote';
    footnote.textContent = t('explorer.searchTooMany');
    resultsEl.appendChild(footnote);
  }
}

function renderSearching(): void {
  if (!resultsEl || !contentEl) return;
  showResults();
  const searching = document.createElement('div');
  searching.className = 'explorer-search-empty';
  searching.textContent = t('explorer.searching');
  resultsEl.appendChild(searching);
}

function renderContentResults(result: SearchTextResult): void {
  if (!resultsEl || !contentEl) return;

  showResults();

  if (result.matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'explorer-search-empty';
    empty.textContent = t('explorer.searchTextNoResults');
    resultsEl.appendChild(empty);
    if (result.truncated) appendContentFootnote();
    return;
  }

  // Group matches by file, preserving the engine's ordering (most relevant first).
  const groups = new Map<string, SearchTextMatch[]>();
  for (const match of result.matches) {
    const list = groups.get(match.path);
    if (list) list.push(match);
    else groups.set(match.path, [match]);
  }
  for (const [filePath, matches] of groups) {
    resultsEl.appendChild(createFileGroup(filePath, matches));
  }

  if (result.truncated) appendContentFootnote();
}

function appendContentFootnote(): void {
  if (!resultsEl) return;
  const footnote = document.createElement('div');
  footnote.className = 'explorer-search-footnote';
  footnote.textContent = t('explorer.searchTextTruncated');
  resultsEl.appendChild(footnote);
}

function createFileGroup(filePath: string, matches: SearchTextMatch[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'explorer-search-file';

  const header = document.createElement('div');
  header.className = 'explorer-search-file-header';
  const { dir, name } = splitResultPath(filePath);

  const nameEl = document.createElement('span');
  nameEl.className = 'explorer-search-filename';
  nameEl.textContent = name;
  header.appendChild(nameEl);

  if (dir) {
    const dirEl = document.createElement('span');
    dirEl.className = 'explorer-search-dir';
    dirEl.textContent = dir;
    header.appendChild(dirEl);
  }

  const countEl = document.createElement('span');
  countEl.className = 'explorer-search-count';
  countEl.textContent = `(${matches.length})`;
  header.appendChild(countEl);
  group.appendChild(header);

  for (const match of matches) {
    group.appendChild(createMatchRow(filePath, match));
  }
  return group;
}

function createMatchRow(filePath: string, match: SearchTextMatch): HTMLElement {
  const row = document.createElement('div');
  row.className = 'explorer-search-line';

  const noEl = document.createElement('span');
  noEl.className = 'explorer-search-line-no';
  noEl.textContent = String(match.line);
  row.appendChild(noEl);

  const textEl = document.createElement('span');
  textEl.className = 'explorer-search-line-text';
  textEl.textContent = match.text;
  row.appendChild(textEl);

  row.addEventListener('click', () => {
    const project = appState.activeProject;
    if (!project) return;
    appState.addFileReaderSession(project.id, filePath, match.line);
  });

  return row;
}

function createResultRow(filePath: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'explorer-search-item';

  const { dir, name } = splitResultPath(filePath);

  const nameEl = document.createElement('span');
  nameEl.className = 'explorer-search-filename';
  nameEl.textContent = name;
  row.appendChild(nameEl);

  if (dir) {
    const dirEl = document.createElement('span');
    dirEl.className = 'explorer-search-dir';
    dirEl.textContent = dir;
    row.appendChild(dirEl);
  }

  row.addEventListener('click', () => {
    const project = appState.activeProject;
    if (!project) return;
    appState.addFileReaderSession(project.id, filePath);
  });

  return row;
}

function applyModeUi(): void {
  const isContent = mode === 'content';
  if (pathTabEl) {
    pathTabEl.classList.toggle('active', !isContent);
    pathTabEl.setAttribute('aria-selected', String(!isContent));
  }
  if (contentTabEl) {
    contentTabEl.classList.toggle('active', isContent);
    contentTabEl.setAttribute('aria-selected', String(isContent));
  }
  if (inputEl) {
    inputEl.placeholder = t(isContent ? 'explorer.searchTextPlaceholder' : 'explorer.searchPlaceholder');
  }
}

export function initExplorerSearch(): void {
  inputEl = document.getElementById('explorer-search-input') as HTMLInputElement | null;
  resultsEl = document.getElementById('explorer-search-results');
  contentEl = document.getElementById('explorer-content');
  if (!inputEl || !resultsEl || !contentEl) return;

  pathTabEl = document.getElementById('explorer-tab-path');
  contentTabEl = document.getElementById('explorer-tab-content');
  if (pathTabEl) {
    pathTabEl.textContent = t('explorer.searchMode.path');
    pathTabEl.addEventListener('click', () => setExplorerSearchMode('path'));
  }
  if (contentTabEl) {
    contentTabEl.textContent = t('explorer.searchMode.content');
    contentTabEl.addEventListener('click', () => setExplorerSearchMode('content'));
  }

  mode = appState.preferences.explorerSearchMode ?? 'path';
  applyModeUi();
  appState.on('preferences-changed', applyModeUi);

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeydown);
}

export function resetExplorerSearch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  searchSeq++; // invalidate any in-flight request
  if (inputEl) inputEl.value = '';
  if (contentEl) contentEl.classList.remove('hidden');
  if (resultsEl) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
  }
}
