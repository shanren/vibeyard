import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchFilesResult, SearchTextResult } from '../../shared/types.js';

const { showContextMenuMock, showConfirmModalMock } = vi.hoisted(() => ({
  showContextMenuMock: vi.fn(),
  showConfirmModalMock: vi.fn(),
}));

// The right-click menu and its modal prompts are exercised in
// file-entry-menu.test.ts; here they are spies so a row's wiring can be asserted.
vi.mock('./context-menu.js', () => ({
  showContextMenu: (...args: unknown[]) => showContextMenuMock(...args),
  hideContextMenu: vi.fn(),
  isSeparator: (entry: { separator?: boolean }) => entry?.separator === true,
}));

vi.mock('./modal.js', () => ({
  showModal: vi.fn(),
  showConfirmModal: (...args: unknown[]) => showConfirmModalMock(...args),
  showConfirmDialog: vi.fn(),
  showPropertiesDialog: vi.fn(),
}));

class FakeClassList {
  private values = new Set<string>();
  add(...tokens: string[]): void { for (const t of tokens) this.values.add(t); }
  remove(...tokens: string[]): void { for (const t of tokens) this.values.delete(t); }
  toggle(token: string, force?: boolean): boolean {
    const on = force ?? !this.values.has(token);
    if (on) this.values.add(token); else this.values.delete(token);
    return on;
  }
  contains(token: string): boolean { return this.values.has(token); }
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  private _className = '';
  classList = new FakeClassList();
  textContent = '';

  /** DOM semantics: assigning `className` replaces the element's class list. */
  get className(): string { return this._className; }
  set className(v: string) {
    this._className = v;
    this.classList = new FakeClassList();
    for (const token of v.split(/\s+/).filter(Boolean)) this.classList.add(token);
  }
  value = '';
  placeholder = '';
  listeners = new Map<string, Array<(event?: any) => void>>();
  attributes = new Map<string, string>();
  private _innerHTML = '';
  get innerHTML(): string { return this._innerHTML; }
  set innerHTML(v: string) { this._innerHTML = v; if (v === '') this.children = []; }

  constructor(public tagName: string) {}

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  focused = false;
  focus(): void { this.focused = true; }

  /** Minimal `.class` selector support over the FakeElement tree. */
  querySelectorAll(selector: string): FakeElement[] {
    const wanted = selector.replace(/^\./, '');
    const out: FakeElement[] = [];
    const collect = (el: FakeElement): void => {
      for (const child of el.children) {
        if (child.classList.contains(wanted)) out.push(child);
        collect(child);
      }
    };
    collect(this);
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }

  addEventListener(event: string, cb: (event?: any) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  dispatch(event: string, payload: any = {}): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
}

const els = new Map<string, FakeElement>();
function getById(id: string): FakeElement {
  if (!els.has(id)) els.set(id, new FakeElement(id));
  return els.get(id)!;
}

const searchFilesMock = vi.fn();
const searchTextMock = vi.fn();
const revealItemMock = vi.fn(() => Promise.resolve({ ok: true }));
const openInFolderMock = vi.fn(() => Promise.resolve({ ok: true }));
const trashItemMock = vi.fn(() => Promise.resolve({ ok: true }));
const clipboardWriteMock = vi.fn(() => Promise.resolve());

function stubDom(): void {
  const doc = {
    getElementById: getById,
    createElement: (tagName: string) => new FakeElement(tagName),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    rcode: {
      store: { load: vi.fn(), save: vi.fn() },
      fs: {
        searchFiles: searchFilesMock,
        searchText: searchTextMock,
        revealItem: revealItemMock,
        openInFolder: openInFolderMock,
        trashItem: trashItemMock,
      },
      clipboard: { write: clipboardWriteMock },
    },
  });
  // Mirror index.html: #explorer-search-results starts with the `hidden` class.
  getById('explorer-search-results').classList.add('hidden');
}

/** Fire a contextmenu event on a stubbed element (the handler calls both). */
function rightClick(el: FakeElement, x = 40, y = 60): void {
  el.dispatch('contextmenu', { clientX: x, clientY: y, preventDefault: vi.fn(), stopPropagation: vi.fn() });
}

