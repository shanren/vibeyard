import { appState } from '../state.js';
import { renderFileTree, closeFileTree } from './file-tree.js';
import { initExplorerSearch, resetExplorerSearch } from './explorer-search.js';
import { t } from '../i18n.js';

const panelEl = document.getElementById('explorer-panel')!;
const contentEl = document.getElementById('explorer-content')!;
const titleEl = document.getElementById('explorer-title')!;
const btnToggle = document.getElementById('btn-toggle-explorer')!;
const btnClose = document.getElementById('btn-close-explorer')!;

let renderedProjectId: string | null = null;

function applyVisibility(): void {
  const open = appState.explorerPanelOpen;
  panelEl.classList.toggle('hidden', !open);
  btnToggle.classList.toggle('active', open);
}

/** (Re)render the tree for the active project when it changed (or nothing yet). */
function renderTreeForActiveProject(): void {
  resetExplorerSearch();
  const project = appState.activeProject;
  if (project?.id === renderedProjectId) return;
  if (renderedProjectId) closeFileTree(renderedProjectId);
  renderedProjectId = project?.id ?? null;
  contentEl.innerHTML = '';
  if (project) renderFileTree(project, contentEl);
}

/** Toggle the right-hand Explorer panel (exported for keybinding reuse). */
export function toggleExplorerPanel(): void {
  appState.setExplorerPanelOpen(!appState.explorerPanelOpen);
}

export function initExplorerPanel(): void {
  initExplorerSearch();
  btnToggle.addEventListener('click', toggleExplorerPanel);
  btnClose.addEventListener('click', toggleExplorerPanel);

  // The toggle button is gated by the File Tree preference (Appearance).
  const applyPrefGate = () => {
    const enabled = appState.preferences.sidebarViews?.fileTree ?? true;
    btnToggle.classList.toggle('hidden', !enabled);
  };
  applyPrefGate();
  appState.on('preferences-changed', applyPrefGate);

  // Localized title; re-applied on locale change (preferences-changed fires).
  const applyTitle = () => { titleEl.textContent = t('sidebar.explorerTitle'); };
  applyTitle();
  appState.on('preferences-changed', applyTitle);

  appState.on('state-loaded', () => {
    applyPrefGate();
    applyVisibility();
    if (appState.explorerPanelOpen) renderTreeForActiveProject();
  });
  appState.on('explorer-toggled', () => {
    applyVisibility();
    if (appState.explorerPanelOpen) {
      renderTreeForActiveProject();
    } else {
      closeTree();
    }
  });
  // Re-point the tree when the active project changes while the panel is open.
  appState.on('project-changed', () => {
    if (appState.explorerPanelOpen) renderTreeForActiveProject();
  });
  appState.on('project-removed', (id) => {
    if (renderedProjectId === id) closeTree();
  });

  applyVisibility();
  if (appState.explorerPanelOpen) renderTreeForActiveProject();
}

function closeTree(): void {
  resetExplorerSearch();
  if (!renderedProjectId) return;
  closeFileTree(renderedProjectId);
  renderedProjectId = null;
  contentEl.innerHTML = '';
}
