import { beforeEach, describe, expect, it, vi } from 'vitest';

// explorer-panel.ts grabs a handful of DOM nodes at module load and pulls in
// the app-state import graph; stub the browser globals and the file-tree module
// so the component can be exercised in the node test environment. The component
// is imported dynamically (after stubDom) like sidebar.test.ts does.

class FakeClassList {
  private set = new Set<string>();
  add(c: string) { this.set.add(c); }
  remove(c: string) { this.set.delete(c); }
  toggle(c: string, force?: boolean) {
    const on = force ?? !this.set.has(c);
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  contains(c: string) { return this.set.has(c); }
}

class FakeElement {
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  innerHTML = '';
  private handlers: Record<string, (() => void)[]> = {};
  appendChild(c: FakeElement) { this.children.push(c); return c; }
  addEventListener(evt: string, fn: () => void) {
    (this.handlers[evt] ??= []).push(fn);
  }
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  setAttribute() {}
  remove() {}
  click(evt = 'click') { for (const fn of this.handlers[evt] ?? []) fn(); }
}

const els = new Map<string, FakeElement>();
function getById(id: string) {
  if (!els.has(id)) els.set(id, new FakeElement());
  return els.get(id)!;
}

function stubDom() {
  const doc = {
    getElementById: getById,
    createElement: () => new FakeElement(),
    addEventListener: () => {},
    body: new FakeElement(),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    rcode: { store: { load: vi.fn(), save: vi.fn() } },
    innerWidth: 1400,
    addEventListener: () => {},
  });
}

const mocks = vi.hoisted(() => ({
  renderFileTree: vi.fn(),
  closeFileTree: vi.fn(),
}));
vi.mock('./file-tree.js', () => mocks);

const searchMocks = vi.hoisted(() => ({
  initExplorerSearch: vi.fn(),
  resetExplorerSearch: vi.fn(),
}));
vi.mock('./explorer-search.js', () => searchMocks);

