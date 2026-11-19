import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted, so the fixture object has to be created inside the factory.
const prefs = vi.hoisted(() => ({}) as { terminalFontSize?: number });

vi.mock('./state.js', () => ({
  appState: { preferences: prefs },
}));

import { getTerminalFontSize, TERMINAL_FONT_SIZE_DEFAULT, TERMINAL_FONT_FAMILY } from './terminal-font';

describe('terminal font', () => {
  it('defaults to 13px when unset', () => {
    prefs.terminalFontSize = undefined;
    expect(getTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it('uses the preference when set', () => {
    prefs.terminalFontSize = 16;
    expect(getTerminalFontSize()).toBe(16);
  });

  it('clamps to the offered range', () => {
    prefs.terminalFontSize = 3;
    expect(getTerminalFontSize()).toBe(10);
    prefs.terminalFontSize = 99;
    expect(getTerminalFontSize()).toBe(20);
  });

  it('ignores junk values', () => {
    prefs.terminalFontSize = Number.NaN as number;
    expect(getTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it('names only fonts that ship with an OS (no bundled face)', () => {
    expect(TERMINAL_FONT_FAMILY).not.toContain('JetBrains Mono');
    expect(TERMINAL_FONT_FAMILY).toContain('Consolas');
    expect(TERMINAL_FONT_FAMILY.endsWith('monospace')).toBe(true);
  });
});
