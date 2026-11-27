import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { CodeMirrorSearchBackend, collectMatches, stepIndex } from './code-editor-search.js';

describe('collectMatches', () => {
  const doc = 'const foo = 1;\nconst Foo = 2;\nconst foo = 3;';

  it('finds case-insensitive matches by default', () => {
    expect(collectMatches(doc, 'foo', { caseSensitive: false, regex: false })).toEqual([
      { from: 6, to: 9 },
      { from: 21, to: 24 },
      { from: 36, to: 39 },
    ]);
  });

  it('respects case sensitivity', () => {
    expect(collectMatches(doc, 'Foo', { caseSensitive: true, regex: false })).toEqual([
      { from: 21, to: 24 },
    ]);
  });

  it('supports regex queries', () => {
    expect(collectMatches(doc, 'const \\w+', { caseSensitive: false, regex: true })).toHaveLength(3);
  });

  it('treats plain queries as escaped literals', () => {
    const matches = collectMatches('a.b aXb', 'a.b', { caseSensitive: false, regex: false });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ from: 0, to: 3 });
  });

  it('returns empty for empty query or invalid regex', () => {
    expect(collectMatches(doc, '', { caseSensitive: false, regex: false })).toEqual([]);
    expect(collectMatches(doc, '([', { caseSensitive: false, regex: true })).toEqual([]);
  });

  it('advances past zero-width matches', () => {
    expect(collectMatches('aaa', 'a*', { caseSensitive: false, regex: true }).length).toBeGreaterThan(0);
  });
});

describe('stepIndex', () => {
  it('resets to first/last when the query changed', () => {
    expect(stepIndex(true, 3, 5, 1)).toBe(0);
    expect(stepIndex(true, 3, 5, -1)).toBe(4);
  });

  it('wraps around on navigation', () => {
    expect(stepIndex(false, 4, 5, 1)).toBe(0);
    expect(stepIndex(false, 0, 5, -1)).toBe(4);
  });

  it('returns -1 when there are no matches', () => {
    expect(stepIndex(true, -1, 0, 1)).toBe(-1);
  });
});

function makeStubView(doc: string) {
  const dispatch = vi.fn();
  const focus = vi.fn();
  const view = { state: EditorState.create({ doc }), dispatch, focus } as unknown as EditorView;
  return { view, dispatch, focus };
}

function makeContainer(): HTMLElement {
  return {} as HTMLElement;
}

describe('CodeMirrorSearchBackend', () => {
  it('navigates matches with wrap-around and reports state', () => {
    const { view, dispatch } = makeStubView('abc abc abc');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());

    backend.findNext('abc', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 3 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { anchor: 0, head: 3 } }),
    );

    backend.findNext('abc', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 1, totalCount: 3 });

    backend.findNext('abc', { caseSensitive: false, regex: false });
    backend.findNext('abc', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 3 });

    backend.findPrevious('abc', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 2, totalCount: 3 });
  });

  it('resets to first match when the query changes', () => {
    const { view } = makeStubView('one two one');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());

    backend.findNext('one', { caseSensitive: false, regex: false });
    backend.findNext('one', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 1, totalCount: 2 });

    backend.findNext('two', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 1 });
  });

  it('reports no matches without dispatching a selection', () => {
    const { view, dispatch } = makeStubView('abc');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());

    backend.findNext('xyz', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: -1, totalCount: 0 });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ selection: expect.anything() }));
  });

  it('clearDecorations resets state', () => {
    const { view } = makeStubView('abc abc');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());
    backend.findNext('abc', { caseSensitive: false, regex: false });
    backend.clearDecorations();
    expect(backend.getResultState()).toEqual({ currentIndex: -1, totalCount: 0 });
  });

  it('never focuses the editor while searching', () => {
    // Regression: `apply()` used to call view.focus(), so the first character
    // typed into the raw-mode find bar moved the caret into the document and
    // every later character was typed into the file.
    const { view, focus } = makeStubView('abc abc');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());

    backend.findNext('abc', { caseSensitive: false, regex: false });
    backend.findNext('abc', { caseSensitive: false, regex: false });
    backend.findPrevious('abc', { caseSensitive: false, regex: false });
    expect(focus).not.toHaveBeenCalled();

    // Closing the bar is what hands focus back to the editor.
    backend.focus();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers of result state changes', () => {
    const { view } = makeStubView('abc abc');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());
    const listener = vi.fn();
    backend.subscribe(listener);

    backend.findNext('abc', { caseSensitive: false, regex: false });
    expect(listener).toHaveBeenLastCalledWith({ currentIndex: 0, totalCount: 2 });
  });

  it('toggles case sensitivity as a query change', () => {
    const { view } = makeStubView('Foo foo');
    const backend = new CodeMirrorSearchBackend(view, makeContainer());

    backend.findNext('foo', { caseSensitive: true, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 1 });

    backend.findNext('foo', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 2 });
  });
});