describe('explorer-panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    els.clear();
    stubDom();
  });

  async function load() {
    vi.resetModules();
    const [{ appState, _resetForTesting }, { initExplorerPanel, toggleExplorerPanel }] = await Promise.all([
      import('../state.js'),
      import('./explorer-panel.js'),
    ]);
    _resetForTesting();
    return { appState, initExplorerPanel, toggleExplorerPanel };
  }

  // Each fixture project needs its own root: addProject() collapses a repeated
  // path onto the existing project (one folder = one sidebar entry).
  function project(appState: any, id = 'p1', path = `/proj-${id}`) {
    return appState.addProject(id, path);
  }

  it('starts closed: panel hidden, no tree rendered', async () => {
    const { initExplorerPanel } = await load();
    initExplorerPanel();
    expect(getById('explorer-panel').classList.contains('hidden')).toBe(true);
    expect(mocks.renderFileTree).not.toHaveBeenCalled();
  });

  it('initializes the explorer search once when the panel is initialized', async () => {
    const { initExplorerPanel } = await load();
    initExplorerPanel();
    expect(searchMocks.initExplorerSearch).toHaveBeenCalledTimes(1);
  });

  it('opens on state change: renders the tree for the active project', async () => {
    const { appState, initExplorerPanel } = await load();
    project(appState);
    initExplorerPanel();
    appState.setExplorerPanelOpen(true);
    expect(getById('explorer-panel').classList.contains('hidden')).toBe(false);
    expect(mocks.renderFileTree).toHaveBeenCalledTimes(1);
    expect(mocks.renderFileTree).toHaveBeenCalledWith(appState.activeProject, getById('explorer-content'));
  });

  it('closing stops watching and clears the tree', async () => {
    const { appState, initExplorerPanel } = await load();
    const { id } = project(appState);
    initExplorerPanel();
    appState.setExplorerPanelOpen(true);
    appState.setExplorerPanelOpen(false);
    expect(getById('explorer-panel').classList.contains('hidden')).toBe(true);
    expect(mocks.closeFileTree).toHaveBeenCalledWith(id);
    expect(getById('explorer-content').innerHTML).toBe('');
  });

  it('re-points the tree when the active project changes', async () => {
    const { appState, initExplorerPanel } = await load();
    const p1 = project(appState, 'p1');
    const p2 = project(appState, 'p2');
    appState.setActiveProject(p1.id);
    initExplorerPanel();
    appState.setExplorerPanelOpen(true);
    expect(mocks.renderFileTree).toHaveBeenCalledWith(p1, getById('explorer-content'));
    appState.setActiveProject(p2.id);
    expect(mocks.closeFileTree).toHaveBeenCalledWith(p1.id);
    expect(mocks.renderFileTree).toHaveBeenLastCalledWith(p2, getById('explorer-content'));
  });

  it('toggle button flips the persisted open state', async () => {
    const { appState, initExplorerPanel, toggleExplorerPanel } = await load();
    project(appState);
    initExplorerPanel();
    getById('btn-toggle-explorer').click();
    expect(appState.explorerPanelOpen).toBe(true);
    getById('btn-toggle-explorer').click();
    expect(appState.explorerPanelOpen).toBe(false);
    expect(toggleExplorerPanel).toBeTypeOf('function');
  });

  it('close button closes the panel', async () => {
    const { appState, initExplorerPanel } = await load();
    project(appState);
    initExplorerPanel();
    appState.setExplorerPanelOpen(true);
    getById('btn-close-explorer').click();
    expect(appState.explorerPanelOpen).toBe(false);
    expect(getById('explorer-panel').classList.contains('hidden')).toBe(true);
  });

  it('hides the toggle button when the File Tree preference is off', async () => {
    const { appState, initExplorerPanel } = await load();
    project(appState);
    initExplorerPanel();
    expect(getById('btn-toggle-explorer').classList.contains('hidden')).toBe(false);
    appState.setPreference('sidebarViews', {
      gitPanel: true, sessionHistory: true, fileTree: false, activeSessions: true,
    });
    expect(getById('btn-toggle-explorer').classList.contains('hidden')).toBe(true);
  });

  it('shows the resize handle only while the panel is open', async () => {
    const { appState, initExplorerPanel } = await load();
    project(appState);
    initExplorerPanel();
    expect(getById('explorer-resize-handle').classList.contains('hidden')).toBe(true);
    appState.setExplorerPanelOpen(true);
    expect(getById('explorer-resize-handle').classList.contains('hidden')).toBe(false);
    appState.setExplorerPanelOpen(false);
    expect(getById('explorer-resize-handle').classList.contains('hidden')).toBe(true);
  });

  it('applies a persisted width on init, clamped to the window', async () => {
    const { appState, initExplorerPanel } = await load();
    project(appState);
    appState.setExplorerWidth(520);
    initExplorerPanel();
    expect(getById('explorer-panel').style.width).toBe('520px');
  });

  it('clamps a persisted width that no longer fits the window', async () => {
    const { appState, initExplorerPanel } = await load();
    project(appState);
    appState.setExplorerWidth(5000);
    initExplorerPanel();
    // EXPLORER_MAX_WIDTH wins over the edge of the window.
    expect(getById('explorer-panel').style.width).toBe('640px');
  });

  describe('clampExplorerWidth', () => {
    it('keeps a width inside the panel bounds untouched', async () => {
      const { clampExplorerWidth } = await import('./explorer-panel.js');
      expect(clampExplorerWidth(320, 1400)).toBe(320);
    });

    it('never goes below the minimum', async () => {
      const { clampExplorerWidth } = await import('./explorer-panel.js');
      expect(clampExplorerWidth(10, 1400)).toBe(180);
    });

    it('never goes above the maximum', async () => {
      const { clampExplorerWidth } = await import('./explorer-panel.js');
      expect(clampExplorerWidth(9999, 1400)).toBe(640);
    });

    it('leaves room for the main area on a narrow window', async () => {
      const { clampExplorerWidth } = await import('./explorer-panel.js');
      // 900 - 420 leaves 480, under the 640 cap.
      expect(clampExplorerWidth(9999, 900)).toBe(480);
      // …but never below the minimum, even when the window is tiny.
      expect(clampExplorerWidth(9999, 400)).toBe(180);
    });
  });
});
