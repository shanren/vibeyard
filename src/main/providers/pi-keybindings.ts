import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Enable line-by-line scrolling in pi's full-screen UI.
 *
 * `pi` ships the actions (`tui.altScreen.lineUp` / `lineDown`) but leaves them
 * **unbound**, so a terminal can only scroll it a page at a time — which feels like
 * flipping pages. Binding them to shift+arrows gives RCode a key to send per wheel
 * row, the way every other terminal scrolls.
 *
 * The user's file is merged, never replaced: existing bindings win, and a file that
 * cannot be parsed is left untouched rather than overwritten.
 */
const LINE_UP_ACTION = 'tui.altScreen.lineUp';
const LINE_DOWN_ACTION = 'tui.altScreen.lineDown';
const LINE_KEYS = ['shift+up'];
const LINE_DOWN_KEYS = ['shift+down'];

function agentDir(): string {
  return path.join(os.homedir(), '.pi', 'agent');
}

export function keybindingsPath(): string {
  return path.join(agentDir(), 'keybindings.json');
}

type Bindings = Record<string, unknown>;

function readBindings(file: string): Bindings | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Bindings;
  } catch (err) {
    // Missing file is normal; a malformed one must not be clobbered.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return null;
  }
}

/**
 * Ensure the line-scroll bindings exist. Returns true when the file was written.
 * Idempotent: a second call with the bindings already present does no I/O write.
 */
export function ensurePiLineScrollBindings(file: string = keybindingsPath()): boolean {
  const existing = readBindings(file);
  if (!existing) return false;

  const needsUp = existing[LINE_UP_ACTION] === undefined;
  const needsDown = existing[LINE_DOWN_ACTION] === undefined;
  if (!needsUp && !needsDown) return false;

  const next: Bindings = { ...existing };
  if (needsUp) next[LINE_UP_ACTION] = LINE_KEYS;
  if (needsDown) next[LINE_DOWN_ACTION] = LINE_DOWN_KEYS;

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    return true;
  } catch {
    // Read-only home or similar: scrolling still works, just a page at a time.
    return false;
  }
}
