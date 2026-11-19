import type { ITheme } from '@xterm/xterm';

/**
 * Terminal palettes.
 *
 * xterm renders to a canvas, so it cannot read CSS: the colours have to be a JS
 * object handed to `new Terminal({ theme })`. Both themes therefore duplicate
 * values that also exist as `--vscode-*` tokens in styles/base.css — keep them in
 * step by hand.
 *
 * Values are VS Code's Dark Modern / Light Modern terminal defaults
 * (`terminal.background`, `terminal.foreground`, `terminal.ansi*`,
 * `terminal.selectionBackground`, `editorCursor.foreground`), so the terminal is
 * the same colour family as the chrome around it instead of the old Studio
 * palette (purple cursor, coral ANSI red).
 */

export const darkTerminalTheme: ITheme = {
  background: '#1f1f1f',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1f1f1f',
  selectionBackground: '#264f78',

  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',

  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

export const lightTerminalTheme: ITheme = {
  background: '#ffffff',
  foreground: '#3b3b3b',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',

  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  // VS Code ships #555555 here because #ffffff would vanish on white.
  white: '#555555',

  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

export function getTerminalTheme(theme: 'dark' | 'light'): ITheme {
  return theme === 'light' ? lightTerminalTheme : darkTerminalTheme;
}
