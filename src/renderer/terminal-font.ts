/**
 * Terminal typography.
 *
 * xterm does not read CSS, so the font has to be handed to it as options. This
 * module is the single place that decides both values:
 *
 *   family — the same system mono stack as `--app-font-mono` in styles/base.css.
 *            Vibeyard no longer bundles a font, so naming JetBrains Mono first
 *            (as the old code did) silently fell through to the browser's
 *            generic mono face on any machine without it installed.
 *   size   — `preferences.terminalFontSize`, defaulting to TERMINAL_FONT_SIZE_DEFAULT.
 *            Preferences → Appearance exposes it; changing it re-fonts every open
 *            terminal and refits, so the grid stays correct.
 */

import { appState } from './state.js';

/** System mono stack, mirroring `--app-font-mono` in styles/base.css. */
export const TERMINAL_FONT_FAMILY =
  "'SF Mono', Monaco, Menlo, Consolas, 'Ubuntu Mono', 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace";

export const TERMINAL_FONT_SIZE_DEFAULT = 13;

/** Sizes offered in Preferences; anything outside is clamped on read. */
export const TERMINAL_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20] as const;

const MIN_SIZE = TERMINAL_FONT_SIZES[0];
const MAX_SIZE = TERMINAL_FONT_SIZES[TERMINAL_FONT_SIZES.length - 1];

/** Effective terminal font size: the user's choice, clamped, or the default. */
export function getTerminalFontSize(): number {
  const raw = appState.preferences.terminalFontSize;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(raw)));
}
