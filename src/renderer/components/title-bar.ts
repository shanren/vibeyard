// In-app title bar.
//
// It owns the top row on every platform now: brand · the "⋯" application menu ·
// a spacer · the window/sidebar actions (toggle sidebar, new project). The old
// `#sidebar-header` row is gone — its buttons live here so the sidebar can be
// nothing but the project list.
//
// The application menu is the condensed form of the old File / Edit / View menu
// bar: one button, a two-column popup, categories on the left and the hovered
// category's items on the right (see dev/ and specs/…-vscode-design-tokens.md).

import { appState } from '../state.js';
import { t } from '../i18n.js';
import { isMac, isWin } from '../platform.js';
import { promptNewProject, toggleSidebar } from './sidebar.js';
import { showPreferencesModal } from './preferences-modal.js';
import { quickNewSession } from './tab-bar/session-menu.js';
import { closeSessionWithConfirm } from '../session-close.js';
import { toggleInspector } from './session-inspector.js';
import { toggleExplorerPanel } from './explorer-panel.js';
import { shortcutManager, displayKeys } from '../shortcuts.js';
import { getActiveContextMenu, hideTabContextMenu, setActiveContextMenu, positionMenu } from './tab-bar/menu.js';
import type { EditAction } from '../../shared/types.js';

/** The button whose popup is open (drives the .open state). */
let openButton: HTMLElement | null = null;

function clearOpenButton(): void {
  openButton?.classList.remove('open');
  openButton = null;
}

export function initTitleBar(): void {
  const bar = document.getElementById('title-bar');
  if (!bar) return;
  // The native frame is hidden on every platform now (see main.ts), so this bar
  // is the drag region. Windows overlays its system buttons on the right; macOS
  // keeps traffic lights inset on the left.
  if (isWin) bar.classList.add('win');
  if (isMac) bar.classList.add('mac');
  renderTitleBar(bar);

  document.addEventListener('click', clearOpenButton);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearOpenButton();
  });
}

export function renderTitleBar(root: HTMLElement): void {
  root.classList.add('active');
  root.innerHTML = '';

  const brand = document.createElement('span');
  brand.className = 'titlebar-brand';
  brand.textContent = t('titleBar.brand');
  root.appendChild(brand);

  root.appendChild(buildAppMenuButton());

  const spacer = document.createElement('div');
  spacer.className = 'titlebar-spacer';
  root.appendChild(spacer);

  root.appendChild(
    buildIconButton('btn-toggle-sidebar', t('titleBar.toggleSidebar'), '', toggleSidebar, [
      '<rect x="4" y="4" width="16" height="16" rx="2.4"/>',
      '<line x1="9" y1="4" x2="9" y2="20"/>',
    ]),
  );
  root.appendChild(
    buildIconButton('btn-add-project', t('titleBar.newProject'), 'primary', promptNewProject, [
      '<line x1="8" y1="3.5" x2="8" y2="12.5"/>',
      '<line x1="3.5" y1="8" x2="12.5" y2="8"/>',
    ]),
  );
}

/** A 26px square icon button living in the title bar. */
function buildIconButton(
  id: string,
  label: string,
  variant: 'primary' | '',
  onClick: () => void,
  paths: string[],
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'titlebar-icon-btn' + (variant ? ' primary' : '');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</svg>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function buildAppMenuButton(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btn-app-menu';
  btn.className = 'titlebar-icon-btn';
  btn.title = t('titleBar.appMenu');
  btn.setAttribute('aria-label', t('titleBar.appMenu'));
  btn.setAttribute('aria-haspopup', 'menu');
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (getActiveContextMenu() && openButton === btn) {
      hideTabContextMenu();
      clearOpenButton();
      return;
    }
    hideTabContextMenu();
    clearOpenButton();

    const popup = buildAppMenu();
    const rect = btn.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(popup);
    setActiveContextMenu(popup);
    btn.classList.add('open');
    openButton = btn;
    positionMenu(popup);
  });
  return btn;
}

interface Category {
  key: string;
  labelKey: string;
  build: (target: HTMLElement) => void;
}

/**
 * Two-column popup: categories on the left, the active category's items on the
 * right. Hovering a category swaps the right column — the shape of a condensed
 * menu bar, which is what the reference screenshot shows.
 */
