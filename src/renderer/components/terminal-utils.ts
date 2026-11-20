import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { shortcutManager } from '../shortcuts.js';
import { isWin } from '../platform.js';
import { appState } from '../state.js';

type ExtraKeyHandler = (e: KeyboardEvent) => boolean | undefined;

// Wraps text in bracketed-paste escapes when the shell has the mode enabled,
// so it's delivered as a paste rather than character-by-character input.
export function wrapBracketedPaste(terminal: Terminal, text: string): string {
  const modes = (terminal as unknown as { modes?: { bracketedPasteMode?: boolean } }).modes;
  return modes?.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text;
}

// Call after terminal.open(); the selection service doesn't fire before then.
export function attachCopyOnSelect(terminal: Terminal): void {
  terminal.onSelectionChange(() => {
    if (!appState.preferences.copyOnSelect) return;
    const selection = terminal.getSelection();
    if (selection) window.rcode.clipboard.write(selection).catch(() => {});
  });
}

/**
 * Attaches shared key event handling to a terminal:
 * - Cmd/Ctrl+F: bubbles up to document (prevents xterm from consuming it)
 * - Ctrl+Shift+C: copies selected text to clipboard
 * - Windows Ctrl+C: copies if selection exists, otherwise passes through as SIGINT
 * - Windows Ctrl+V: pastes clipboard content to PTY (requires writeToPty)
 *
 * Pass an optional `extend` handler for terminal-specific key behavior.
 * Return false to suppress the key, undefined to fall through to default.
 *
 * Pass `writeToPty` to enable Ctrl+V paste on Windows — it receives the
 * clipboard text and should forward it to the PTY.
 */
export function attachClipboardCopyHandler(
  terminal: Terminal,
  extend?: ExtraKeyHandler,
  writeToPty?: (data: string) => void
): void {
  terminal.attachCustomKeyEventHandler((e) => {
    // Cmd/Ctrl+F: bubble to document for search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') return false;

    // Ctrl+Shift+C: copy selected text (all platforms)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
      if (e.type === 'keydown') {
        const selection = terminal.getSelection();
        if (selection) navigator.clipboard.writeText(selection).catch(() => {});
      }
      return false;
    }

    // Windows: Ctrl+C with selection → copy; without selection → SIGINT
    if (isWin && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key === 'c') {
      const selection = terminal.getSelection();
      if (selection) {
        if (e.type === 'keydown') navigator.clipboard.writeText(selection).catch(() => {});
        return false;
      }
      return true; // no selection — let xterm send \x03
    }

    // Windows: Ctrl+V → async paste clipboard to PTY
    if (isWin && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key === 'v' && writeToPty) {
      if (e.type === 'keydown') {
        navigator.clipboard.readText().then((text) => {
          if (!text) return;
          writeToPty(wrapBracketedPaste(terminal, text));
        }).catch(() => {});
      }
      e.preventDefault(); // prevent native paste event from firing
      return false; // suppress \x16
    }

    // Let registered app shortcuts bubble to document listener
    if (shortcutManager.matchesAnyShortcut(e)) return false;

    return extend?.(e) ?? true;
  });
}

// Disposing the addon on context loss lets xterm.js fall back to the DOM renderer
// instead of keeping a dead GPU texture atlas (black-box glyphs).
export function loadWebglWithFallback(terminal: Terminal): void {
  try {
    const addon = new WebglAddon();
    terminal.loadAddon(addon);
    addon.onContextLoss(() => addon.dispose());
  } catch {}
}

/**
 * Wheel scrolling inside a full-screen CLI.
 *
 * Programs like pi, opencode, vim or less switch to the alternate screen, where the
 * terminal keeps no scrollback: a wheel event that is not forwarded to the app does
 * nothing at all, which reads as "the output cannot scroll".
 *
 * The wheel is translated into **PageUp / PageDown** rather than arrow keys —
 * arrows are cursor movement in these UIs (in pi they move the prompt, so the screen
 * looks frozen), while PageUp/PageDown is what every full-screen pager binds to
 * scrolling. Deltas accumulate first, so a slow two-finger touchpad scroll (a few
 * pixels per event) advances pages at the same rate as a mouse notch.
 */
const ROW_PX = 40;
/** Accumulated scroll (device px) that advances one page. */
const PAGE_PX = ROW_PX * 3;
const MAX_PAGES_PER_EVENT = 3;
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

/** Per-terminal scroll accumulator (touchpads emit many tiny deltas). */
const wheelAccumulator = new WeakMap<Terminal, number>();

export function attachAlternateScroll(terminal: Terminal, write: (data: string) => void): void {
  terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
    if (terminal.buffer.active.type !== 'alternate') return true;
    // The app asked for mouse events, so xterm already forwards the wheel as one
    // (button 64/65) and these TUIs scroll themselves — don't double-handle it.
    if (terminal.modes.mouseTrackingMode !== 'none') return true;

    const total = (wheelAccumulator.get(terminal) ?? 0) + event.deltaY;
    const pages = Math.min(Math.trunc(Math.abs(total) / PAGE_PX), MAX_PAGES_PER_EVENT);

    if (pages === 0) {
      wheelAccumulator.set(terminal, total);
      event.preventDefault();
      return false;
    }

    write((total < 0 ? PAGE_UP : PAGE_DOWN).repeat(pages));
    // Keep the remainder so the next small delta continues from here.
    wheelAccumulator.set(terminal, total - Math.sign(total) * pages * PAGE_PX);
    event.preventDefault();
    return false;
  });
}

/**
 * Creating the WebGL context can block the main thread for *seconds* on machines
 * where the GPU driver falls back to software rasterisation (measured 5.9s). It
 * used to run inside the startup chain before the first paint, so the whole UI
 * waited on it. Paint with the DOM renderer immediately and upgrade afterwards.
 */
const WEBGL_PROBE_BUDGET_MS = 500;
/** Delay before the one-time probe, so it never lands on the startup path. */
const WEBGL_PROBE_DELAY_MS = 4000;
/** Verdict for this launch; `undefined` while the probe is still pending. */
let webglVerdict: boolean | undefined;

function readVerdict(): boolean | undefined {
  if (webglVerdict === undefined) webglVerdict = appState.preferences.terminalWebgl;
  return webglVerdict;
}

function apply(terminal: Terminal): void {
  const started = performance.now();
  loadWebglWithFallback(terminal);
  const cost = performance.now() - started;
  const usable = cost <= WEBGL_PROBE_BUDGET_MS;
  // Record the verdict either way: a fast probe must not be re-run on every
  // launch, and a slow one (software rasterisation) must never be paid again.
  webglVerdict = usable;
  if (appState.preferences.terminalWebgl !== usable) {
    appState.setPreference('terminalWebgl', usable);
  }
}

/**
 * Upgrade a pane to the GPU renderer — but only when the machine has been shown
 * to handle it. The first ever terminal on a machine triggers a single delayed
 * probe whose result is persisted, so the expensive path is paid at most once.
 */
export function scheduleWebglUpgrade(terminal: Terminal): void {
  const verdict = readVerdict();
  if (verdict === false) return;
  if (verdict === true) {
    setTimeout(() => apply(terminal), 0);
    return;
  }
  // Undecided: one probe, off the startup path, that lands on this terminal.
  setTimeout(() => {
    if (webglVerdict !== undefined) {
      if (webglVerdict) apply(terminal);
      return;
    }
    apply(terminal);
  }, WEBGL_PROBE_DELAY_MS);
}

/** Test seam: drop the cached verdict so a probe runs again. */
export function _resetWebglUpgradeStateForTesting(): void {
  webglVerdict = undefined;
}
