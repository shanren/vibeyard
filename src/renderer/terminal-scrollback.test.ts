import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted, so the fixture object has to be created inside the factory.
const prefs = vi.hoisted(() => ({}) as { terminalScrollback?: number });

vi.mock('./state.js', () => ({
  appState: { preferences: prefs },
}));

import {
  getTerminalScrollback,
  TERMINAL_SCROLLBACK_DEFAULT,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN,
  TERMINAL_SCROLLBACK_OPTIONS,
} from './terminal-scrollback';

describe('terminal scrollback', () => {
  it("defaults far above xterm's 1000 rows", () => {
    prefs.terminalScrollback = undefined;
    expect(getTerminalScrollback()).toBe(TERMINAL_SCROLLBACK_DEFAULT);
    expect(TERMINAL_SCROLLBACK_DEFAULT).toBeGreaterThan(1000);
  });

  it('uses the preference when set', () => {
    prefs.terminalScrollback = 25_000;
    expect(getTerminalScrollback()).toBe(25_000);
  });

  it('clamps to the supported range', () => {
    prefs.terminalScrollback = 1;
    expect(getTerminalScrollback()).toBe(TERMINAL_SCROLLBACK_MIN);
    prefs.terminalScrollback = 10_000_000;
    expect(getTerminalScrollback()).toBe(TERMINAL_SCROLLBACK_MAX);
  });

  it('rounds a fractional value', () => {
    prefs.terminalScrollback = 5_000.6;
    expect(getTerminalScrollback()).toBe(5_001);
  });

  it('ignores junk values', () => {
    prefs.terminalScrollback = Number.NaN as number;
    expect(getTerminalScrollback()).toBe(TERMINAL_SCROLLBACK_DEFAULT);
    prefs.terminalScrollback = Infinity;
    expect(getTerminalScrollback()).toBe(TERMINAL_SCROLLBACK_DEFAULT);
    prefs.terminalScrollback = '10000' as unknown as number;
    expect(getTerminalScrollback()).toBe(TERMINAL_SCROLLBACK_DEFAULT);
  });

  it('offers the default in the Preferences options', () => {
    expect(TERMINAL_SCROLLBACK_OPTIONS).toContain(TERMINAL_SCROLLBACK_DEFAULT);
  });
});