function buildAppMenu(): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'tab-context-menu titlebar-app-menu';

  const left = document.createElement('div');
  left.className = 'app-menu-categories';
  const right = document.createElement('div');
  right.className = 'app-menu-items';
  popup.append(left, right);

  const categories: Category[] = [
    { key: 'file', labelKey: 'titleBar.file.label', build: (el) => buildFileMenu(el) },
    { key: 'edit', labelKey: 'titleBar.edit.label', build: (el) => buildEditMenu(el) },
    { key: 'view', labelKey: 'titleBar.view.label', build: (el) => buildViewMenu(el) },
    { key: 'window', labelKey: 'titleBar.window.label', build: (el) => buildWindowMenu(el) },
    { key: 'help', labelKey: 'titleBar.help.label', build: (el) => buildHelpMenu(el) },
  ];

  let active = categories[0].key;
  const rows = new Map<string, HTMLElement>();

  const show = (key: string): void => {
    active = key;
    for (const [k, row] of rows) row.classList.toggle('active', k === key);
    right.innerHTML = '';
    categories.find((c) => c.key === key)!.build(right);
  };

  for (const cat of categories) {
    const row = document.createElement('div');
    row.className = 'app-menu-category';
    row.innerHTML = `<span>${t(cat.labelKey)}</span><span class="app-menu-chevron">›</span>`;
    row.addEventListener('mouseenter', () => show(cat.key));
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      show(cat.key);
    });
    rows.set(cat.key, row);
    left.appendChild(row);
  }

  show(active);
  return popup;
}

function addItem(menu: HTMLElement, label: string, onClick: () => void, shortcut?: string): void {
  const item = document.createElement('div');
  item.className = 'tab-context-menu-item';
  if (shortcut) {
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const hint = document.createElement('span');
    hint.className = 'shortcut-hint';
    hint.textContent = shortcut;
    item.append(labelEl, hint);
  } else {
    item.textContent = label;
  }
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    clearOpenButton();
    onClick();
  });
  menu.appendChild(item);
}

function addSeparator(menu: HTMLElement): void {
  const sep = document.createElement('div');
  sep.className = 'tab-context-menu-separator';
  menu.appendChild(sep);
}

/** Platform-correct shortcut glyphs for a shortcut id, if any. */
function keysFor(id: string): string {
  const keys = shortcutManager.getKeys(id);
  return keys ? displayKeys(keys) : '';
}

function buildFileMenu(menu: HTMLElement): void {
  addItem(menu, t('titleBar.file.newProject'), promptNewProject, keysFor('new-project'));
  addItem(menu, t('titleBar.file.newSession'), quickNewSession, keysFor('new-session-alt'));
  addSeparator(menu);
  addItem(menu, t('titleBar.file.closeSession'), () => {
    const project = appState.activeProject;
    const session = appState.activeSession;
    if (project && session) closeSessionWithConfirm(project.id, session.id);
  }, keysFor('close-session'));
  addSeparator(menu);
  addItem(menu, t('titleBar.file.settings'), showPreferencesModal);
  addSeparator(menu);
  addItem(menu, t('titleBar.file.quit'), () => void window.vibeyard.menu.quitApp());
}

function buildEditMenu(menu: HTMLElement): void {
  // The user was focused on the terminal / an input before opening the menu;
  // restore that focus before dispatching so webContents edit commands act on
  // the element they expect, not on the menu button.
  const prevFocus = document.activeElement as HTMLElement | null;
  const dispatch = (action: EditAction): void => {
    queueMicrotask(() => {
      prevFocus?.focus?.();
      void window.vibeyard.menu.runEditAction(action);
    });
  };

  const groups: Array<EditAction | 'sep'> = [
    'undo', 'redo', 'sep', 'cut', 'copy', 'paste', 'sep', 'delete', 'selectAll',
  ];
  for (const g of groups) {
    if (g === 'sep') addSeparator(menu);
    else addItem(menu, t(`titleBar.edit.${g}`), () => dispatch(g));
  }
}

function buildViewMenu(menu: HTMLElement): void {
  addItem(menu, t('titleBar.view.toggleSplit'), () => appState.toggleSplit(), keysFor('toggle-split'));
  addSeparator(menu);
  addItem(menu, t('titleBar.view.toggleInspector'), toggleInspector, keysFor('toggle-inspector'));
  if (appState.preferences.debugMode) {
    addSeparator(menu);
    addItem(menu, t('titleBar.view.toggleDevTools'), () => void window.vibeyard.menu.toggleDevTools());
    addItem(menu, t('titleBar.view.reloadMainWindow'), () => void window.vibeyard.menu.reloadMainWindow());
  }
}

function buildWindowMenu(menu: HTMLElement): void {
  addItem(menu, t('titleBar.window.toggleSidebar'), toggleSidebar);
  addItem(menu, t('titleBar.window.toggleExplorer'), toggleExplorerPanel);
}

function buildHelpMenu(menu: HTMLElement): void {
  addItem(menu, t('titleBar.help.preferences'), showPreferencesModal);
  addItem(menu, t('titleBar.help.shortcuts'), showPreferencesModal);
}