/** Labels of the actionable rows in a menu spec, in order. */
function menuLabels(entries: any[]): string[] {
  return entries.filter((e) => !e.separator).map((e) => e.label);
}

function actionFor(entries: any[], label: string): () => void {
  const found = entries.find((e) => !e.separator && e.label === label);
  if (!found) throw new Error(`no menu entry labelled ${label}`);
  return found.action;
}

async function load() {
  vi.resetModules();
  const [{ appState, _resetForTesting }, mod] = await Promise.all([
    import('../state.js'),
    import('./explorer-search.js'),
  ]);
  _resetForTesting();
  return { appState, ...mod };
}

function project(appState: any) {
  return appState.addProject('proj', '/proj');
}

describe('normalizeQuery', () => {
  it('treats whitespace-only input as empty (AC-5/AC-10)', async () => {
    const { normalizeQuery } = await load();
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery('\t\n')).toBe('');
  });

  it('trims surrounding whitespace', async () => {
    const { normalizeQuery } = await load();
    expect(normalizeQuery('  store  ')).toBe('store');
    expect(normalizeQuery('store')).toBe('store');
  });
});

describe('splitResultPath', () => {
  it('splits on the last path separator into dir + filename', async () => {
    const { splitResultPath } = await load();
    expect(splitResultPath('src/renderer/state.ts')).toEqual({ dir: 'src/renderer', name: 'state.ts' });
    expect(splitResultPath('B.ts')).toEqual({ dir: '', name: 'B.ts' });
    expect(splitResultPath('src\\renderer\\state.ts')).toEqual({ dir: 'src\\renderer', name: 'state.ts' });
  });
});

