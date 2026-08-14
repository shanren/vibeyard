import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchFilesResult } from '../../shared/types.js';

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
  className = '';
  classList = new FakeClassList();
  textContent = '';
  value = '';
  placeholder = '';
  listeners = new Map<string, Array<(event?: any) => void>>();
  private _innerHTML = '';
  get innerHTML(): string { return this._innerHTML; }
  set innerHTML(v: string) { this._innerHTML = v; if (v === '') this.children = []; }

  constructor(public tagName: string) {}

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

function stubDom(): void {
  const doc = {
    getElementById: getById,
    createElement: (tagName: string) => new FakeElement(tagName),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    vibeyard: {
      store: { load: vi.fn(), save: vi.fn() },
      fs: { searchFiles: searchFilesMock },
    },
  });
  // Mirror index.html: #explorer-search-results starts with the `hidden` class.
  getById('explorer-search-results').classList.add('hidden');
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
});
