// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTitleBar, initTitleBar } from './title-bar.js';
import { appState } from '../state.js';
import { isWin } from '../platform.js';
import { promptNewProject, toggleSidebar } from './sidebar.js';
import { showPreferencesModal } from './preferences-modal.js';
import { quickNewSession } from './tab-bar/session-menu.js';
import { closeSessionWithConfirm } from '../session-close.js';
import { toggleInspector } from './session-inspector.js';
import { toggleExplorerPanel } from './explorer-panel.js';
import { hideTabContextMenu } from './tab-bar/menu.js';

// title-bar.ts pulls in a wide module graph (state, sidebar, session-menu, …)
// that grabs DOM nodes / sets up event wiring at import time. Mock those so we
// can exercise the DOM-building + menu logic in isolation. i18n / platform /
// the shared menu tracker stay real, so labels and open/close behaviour are
// integration-tested rather than stubbed.
const m = vi.hoisted(() => {
  const appStateMock = {
    preferences: { debugMode: false },
    activeProject: null as { id: string } | null,
    activeSession: null as { id: string } | null,
    toggleSplit: vi.fn(),
  };
  return {
    appState: appStateMock,
    promptNewProject: vi.fn(),
    toggleSidebar: vi.fn(),
    showPreferencesModal: vi.fn(),
    quickNewSession: vi.fn(),
    closeSessionWithConfirm: vi.fn(),
    toggleInspector: vi.fn(),
    toggleExplorerPanel: vi.fn(),
    shortcutManager: {
      getKeys: (id: string) =>
        ({
          'new-project': 'Ctrl+Shift+P',
          'new-session-alt': 'Ctrl+Shift+N',
          'close-session': 'Ctrl+W',
          'toggle-split': 'Ctrl+\\',
          'toggle-inspector': 'Ctrl+Shift+I',
        } as Record<string, string>)[id],
    },
    displayKeys: (acc: string) => acc,
  };
});

vi.mock('../state.js', () => ({ appState: m.appState }));
vi.mock('./sidebar.js', () => ({ promptNewProject: m.promptNewProject, toggleSidebar: m.toggleSidebar }));
vi.mock('./preferences-modal.js', () => ({ showPreferencesModal: m.showPreferencesModal }));
vi.mock('./tab-bar/session-menu.js', () => ({ quickNewSession: m.quickNewSession }));
vi.mock('../session-close.js', () => ({ closeSessionWithConfirm: m.closeSessionWithConfirm }));
vi.mock('./session-inspector.js', () => ({ toggleInspector: m.toggleInspector }));
vi.mock('./explorer-panel.js', () => ({ toggleExplorerPanel: m.toggleExplorerPanel }));
vi.mock('../shortcuts.js', () => ({
  shortcutManager: m.shortcutManager,
  displayKeys: m.displayKeys,
  SHORTCUT_DEFAULTS: [],
}));

function render(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'title-bar';
  document.body.appendChild(root);
  renderTitleBar(root);
  return root;
}

/** The single "⋯" application-menu button. */
function menuButton(root: HTMLElement): HTMLElement {
  return root.querySelector('#btn-app-menu') as HTMLElement;
}

/** Open the app menu and return the popup plus its two columns. */
function openAppMenu(root: HTMLElement) {
  menuButton(root).click();
  const popup = document.querySelector('.titlebar-app-menu') as HTMLElement;
  const categories = Array.from(popup.querySelectorAll('.app-menu-category')) as HTMLElement[];
  const items = () => Array.from(popup.querySelectorAll('.app-menu-items .tab-context-menu-item')) as HTMLElement[];
  return { popup, categories, items };
}

/** Category row label, e.g. "File". */
function categoryLabel(row: HTMLElement): string {
  return row.querySelector('span')?.textContent ?? '';
}

/** Item label text, skipping the trailing shortcut hint span. */
function itemLabel(item: HTMLElement): string {
  const label = item.querySelector(':scope > span:not(.shortcut-hint)');
  return label?.textContent ?? item.textContent ?? '';
}

/** Switch the popup to a category by index and return its items. */
function pick(root: HTMLElement, index: number): HTMLElement[] {
  const menu = openAppMenu(root);
  menu.categories[index].click();
  return menu.items();
}