describe('explorer-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    els.clear();
    stubDom();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets the search placeholder on init (AC-1)', async () => {
    const { initExplorerSearch } = await load();
    initExplorerSearch();
    expect(getById('explorer-search-input').placeholder).toBe('Search files');
  });

  it('starts with the tree visible and results hidden, without searching (AC-2)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    expect(getById('explorer-content').classList.contains('hidden')).toBe(false);
    expect(getById('explorer-search-results').classList.contains('hidden')).toBe(true);
    expect(searchFilesMock).not.toHaveBeenCalled();
  });

  it('debounces input and searches after 150ms (AC-3)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['a.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'store';
    input.dispatch('input');

    expect(searchFilesMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(149);
    expect(searchFilesMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(searchFilesMock).toHaveBeenCalledTimes(1);
    expect(searchFilesMock).toHaveBeenCalledWith('/proj', 'store');
  });

  it('drops stale results when a newer query resolves first (AC-4)', async () => {
    const resolvers: Array<(r: SearchFilesResult) => void> = [];
    searchFilesMock.mockImplementation(() => new Promise<SearchFilesResult>((resolve) => resolvers.push(resolve)));

    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();

    const input = getById('explorer-search-input');
    input.value = 's';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);
    input.value = 'store';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);
    expect(searchFilesMock).toHaveBeenCalledTimes(2);

    // Resolve the newest first, then the stale one — stale must be discarded.
    resolvers[1]({ files: ['store.ts'], truncated: false });
    await Promise.resolve();
    resolvers[0]({ files: ['stale.ts'], truncated: false });
    await Promise.resolve();

    const results = getById('explorer-search-results');
    expect(results.children).toHaveLength(1);
    expect(results.children[0].children[0].textContent).toBe('store.ts');
  });

  it('treats whitespace-only input as empty and restores the tree (AC-5)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();

    const input = getById('explorer-search-input');
    input.value = '   ';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);

    expect(searchFilesMock).not.toHaveBeenCalled();
    expect(getById('explorer-content').classList.contains('hidden')).toBe(false);
    expect(getById('explorer-search-results').classList.contains('hidden')).toBe(true);
  });

  it('renders a flat list with relative paths (AC-6)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['src/renderer/state.ts', 'B.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'state';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);

    const results = getById('explorer-search-results');
    expect(results.classList.contains('hidden')).toBe(false);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(true);
    expect(results.children).toHaveLength(2);

    const first = results.children[0];
    expect(first.children[0].textContent).toBe('state.ts');
    expect(first.children[1].textContent).toBe('src/renderer');

    const second = results.children[1];
    expect(second.children[0].textContent).toBe('B.ts');
    expect(second.children).toHaveLength(1);
  });

  it('shows a truncation footnote when truncated is true (AC-8)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['a.ts'], truncated: true });

    const input = getById('explorer-search-input');
    input.value = 'a';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);

    const results = getById('explorer-search-results');
    const footnote = results.children[results.children.length - 1];
    expect(footnote.textContent).toBe('500+ matches — refine your query');
  });

  it('shows the no-results empty state (AC-9)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: [], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'zzz';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);

    const results = getById('explorer-search-results');
    expect(results.classList.contains('hidden')).toBe(false);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(true);
    expect(results.children).toHaveLength(1);
    expect(results.children[0].textContent).toBe('No files found');
  });

  it('Escape clears the query and restores the tree (AC-10)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['a.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'a';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(true);

    input.dispatch('keydown', { key: 'Escape', preventDefault() {} });

    expect(input.value).toBe('');
    expect(getById('explorer-search-results').classList.contains('hidden')).toBe(true);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(false);
  });

  it('clearing the query restores the tree (AC-11)', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['a.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'a';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(true);

    input.value = '';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);

    expect(getById('explorer-search-results').classList.contains('hidden')).toBe(true);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(false);
  });

  it('calls searchText instead of searchFiles in content mode', async () => {
    const { appState, initExplorerSearch, setExplorerSearchMode } = await load();
    project(appState);
    initExplorerSearch();
    searchTextMock.mockResolvedValue({ matches: [], truncated: false, engine: 'git', tookMs: 0 });

    setExplorerSearchMode('content');
    const input = getById('explorer-search-input');
    expect(input.placeholder).toBe('Search file contents');
    input.value = 'needle';
    input.dispatch('input');

    // content mode debounces longer (300ms) than path mode (150ms)
    await vi.advanceTimersByTimeAsync(299);
    expect(searchTextMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(searchTextMock).toHaveBeenCalledWith('/proj', 'needle');
    expect(searchFilesMock).not.toHaveBeenCalled();
  });

  it('re-runs the current query when the tab changes', async () => {
    const { appState, initExplorerSearch, setExplorerSearchMode } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['a.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'needle';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);
    expect(searchFilesMock).toHaveBeenCalledTimes(1);

    searchFilesMock.mockClear();
    searchTextMock.mockResolvedValue({ matches: [], truncated: false, engine: 'git', tookMs: 0 });
    setExplorerSearchMode('content');

    expect(input.value).toBe('needle'); // query text survives the switch
    expect(searchTextMock).toHaveBeenCalledWith('/proj', 'needle'); // re-ran immediately
    expect(searchFilesMock).not.toHaveBeenCalled();
  });

  it('renders matches grouped by file with line numbers and opens at the line', async () => {
    const { appState, initExplorerSearch, setExplorerSearchMode } = await load();
    const proj = project(appState);
    initExplorerSearch();
    setExplorerSearchMode('content');
    const addReaderSpy = vi.spyOn(appState, 'addFileReaderSession').mockReturnValue(undefined);
    searchTextMock.mockResolvedValue({
      matches: [
        { path: 'src/a.ts', line: 12, text: 'needle here' },
        { path: 'src/a.ts', line: 30, text: 'another needle' },
        { path: 'src/b.ts', line: 3, text: 'needle again' },
      ],
      truncated: false,
      engine: 'git',
      tookMs: 1,
    });

    const input = getById('explorer-search-input');
    input.value = 'needle';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(300);

    const results = getById('explorer-search-results');
    expect(results.classList.contains('hidden')).toBe(false);
    expect(getById('explorer-content').classList.contains('hidden')).toBe(true);

    const headers = results.querySelectorAll('.explorer-search-file-header');
    expect(headers).toHaveLength(2);
    expect(headers[0].querySelector('.explorer-search-filename')!.textContent).toBe('a.ts');
    expect(headers[0].querySelector('.explorer-search-dir')!.textContent).toBe('src');
    expect(headers[0].querySelector('.explorer-search-count')!.textContent).toBe('(2)');
    expect(headers[1].querySelector('.explorer-search-count')!.textContent).toBe('(1)');

    const lines = results.querySelectorAll('.explorer-search-line');
    expect(lines).toHaveLength(3);
    expect(lines[0].querySelector('.explorer-search-line-no')!.textContent).toBe('12');
    expect(lines[0].querySelector('.explorer-search-line-text')!.textContent).toBe('needle here');

    lines[0].dispatch('click');
    expect(addReaderSpy).toHaveBeenCalledWith(proj.id, 'src/a.ts', 12);
  });

  it('re-translates the tab labels when the locale changes', async () => {
    const { appState, initExplorerSearch } = await load();
    const { setLocale } = await import('../i18n.js');
    project(appState);
    initExplorerSearch();
    expect(getById('explorer-tab-content').textContent).toBe('Content');

    setLocale('zh-CN');
    appState.setPreference('locale', 'zh-CN');

    expect(getById('explorer-tab-path').textContent).toBe('路径');
    expect(getById('explorer-tab-content').textContent).toBe('内容');
  });

  it('persists the chosen mode and moves the roving tabindex with it', async () => {
    const { appState, initExplorerSearch, setExplorerSearchMode } = await load();
    project(appState);
    initExplorerSearch();
    expect(appState.preferences.explorerSearchMode).toBe('path'); // built-in default

    setExplorerSearchMode('content');
    expect(appState.preferences.explorerSearchMode).toBe('content');
    expect(getById('explorer-tab-content').getAttribute('tabindex')).toBe('0');
    expect(getById('explorer-tab-path').getAttribute('tabindex')).toBe('-1');

    setExplorerSearchMode('path');
    expect(appState.preferences.explorerSearchMode).toBe('path');
    expect(getById('explorer-tab-path').getAttribute('aria-selected')).toBe('true');
    expect(getById('explorer-tab-content').getAttribute('aria-selected')).toBe('false');
    expect(getById('explorer-tab-path').getAttribute('tabindex')).toBe('0');
    expect(getById('explorer-tab-content').getAttribute('tabindex')).toBe('-1');
  });

  it('drops stale results when the mode changes mid-flight', async () => {
    const resolvers: Array<(r: SearchTextResult) => void> = [];
    searchTextMock.mockImplementation(() => new Promise<SearchTextResult>((resolve) => resolvers.push(resolve)));
    searchFilesMock.mockResolvedValue({ files: ['fresh.ts'], truncated: false });

    const { appState, initExplorerSearch, setExplorerSearchMode } = await load();
    project(appState);
    initExplorerSearch();
    setExplorerSearchMode('content');

    const input = getById('explorer-search-input');
    input.value = 'needle';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(300);
    expect(searchTextMock).toHaveBeenCalledTimes(1);
    // While the request is in flight the results pane shows the searching state.
    expect(getById('explorer-search-results').children[0].textContent).toBe('Searching…');

    setExplorerSearchMode('path'); // invalidates the in-flight content search + re-runs as path
    await vi.advanceTimersByTimeAsync(10);
    const results = getById('explorer-search-results');
    expect(results.children[0].children[0].textContent).toBe('fresh.ts');

    resolvers[0]({
      matches: [{ path: 'stale.ts', line: 1, text: 'stale needle' }],
      truncated: false,
      engine: 'git',
      tookMs: 1,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(results.children[0].children[0].textContent).toBe('fresh.ts');
    expect(results.querySelectorAll('.explorer-search-line')).toHaveLength(0);
  });

  it('focusExplorerContentSearch opens the panel, switches to content mode and focuses the input', async () => {
    const { appState, initExplorerSearch, focusExplorerContentSearch } = await load();
    project(appState);
    initExplorerSearch();
    expect(appState.explorerPanelOpen).toBe(false);

    focusExplorerContentSearch();

    expect(appState.explorerPanelOpen).toBe(true);
    expect(getById('explorer-tab-content').getAttribute('aria-selected')).toBe('true');
    const input = getById('explorer-search-input');
    expect(input.focused).toBe(true);
    expect(input.placeholder).toBe('Search file contents');
  });

  it('focusExplorerContentSearch does not throw before init (no DOM elements yet)', async () => {
    const { appState, focusExplorerContentSearch } = await load();
    project(appState);
    expect(() => focusExplorerContentSearch()).not.toThrow();
    expect(appState.explorerPanelOpen).toBe(true);
  });

  it('registers the explorer-search-text shortcut on CmdOrCtrl+Shift+E', async () => {
    await load();
    const { SHORTCUT_DEFAULTS } = await import('../shortcuts.js');
    const entry = SHORTCUT_DEFAULTS.find((d) => d.id === 'explorer-search-text');
    expect(entry).toMatchObject({
      label: 'Search in Project',
      category: 'Search & Help',
      defaultKeys: 'CmdOrCtrl+Shift+E',
    });
    // The combination must be free: session-search owns CmdOrCtrl+Shift+F, not E.
    expect(SHORTCUT_DEFAULTS.filter((d) => d.defaultKeys === 'CmdOrCtrl+Shift+E')).toHaveLength(1);
    // Table ordering convention: directly after quick-open inside Search & Help.
    expect(SHORTCUT_DEFAULTS[SHORTCUT_DEFAULTS.indexOf(entry!) - 1].id).toBe('quick-open');
  });
  it('right-clicking a path result opens the file menu on the absolute path', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['src/a.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'a';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);

    const row = getById('explorer-search-results').children[0];
    rightClick(row, 40, 60);

    expect(showContextMenuMock).toHaveBeenCalledTimes(1);
    const [x, y, entries] = showContextMenuMock.mock.calls[0];
    expect([x, y]).toEqual([40, 60]);
    // Same VS Code grouping the file tree uses, minus the folder-only creation rows.
    expect(menuLabels(entries)).toEqual([
      'Open',
      'Reveal in File Explorer',
      'Copy Path',
      'Copy Relative Path',
      'Rename…',
      'Delete',
      'Properties',
    ]);

    // Search results are project-relative; the menu must act on the resolved path.
    actionFor(entries, 'Reveal in File Explorer')();
    expect(revealItemMock).toHaveBeenCalledWith('/proj/src/a.ts');
    actionFor(entries, 'Copy Relative Path')();
    expect(clipboardWriteMock).toHaveBeenLastCalledWith('src/a.ts');
  });

  it('right-clicking a content match or its file header targets the file, not the line', async () => {
    const { appState, initExplorerSearch, setExplorerSearchMode } = await load();
    project(appState);
    initExplorerSearch();
    setExplorerSearchMode('content');
    searchTextMock.mockResolvedValue({
      matches: [{ path: 'src/a.ts', line: 12, text: 'needle here' }],
      truncated: false,
      engine: 'git',
      tookMs: 1,
    });

    const input = getById('explorer-search-input');
    input.value = 'needle';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(300);

    const results = getById('explorer-search-results');
    const header = results.querySelectorAll('.explorer-search-file-header')[0];
    const line = results.querySelectorAll('.explorer-search-line')[0];

    for (const el of [header, line]) {
      showContextMenuMock.mockClear();
      rightClick(el);
      expect(showContextMenuMock).toHaveBeenCalledTimes(1);
      const entries = showContextMenuMock.mock.calls[0][2];
      actionFor(entries, 'Reveal in File Explorer')();
      expect(revealItemMock).toHaveBeenLastCalledWith('/proj/src/a.ts');
    }
  });

  it('re-runs the query after a result is deleted so no dead row is left behind', async () => {
    const { appState, initExplorerSearch } = await load();
    project(appState);
    initExplorerSearch();
    searchFilesMock.mockResolvedValue({ files: ['src/a.ts', 'src/b.ts'], truncated: false });

    const input = getById('explorer-search-input');
    input.value = 'a';
    input.dispatch('input');
    await vi.advanceTimersByTimeAsync(150);
    expect(searchFilesMock).toHaveBeenCalledTimes(1);

    rightClick(getById('explorer-search-results').children[0]);
    const entries = showContextMenuMock.mock.calls[0][2];
    actionFor(entries, 'Delete')();
    const onConfirm = showConfirmModalMock.mock.calls[0][2] as () => Promise<void>;
    await onConfirm();

    expect(trashItemMock).toHaveBeenCalledWith('/proj/src/a.ts');
    expect(searchFilesMock).toHaveBeenCalledTimes(2);
  });
});
