import { appState } from '../state.js';
import { t } from '../i18n.js';
import type { SearchFilesResult } from '../../shared/types.js';

// Module-level state, cleared by resetExplorerSearch() so switching projects or
// closing the panel invalidates any in-flight results and restores the tree.
let searchSeq = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inputEl: HTMLInputElement | null = null;
let resultsEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;

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

function onInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { void runSearch(); }, 150);
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
  let result: SearchFilesResult;
  try {
    result = await window.rcode.fs.searchFiles(project.path, query);
  } catch {
    result = { files: [], truncated: false };
  }
  if (seq !== searchSeq) return; // a newer query is in flight — drop this stale result
  renderResults(result);
}

function renderResults(result: SearchFilesResult): void {
  if (!resultsEl || !contentEl) return;

  // Show results, hide the tree (the tree DOM is preserved, not destroyed).
  contentEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '';

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

export function initExplorerSearch(): void {
  inputEl = document.getElementById('explorer-search-input') as HTMLInputElement | null;
  resultsEl = document.getElementById('explorer-search-results');
  contentEl = document.getElementById('explorer-content');
  if (!inputEl || !resultsEl || !contentEl) return;

  const applyPlaceholder = () => {
    inputEl!.placeholder = t('explorer.searchPlaceholder');
  };
  applyPlaceholder();
  appState.on('preferences-changed', applyPlaceholder);

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
