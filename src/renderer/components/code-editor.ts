import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { csharp, kotlin, scala, dart, objectiveCpp } from '@codemirror/legacy-modes/mode/clike';

type LanguageFactory = () => Extension;

const EXT_LANGUAGES: Record<string, LanguageFactory> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: () => python(),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  json: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
  mdx: () => markdown(),
  c: () => cpp(),
  h: () => cpp(),
  cc: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  hpp: () => cpp(),
  hh: () => cpp(),
  hxx: () => cpp(),
  java: () => java(),
  rs: () => rust(),
  go: () => go(),
  php: () => php(),
  sql: () => sql(),
  xml: () => xml(),
  xsl: () => xml(),
  xsd: () => xml(),
  yaml: () => yaml(),
  yml: () => yaml(),
  toml: () => StreamLanguage.define(toml),
  sh: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell),
  ini: () => StreamLanguage.define(properties),
  cfg: () => StreamLanguage.define(properties),
  conf: () => StreamLanguage.define(properties),
  properties: () => StreamLanguage.define(properties),
  diff: () => StreamLanguage.define(diff),
  patch: () => StreamLanguage.define(diff),
  cmake: () => StreamLanguage.define(cmake),
  cs: () => StreamLanguage.define(csharp),
  kt: () => StreamLanguage.define(kotlin),
  kts: () => StreamLanguage.define(kotlin),
  scala: () => StreamLanguage.define(scala),
  dart: () => StreamLanguage.define(dart),
  mm: () => StreamLanguage.define(objectiveCpp),
  vue: () => html(),
};

const BASENAME_LANGUAGES: Record<string, LanguageFactory> = {
  dockerfile: () => StreamLanguage.define(dockerFile),
  makefile: () => StreamLanguage.define(shell),
  'cmakelists.txt': () => StreamLanguage.define(cmake),
  '.editorconfig': () => StreamLanguage.define(properties),
  '.env': () => StreamLanguage.define(shell),
  justfile: () => StreamLanguage.define(shell),
};

export function detectLanguage(filePath: string): Extension | null {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  const lower = base.toLowerCase();
  const byName = BASENAME_LANGUAGES[lower];
  if (byName) return byName();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const factory = EXT_LANGUAGES[lower.slice(dot + 1)];
  return factory ? factory() : null;
}

const syntaxHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: tags.regexp, color: 'var(--syntax-regexp)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--syntax-variable)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--syntax-operator)' },
  { tag: tags.tagName, color: 'var(--syntax-tag)' },
  { tag: tags.link, color: 'var(--syntax-link)' },
  { tag: [tags.heading, tags.processingInstruction, tags.meta], color: 'var(--syntax-type)' },
]);

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--text-primary)',
    padding: '4px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--border-subtle)',
    color: 'var(--text-muted)',
  },
  '.cm-line': {
    padding: '0 8px',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-content ::selection': {
    backgroundColor: 'var(--syntax-selection)',
  },
});

export interface FileEditorHandle {
  destroy(): void;
  setContent(content: string): void;
  scrollToLine(line: number): void;
  getView(): EditorView;
}

export function createFileEditor(
  container: HTMLElement,
  content: string,
  filePath: string,
  onChange?: () => void,
): FileEditorHandle {
  const language = detectLanguage(filePath);
  let suppressChange = false;
  const state = EditorState.create({
    doc: content,
    extensions: [
      baseTheme,
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      syntaxHighlighting(syntaxHighlightStyle),
      EditorView.lineWrapping,
      searchDecoField,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressChange) onChange?.();
      }),
      language ? language : [],
    ],
  });

  const view = new EditorView({ state, parent: container });

  return {
    destroy() {
      view.destroy();
    },
    setContent(next: string) {
      const doc = view.state.doc;
      if (doc.toString() === next) return;
      suppressChange = true;
      view.dispatch({ changes: { from: 0, to: doc.length, insert: next } });
      suppressChange = false;
    },
    scrollToLine(line: number) {
      const doc = view.state.doc;
      const clamped = Math.max(1, Math.min(line, doc.lines));
      const target = doc.line(clamped);
      view.dispatch({
        selection: { anchor: target.from, head: target.to },
        effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
      });
    },
    getView() {
      return view;
    },
  };
}

export interface CodeMirrorMatch {
  from: number;
  to: number;
}

export interface SearchDecoValue {
  matches: CodeMirrorMatch[];
  current: number;
}

const setSearchDecoEffect = StateEffect.define<SearchDecoValue>();

const searchDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSearchDecoEffect)) {
        const { matches, current } = effect.value;
        if (matches.length === 0) {
          deco = Decoration.none;
        } else {
          const mark = Decoration.mark({ class: 'cm-search-match' });
          const currentMark = Decoration.mark({ class: 'cm-search-match cm-search-match-current' });
          deco = Decoration.set(
            matches.map((m, i) => (i === current ? currentMark : mark).range(m.from, m.to)),
          );
        }
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function dispatchSearchDeco(view: EditorView, value: SearchDecoValue): void {
  view.dispatch({ effects: setSearchDecoEffect.of(value) });
}
