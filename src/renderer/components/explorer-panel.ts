import { appState } from '../state.js';
import { renderFileTree, closeFileTree } from './file-tree.js';
import { initExplorerSearch, resetExplorerSearch } from './explorer-search.js';
import { t } from '../i18n.js';

const panelEl = document.getElementById('explorer-panel')!;
const contentEl = document.getElementById('explorer-content')!;
const titleEl = document.getElementById('explorer-title')!;
const btnToggle = document.getElementById('btn-toggle-explorer')!;
const btnClose = document.getElementById('btn-close-explorer')!;
const resizeHandleEl = document.getElementById('explorer-resize-handle')!;

export const EXPLORER_MIN_WIDTH = 180;
export const EXPLORER_MAX_WIDTH = 640;
/** The main area never shrinks past this, so the tree cannot crowd out the terminal. */
const MAIN_AREA_MIN_WIDTH = 420;

let renderedProjectId: string | null = null;

function viewportWidth(): number {
  return window.innerWidth || 1280;
}

/**
 * Clamp a requested file-tree width to the panel's own bounds and to the room
 * the main area must keep. Pure so the drag maths is unit-testable.
 */
export function clampExplorerWidth(width: number, viewport: number): number {
  const max = Math.max(EXPLORER_MIN_WIDTH, Math.min(EXPLORER_MAX_WIDTH, viewport - MAIN_AREA_MIN_WIDTH));
  return Math.min(max, Math.max(EXPLORER_MIN_WIDTH, Math.round(width)));
}

/** Apply the persisted width (clamped to the current window) as an inline style. */
function applyStoredWidth(): void {
  const stored = appState.explorerWidth;
  if (!stored) return;
  panelEl.style.width = `${clampExplorerWidth(stored, viewportWidth())}px`;
}

function applyVisibility(): void {
  const open = appState.explorerPanelOpen;
  panelEl.classList.toggle('hidden', !open);
  // The drag strip only exists while the panel is open; when it is closed the
  // main area owns that edge (nothing to sit between).
  resizeHandleEl.classList.toggle('hidden', !open);
  btnToggle.classList.toggle('active', open);
}

/**
 * Drag the panel's left edge. Width is derived from the pointer's distance to
 * the window's right edge, then clamped and persisted on release — the same
 * shape as #sidebar-resize-handle, mirrored.
 */
function initResizeHandle(): void {
  resizeHandleEl.addEventListener('mousedown', (e) => {
    if (!appState.explorerPanelOpen) return;
    e.preventDefault();
    resizeHandleEl.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseUp = () => {
      resizeHandleEl.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const width = parseInt(panelEl.style.width, 10);
      if (width > 0) appState.setExplorerWidth(width);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (ev: MouseEvent) => {
      // Releasing outside the window never fires `mouseup` — treat a missing
      // button state as the release so the drag cannot stick.
      if (!ev.buttons) {
        onMouseUp();
        return;
      }
      const width = clampExplorerWidth(viewportWidth() - ev.clientX, viewportWidth());
      panelEl.style.width = `${width}px`;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // A narrower window can leave the stored width too wide for the main area.
  window.addEventListener('resize', () => {
    const current = parseInt(panelEl.style.width, 10);
    if (current > 0) {
      const clamped = clampExplorerWidth(current, viewportWidth());
      if (clamped !== current) panelEl.style.width = `${clamped}px`;
    }
  });
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
  initResizeHandle();
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
    applyStoredWidth();
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

  applyStoredWidth();
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