describe('title-bar', () => {
  beforeEach(() => {
    appState.preferences.debugMode = false;
    appState.activeProject = null;
    appState.activeSession = null;
    document.body.innerHTML = '';
    vi.clearAllMocks();
    (window as any).rcode = {
      menu: {
        runEditAction: vi.fn(),
        quitApp: vi.fn(),
        toggleDevTools: vi.fn(),
        reloadMainWindow: vi.fn(),
      },
    };
  });

  afterEach(() => {
    hideTabContextMenu();
  });

  it('renders the brand, the app menu and the two title-bar actions', () => {
    const root = render();
    expect(root.classList.contains('active')).toBe(true);
    expect(root.querySelector('.titlebar-brand')?.textContent).toBe('RCode');
    expect(menuButton(root).getAttribute('aria-haspopup')).toBe('menu');
    // The sidebar-header buttons moved here.
    expect(root.querySelector('#btn-toggle-sidebar')).not.toBeNull();
    expect(root.querySelector('#btn-add-project')).not.toBeNull();
  });

  it('title-bar actions wire toggleSidebar / promptNewProject', () => {
    const root = render();
    (root.querySelector('#btn-toggle-sidebar') as HTMLElement).click();
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    (root.querySelector('#btn-add-project') as HTMLElement).click();
    expect(promptNewProject).toHaveBeenCalledTimes(1);
  });

  it('the app menu is a two-column popup with five categories', () => {
    const root = render();
    const { categories } = openAppMenu(root);
    expect(categories.map(categoryLabel)).toEqual(['File', 'Edit', 'View', 'Window', 'Help']);
    // First category is selected by default, so its items show immediately.
    expect(document.querySelectorAll('.app-menu-category.active')).toHaveLength(1);
  });

  it('hovering a category swaps the right-hand item column', () => {
    const root = render();
    const { categories, items } = openAppMenu(root);
    expect(items().map(itemLabel)).toEqual(['New Project', 'New Session', 'Close Session', 'Settings', 'Quit']);

    categories[1].dispatchEvent(new MouseEvent('mouseenter'));
    expect(items().map(itemLabel)).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All']);
  });

  it('File lists actions and wires New Project / New Session / Settings / Quit', () => {
    const root = render();
    let items = pick(root, 0);
    items[0].click();
    expect(promptNewProject).toHaveBeenCalledTimes(1);

    items = pick(root, 0);
    items[1].click();
    expect(quickNewSession).toHaveBeenCalledTimes(1);

    items = pick(root, 0);
    items[3].click();
    expect(showPreferencesModal).toHaveBeenCalledTimes(1);

    items = pick(root, 0);
    items[4].click();
    expect((window as any).rcode.menu.quitApp).toHaveBeenCalledTimes(1);
  });

  it('Close Session only fires with an active project and session', () => {
    const root = render();
    pick(root, 0)[2].click();
    expect(closeSessionWithConfirm).not.toHaveBeenCalled();

    appState.activeProject = { id: 'p1' } as any;
    appState.activeSession = { id: 's1' } as any;
    pick(root, 0)[2].click();
    expect(closeSessionWithConfirm).toHaveBeenCalledWith('p1', 's1');
  });

  it('File shows shortcut hints', () => {
    const root = render();
    pick(root, 0);
    const hints = Array.from(
      document.querySelectorAll('.titlebar-app-menu .shortcut-hint'),
    ) as HTMLElement[];
    expect(hints.map((h) => h.textContent)).toEqual(['Ctrl+Shift+P', 'Ctrl+Shift+N', 'Ctrl+W']);
  });

  it('Edit dispatches webContents edit actions', async () => {
    const root = render();
    let items = pick(root, 1);
    expect(items.map(itemLabel)).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All']);

    items[0].click();
    await Promise.resolve();
    expect((window as any).rcode.menu.runEditAction).toHaveBeenCalledWith('undo');

    items = pick(root, 1);
    items[6].click();
    await Promise.resolve();
    expect((window as any).rcode.menu.runEditAction).toHaveBeenLastCalledWith('selectAll');
  });

  it('View shows split and inspector, no debug items by default', () => {
    const root = render();
    expect(pick(root, 2).map(itemLabel)).toEqual(['Toggle Split Mode', 'Toggle Session Inspector']);
  });

  it('View wires Toggle Split / Toggle Inspector', () => {
    const root = render();
    pick(root, 2)[0].click();
    expect(appState.toggleSplit).toHaveBeenCalledTimes(1);
    pick(root, 2)[1].click();
    expect(toggleInspector).toHaveBeenCalledTimes(1);
  });

  it('View adds debug items and wires them when debug mode is on', () => {
    appState.preferences.debugMode = true;
    const root = render();
    const items = pick(root, 2);
    expect(items.map(itemLabel)).toEqual([
      'Toggle Split Mode',
      'Toggle Session Inspector',
      'Toggle DevTools',
      'Reload Main Window',
    ]);

    items[2].click();
    expect((window as any).rcode.menu.toggleDevTools).toHaveBeenCalledTimes(1);
    pick(root, 2)[3].click();
    expect((window as any).rcode.menu.reloadMainWindow).toHaveBeenCalledTimes(1);
  });

  it('Window wires sidebar and explorer toggles', () => {
    const root = render();
    const items = pick(root, 3);
    expect(items.map(itemLabel)).toEqual(['Toggle Sidebar', 'Toggle Explorer']);
    items[0].click();
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    pick(root, 3)[1].click();
    expect(toggleExplorerPanel).toHaveBeenCalledTimes(1);
  });

  it('Help opens preferences', () => {
    const root = render();
    const items = pick(root, 4);
    expect(items.map(itemLabel)).toEqual(['Preferences', 'Keyboard Shortcuts']);
    items[0].click();
    expect(showPreferencesModal).toHaveBeenCalledTimes(1);
  });

  it('clicking the menu button again closes the popup', () => {
    const root = render();
    openAppMenu(root);
    expect(document.querySelectorAll('.tab-context-menu')).toHaveLength(1);
    menuButton(root).click();
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('initTitleBar builds the bar on every platform', () => {
    const bar = document.createElement('div');
    bar.id = 'title-bar';
    document.body.appendChild(bar);
    initTitleBar();
    expect(bar.classList.contains('active')).toBe(true);
    // The Windows drag-region class is platform-specific.
    expect(bar.classList.contains('win')).toBe(isWin);
  });

  it('CSS reserves a drag region and no-drag on the buttons', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'styles', 'title-bar.css'), 'utf8');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
  });
});
