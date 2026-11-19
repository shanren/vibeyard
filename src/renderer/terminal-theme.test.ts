import { describe, it, expect } from 'vitest';
import { darkTerminalTheme, lightTerminalTheme, getTerminalTheme } from './terminal-theme';

// The terminal canvas cannot read CSS, so these values mirror VS Code's
// Dark/Light Modern terminal defaults. They are pinned here so a palette edit
// can't drift silently away from the chrome.
describe('darkTerminalTheme', () => {
  it('matches the Dark Modern editor background and foreground', () => {
    expect(darkTerminalTheme.background).toBe('#1f1f1f');
    expect(darkTerminalTheme.foreground).toBe('#cccccc');
  });

  it('uses the neutral cursor and VS Code selection colour, not the old accent', () => {
    expect(darkTerminalTheme.cursor).toBe('#aeafad');
    expect(darkTerminalTheme.selectionBackground).toBe('#264f78');
  });

  it('uses the VS Code ANSI palette', () => {
    expect(darkTerminalTheme.red).toBe('#cd3131');
    expect(darkTerminalTheme.green).toBe('#0dbc79');
    expect(darkTerminalTheme.blue).toBe('#2472c8');
    expect(darkTerminalTheme.brightBlue).toBe('#3b8eea');
  });
});

describe('lightTerminalTheme', () => {
  it('matches the Light Modern editor background and foreground', () => {
    expect(lightTerminalTheme.background).toBe('#ffffff');
    expect(lightTerminalTheme.foreground).toBe('#3b3b3b');
  });

  it('keeps ansi white readable against a white background', () => {
    expect(lightTerminalTheme.white).toBe('#555555');
    expect(lightTerminalTheme.white).not.toBe(lightTerminalTheme.background);
    expect(lightTerminalTheme.brightWhite).toBe('#a5a5a5');
  });
});

describe('getTerminalTheme()', () => {
  it('returns darkTerminalTheme for "dark"', () => {
    expect(getTerminalTheme('dark')).toBe(darkTerminalTheme);
  });

  it('returns lightTerminalTheme for "light"', () => {
    expect(getTerminalTheme('light')).toBe(lightTerminalTheme);
  });
});
