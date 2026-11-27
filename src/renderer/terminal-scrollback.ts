/**
 * Terminal scrollback depth.
 *
 * xterm retains `scrollback` rows above the viewport and **discards** the rest —
 * it is not a display window over an unlimited log. The option defaults to 1000
 * and neither RCode terminal set it, so in any session longer than ~1000 lines
 * the older output was destroyed by the terminal the moment it scrolled off,
 * which reads as "scrolling up only shows so much": the transcript was never
 * there to scroll to.
 *
 * Agent sessions blow past 1000 lines routinely (a single diff, test run or file
 * dump does it), so the default here is 10× xterm's and 10× VS Code's. The depth is
 * a *cap*, not an allocation — xterm's buffer grows as rows arrive, so a short
 * session costs nothing extra — and a full 10k rows of 120-column lines measured
 * ~13MB of renderer heap (~1.4MB per 1000 rows). `TERMINAL_SCROLLBACK_OPTIONS`
 * tops out at 50k because past that a single pane's worst case gets conspicuous and
 * nobody actually scrolls 50k lines.
 */

import { appState } from './state.js';

/** Rows kept above the viewport when the preference is unset. */
export const TERMINAL_SCROLLBACK_DEFAULT = 10_000;

/** Below this the terminal is unusable; above this a pane costs real memory. */
export const TERMINAL_SCROLLBACK_MIN = 1_000;
export const TERMINAL_SCROLLBACK_MAX = 50_000;

/** Depths offered in Preferences → Appearance. */
export const TERMINAL_SCROLLBACK_OPTIONS = [1_000, 5_000, 10_000, 25_000, 50_000] as const;

/** Effective scrollback depth: the user's choice, clamped, or the default. */
export function getTerminalScrollback(): number {
  const raw = appState.preferences.terminalScrollback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(TERMINAL_SCROLLBACK_MAX, Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(raw)));
}
