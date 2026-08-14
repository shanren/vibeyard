import { EditorView } from '@codemirror/view';
import type { SearchBackend, SearchResultState } from './search-bar.js';
import { dispatchSearchDeco, type CodeMirrorMatch } from './code-editor.js';
import { escapeRegExp } from './dom-search-backend.js';

export interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export function collectMatches(doc: string, query: string, options: SearchOptions): CodeMirrorMatch[] {
  if (!query) return [];
  const flags = options.caseSensitive ? 'g' : 'gi';
  let pattern: RegExp;
  try {
    pattern = options.regex ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags);
  } catch {
    return [];
  }
  const matches: CodeMirrorMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(doc)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    if (match[0].length === 0) {
      pattern.lastIndex++;
    }
  }
  return matches;
}

export function stepIndex(changed: boolean, current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1;
  if (changed) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

export class CodeMirrorSearchBackend implements SearchBackend {
  private matches: CodeMirrorMatch[] = [];
  private currentIndex = -1;
  private lastQuery = '';
  private lastOptions: SearchOptions = { caseSensitive: false, regex: false };
  private listeners = new Set<(state: SearchResultState) => void>();

  constructor(
    private view: EditorView,
    private container: HTMLElement,
  ) {}

  findNext(query: string, options: SearchOptions): void {
    const changed = this.recompute(query, options);
    if (this.matches.length === 0) {
      this.applyDeco();
      this.emitResultState();
      return;
    }
    this.currentIndex = stepIndex(changed, this.currentIndex, this.matches.length, 1);
    this.apply();
  }

  findPrevious(query: string, options: SearchOptions): void {
    const changed = this.recompute(query, options);
    if (this.matches.length === 0) {
      this.applyDeco();
      this.emitResultState();
      return;
    }
    this.currentIndex = stepIndex(changed, this.currentIndex, this.matches.length, -1);
    this.apply();
  }

  clearDecorations(): void {
    this.matches = [];
    this.currentIndex = -1;
    this.lastQuery = '';
    this.applyDeco();
    this.emitResultState();
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  focus(): void {
    this.view.focus();
  }

  getResultState(): SearchResultState {
    return {
      currentIndex: this.currentIndex,
      totalCount: this.matches.length,
    };
  }

  subscribe(listener: (state: SearchResultState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getResultState());
    return () => this.listeners.delete(listener);
  }

  private recompute(query: string, options: SearchOptions): boolean {
    const unchanged =
      query === this.lastQuery &&
      options.caseSensitive === this.lastOptions.caseSensitive &&
      options.regex === this.lastOptions.regex;
    if (unchanged) return false;
    this.lastQuery = query;
    this.lastOptions = { ...options };
    this.matches = collectMatches(this.view.state.doc.toString(), query, options);
    this.currentIndex = -1;
    return true;
  }

  private apply(): void {
    const match = this.matches[this.currentIndex];
    this.view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'nearest' }),
    });
    this.applyDeco();
    this.view.focus();
    this.emitResultState();
  }

  private applyDeco(): void {
    dispatchSearchDeco(this.view, { matches: this.matches, current: this.currentIndex });
  }

  private emitResultState(): void {
    const state = this.getResultState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
