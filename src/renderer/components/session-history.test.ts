import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal DOM double: enough for the Sessions panel (class-based queries, text,
 * input values and click handlers). Kept hand-rolled like the other renderer
 * component tests, since the suite runs in the node environment.
 */
class FakeNode {
  tagName: string;
  className = '';
  private ownText = '';
  title = '';
  value = '';
  type = '';
  placeholder = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  handlers: Record<string, ((evt?: unknown) => void)[]> = {};

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  get classList() {
    const self = this;
    return {
      add: (c: string) => {
        if (!self.hasClass(c)) self.className = `${self.className} ${c}`.trim();
      },
      remove: (c: string) => {
        self.className = self.className
          .split(/\s+/)
          .filter((x) => x && x !== c)
          .join(' ');
      },
      contains: (c: string) => self.hasClass(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !self.hasClass(c);
        if (on) self.className = `${self.className} ${c}`.trim();
        else self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
        return on;
      },
    };
  }

  set textContent(value: string) {
    this.ownText = value;
    if (value) this.children = [];
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('');
  }

  hasClass(c: string): boolean {
    return this.className.split(/\s+/).includes(c);
  }

  set innerHTML(_html: string) {
    this.children = [];
  }

  appendChild(child: FakeNode): FakeNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addEventListener(evt: string, fn: (evt?: unknown) => void): void {
    (this.handlers[evt] ??= []).push(fn);
  }

  setSelectionRange(): void {}
  focus(): void {
    (globalThis as { document?: { activeElement?: unknown } }).document!.activeElement = this;
  }

  click(): void {
    for (const fn of this.handlers.click ?? []) fn({ stopPropagation() {} });
  }

  dispatch(evt: string): void {
    for (const fn of this.handlers[evt] ?? []) fn({ stopPropagation() {} });
  }

  /** Depth-first search by `.class` selector. */
  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeNode[] {
    const wanted = selector.replace(/^\./, '');
    const out: FakeNode[] = [];
    const walk = (node: FakeNode) => {
      for (const child of node.children) {
        if (child.hasClass(wanted)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

const fetchMock = vi.hoisted(() => vi.fn());
const openCliSession = vi.hoisted(() => vi.fn());

vi.mock('../icons.js', () => ({ providerMark: (id: string) => `<i>${id}</i>` }));

vi.mock('../state.js', () => ({
  appState: {
    projects: [],
    preferences: {},
    on: vi.fn(),
    setActiveProject: vi.fn(),
    openCliSession,
  },
}));

function stubMedia() {
  const doc = {
    createElement: (tag: string) => new FakeNode(tag),
    activeElement: null as unknown,
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { rcode: { session: { projectTranscripts: fetchMock } } });
  return doc;
}

const transcripts = [
  { providerId: 'claude', cliSessionId: 'cli-1', transcriptPath: '/t/1', name: 'Fix the filter', mtimeMs: 2_000 },
  { providerId: 'pi', cliSessionId: 'cli-2', transcriptPath: '/t/2', name: 'Refactor import', mtimeMs: 1_000 },
];

const project = { id: 'p1', name: 'Proj', path: '/proj', sessions: [] } as never;

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function load() {
  vi.resetModules();
  return import('./session-history');
}

beforeEach(() => {
  vi.clearAllMocks();
  stubMedia();
  fetchMock.mockResolvedValue(transcripts);
});

describe('Sessions panel', () => {
  it('fetches once per render — the painter must never re-trigger a fetch', async () => {
    const { renderSessionHistory } = await load();
    const container = new FakeNode();

    renderSessionHistory(project, container);
    await flush();
    await flush();

    // Regression: paint → fetch → paint → fetch … froze the whole renderer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a merged list with one row per session and a tool glyph each', async () => {
    const { renderSessionHistory } = await load();
    const container = new FakeNode();

    renderSessionHistory(project, container);
    await flush();

    const rows = container.querySelectorAll('.history-item');
    expect(rows).toHaveLength(2);
    expect(container.querySelectorAll('.history-provider-mark')).toHaveLength(2);
    expect(rows[0].querySelector('.history-item-name')!.textContent).toBe('Fix the filter');
  });

  it('shows provider filters only when more than one tool has sessions', async () => {
    const { renderSessionHistory } = await load();
    const merged = new FakeNode();
    renderSessionHistory(project, merged);
    await flush();
    expect(merged.querySelectorAll('.history-filter').map((c) => c.textContent)).toEqual([
      'All',
      'Claude Code',
      'Pi',
    ]);

    // A single-tool project stays clean.
    fetchMock.mockResolvedValue([transcripts[0]]);
    const single = new FakeNode();
    const otherProject = { id: 'p2', name: 'Other', path: '/other', sessions: [] } as never;
    renderSessionHistory(otherProject, single);
    await flush();
    expect(single.querySelectorAll('.history-filter')).toHaveLength(0);
  });

  it('filters by provider without refetching, and re-renders only the list', async () => {
    const { renderSessionHistory } = await load();
    const container = new FakeNode();
    renderSessionHistory(project, container);
    await flush();

    const piChip = container.querySelectorAll('.history-filter').find((c) => c.textContent.includes('Pi'))!;
    piChip.click();
    await flush();

    expect(container.querySelectorAll('.history-item').map((r) => r.querySelector('.history-item-name')!.textContent)).toEqual([
      'Refactor import',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('filters by search text and keeps the input value', async () => {
    const { renderSessionHistory } = await load();
    const container = new FakeNode();
    renderSessionHistory(project, container);
    await flush();

    const input = container.querySelector('.history-search')!;
    input.value = 'refactor';
    input.dispatch('input');
    await flush();

    expect(container.querySelectorAll('.history-item')).toHaveLength(1);
    expect(container.querySelector('.history-search')!.value).toBe('refactor');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens a CLI session by its own id when a row is clicked', async () => {
    const { renderSessionHistory } = await load();
    const container = new FakeNode();
    renderSessionHistory(project, container);
    await flush();

    container.querySelectorAll('.history-item')[0].click();

    expect(openCliSession).toHaveBeenCalledWith('p1', 'cli-1', 'Fix the filter', 'claude', undefined);
  });

  it('shows an empty state when the tools have no sessions here', async () => {
    fetchMock.mockResolvedValue([]);
    const { renderSessionHistory } = await load();
    const container = new FakeNode();

    renderSessionHistory(project, container);
    await flush();

    expect(container.querySelector('.history-empty')!.textContent).toContain('No sessions');
  });
});
