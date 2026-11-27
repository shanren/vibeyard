import type { ILinkProvider, ILink, IBufferRange, IBufferLine, Terminal } from '@xterm/xterm';
import { appState } from '../state.js';
import { isAbsolutePath, isPathUnder, normalizeShellPath } from '../../shared/platform.js';

// Matches GitHub issue/PR references like #123
const GITHUB_REF_RE = /#(\d+)/g;

export class GithubLinkProvider implements ILinkProvider {
  constructor(
    private repoUrl: string,
    private terminal: Terminal
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) { callback(undefined); return; }

    const lineText = line.translateToString(true);
    const links: ILink[] = [];

    GITHUB_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GITHUB_REF_RE.exec(lineText)) !== null) {
      const range: IBufferRange = {
        start: { x: match.index + 1, y: bufferLineNumber },
        end: { x: match.index + match[0].length, y: bufferLineNumber },
      };
      const issueNumber = match[1];
      links.push({
        range,
        text: match[0],
        activate: () => {
          window.rcode.app.openExternal(`${this.repoUrl}/issues/${issueNumber}`);
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }
}

/**
 * A path-shaped run of text on one output line.
 *
 * `start`/`end` are **character** offsets into the line text (0-based, end
 * exclusive); the provider converts them to buffer columns, which differ
 * whenever a wide character (CJK, emoji) precedes the path.
 */
export interface FileLinkCandidate {
  /** Exactly what the line shows, including any `:line:col` suffix. */
  text: string;
  /** The path portion alone, as printed (relative, possibly `\`-separated). */
  rawPath: string;
  line?: number;
  column?: number;
  start: number;
  end: number;
}

// Three shapes are worth linking, all of which need more than a bare word:
//   1. a drive-absolute path      C:\a\b.ts, C:/a/b.ts
//   2. a rooted POSIX path        /home/me/a.ts
//   3. a relative path            src/a.ts, ./a.ts, ..\a\b.ts
// plus the same three with a `:line` / `:line:col` suffix, and one more shape:
//   4. an unqualified name WITH a line number   a.ts:12, Makefile:3
// A bare `Node.js` / `v1.2.3` is prose, not a file, so it stays plain text.
const LINE_SUFFIX = String.raw`(?::\d+){0,2}`;
// Drive-absolute or rooted path — anything after the root that is not a
// separator-ish character (the `:` exclusion is what leaves `:line` to the
// suffix below).
const ROOTED_PATH = String.raw`(?:[A-Za-z]:[\\/]|\/)[^\s:*?"<>|]+`;
// Relative path: at least one separator, optional `./` or `../` prefix.
const RELATIVE_PATH = String.raw`(?:\.{1,2}[\\/])?(?:[\w@+$~.-]+[\\/])+[\w@+$~.-]+(?:\.[A-Za-z][\w]{0,9})?`;
// Unqualified name — only linkable when a line number follows it.
const NAMED_WITH_LINE = String.raw`[\w@+$~-]+(?:\.[A-Za-z][\w]{0,9})?(?::\d+){1,2}`;
const FILE_LINK_RE = new RegExp(
  `(?:${ROOTED_PATH}|${RELATIVE_PATH})${LINE_SUFFIX}|${NAMED_WITH_LINE}`,
  'g',
);

// Anything inside a URL belongs to the web-link addon, not here.
const URL_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+/g;

const MAX_PATH_LENGTH = 400;

/** Character spans covered by URLs on a line. */
function urlSpans(lineText: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(lineText)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/** Split a trailing `:line` / `:line:col` off a matched path. */
function splitLineSuffix(raw: string): { rawPath: string; line?: number; column?: number } {
  const m = /^(.+?)(?::(\d+))?(?::(\d+))?$/.exec(raw);
  if (!m) return { rawPath: raw };
  return {
    rawPath: m[1],
    line: m[2] ? parseInt(m[2], 10) : undefined,
    column: m[3] ? parseInt(m[3], 10) : undefined,
  };
}

/** Trailing sentence punctuation that is not part of the path but hugs it. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"`>]+$/;

/**
 * Every file-path candidate on one line of terminal output. Pure and
 * synchronous: existence is checked by the caller (one `stat` per candidate).
 */
export function findFileLinkCandidates(lineText: string): FileLinkCandidate[] {
  const out: FileLinkCandidate[] = [];
  const urls = urlSpans(lineText);
  FILE_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_LINK_RE.exec(lineText)) !== null) {
    if (urls.some(([from, to]) => match!.index >= from && match!.index < to)) continue;

    // Trim punctuation the regex had to swallow (it ends on a \w or ./- group,
    // but a trailing dot/comma can belong to the sentence).
    let text = match[0];
    const trailing = TRAILING_PUNCTUATION.exec(text);
    if (trailing) text = text.slice(0, -trailing[0].length);
    if (!text || text.length > MAX_PATH_LENGTH) continue;

    const { rawPath, line, column } = splitLineSuffix(text);
    if (!rawPath) continue;

    out.push({
      text,
      rawPath,
      line,
      column,
      start: match.index,
      end: match.index + text.length,
    });
  }
  return out;
}

/**
 * Collapse `.` / `..` / duplicate separators in a `/`-separated path, keeping
 * the root (or drive) intact. `..` can never climb above a root.
 */
function collapseUnified(unified: string): string {
  const drive = /^([A-Za-z]):/.exec(unified);
  const absolute = !drive && unified.startsWith('/');
  const rest = drive ? unified.slice(drive[0].length) : unified;
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute && !drive) parts.push('..');
      continue;
    }
    parts.push(part);
  }
  const body = parts.join('/');
  if (drive) return `${drive[1].toUpperCase()}:/${body}`;
  return absolute ? `/${body}` : body;
}

/**
 * The absolute file a printed path points at, resolved against the directory
 * the terminal is working in (`termDir`). Always `/`-separated: every consumer
 * here (stat, file reader, OS open) accepts that on all three platforms, and it
 * keeps `isPathUnder` comparisons from tripping over mixed separators.
 */
export function resolveLinkTarget(rawPath: string, termDir: string): string {
  const unified = normalizeShellPath(rawPath);
  if (isAbsolutePath(unified)) return collapseUnified(unified);
  const base = normalizeShellPath(termDir);
  if (!base) return collapseUnified(unified);
  return collapseUnified(`${base}/${unified}`);
}

interface FsProbe {
  exists: boolean;
  isDirectory: boolean;
}

// Hovering a line asks for its links repeatedly; a short-lived cache keeps that
// from becoming an IPC + fs.stat round-trip per mouse move.
const STAT_TTL_MS = 5000;
const STAT_CACHE_MAX = 500;
const statCache = new Map<string, { at: number; value: FsProbe }>();

/**
 * Does `target` name a real file? `fs:stat` is the only main-process stat that
 * reports existence (it is scoped to known projects + the CLI config dirs, which
 * is exactly the set the reader can open); `fs:isDirectory` is the ungated call
 * that tells a directory apart from a file.
 */
async function probeCached(target: string): Promise<FsProbe> {
  const now = Date.now();
  const hit = statCache.get(target);
  if (hit && now - hit.at < STAT_TTL_MS) return hit.value;

  let value: FsProbe = { exists: false, isDirectory: false };
  try {
    const stat = await window.rcode.fs.stat(target);
    if (stat?.ok) {
      value = { exists: true, isDirectory: await window.rcode.fs.isDirectory(target) };
    }
  } catch {
    value = { exists: false, isDirectory: false };
  }

  if (statCache.size >= STAT_CACHE_MAX) statCache.clear();
  statCache.set(target, { at: now, value });
  return value;
}

/** Testing seam: the stat cache outlives a single test case. */
export function _resetLinkStatCache(): void {
  statCache.clear();
}

function platformIsCaseInsensitive(): boolean {
  return typeof process !== 'undefined' && (process.platform === 'win32' || process.platform === 'darwin');
}

/** Is `target` inside the project rooted at `root`? */
function isInsideProject(target: string, root: string): boolean {
  const t = normalizeShellPath(target);
  const r = normalizeShellPath(root);
  return platformIsCaseInsensitive()
    ? isPathUnder(t.toLowerCase(), r.toLowerCase())
    : isPathUnder(t, r);
}

/**
 * Open what a path link points at. Files inside the project open in the app's
 * own reader (at the printed line); anything else is handed to the OS, since
 * the main process refuses to read outside a known project.
 */
function openFileLink(projectId: string, target: string, line?: number): void {
  const project = appState.projects.find((p) => p.id === projectId);
  if (project && isInsideProject(target, project.path)) {
    appState.addFileReaderSession(projectId, target, line);
    return;
  }
  void window.rcode.fs.openInFolder(target);
}

/**
 * Map a line's visible text to buffer columns. `translateToString()` gives the
 * characters; a CJK cell is one character but two columns, so the two indices
 * stop lining up the moment the output contains Chinese — which, for agent
 * chatter, is nearly always.
 */
export function lineTextToColumns(line: IBufferLine): {
  text: string;
  startColumns: number[];
  endColumns: number[];
} {
  let text = '';
  const startColumns: number[] = [];
  const endColumns: number[] = [];
  for (let col = 0; col < line.length; col++) {
    const cell = line.getCell(col);
    if (!cell) continue;
    const width = cell.getWidth();
    if (width === 0) continue; // the trailing half of a wide character
    const chars = cell.getChars() || ' ';
    for (let i = 0; i < chars.length; i++) {
      startColumns.push(col);
      endColumns.push(col + Math.max(width, 1) - 1);
    }
    text += chars;
  }
  return { text, startColumns, endColumns };
}

/**
 * Makes file paths in terminal output openable. Ctrl/Cmd+click on a path (or
 * `path:line:col`) opens it in the file reader at that line; paths outside the
 * project go to the OS. Only paths that actually exist are turned into links,
 * so prose like `Node.js` never becomes clickable.
 */
export class FilePathLinkProvider implements ILinkProvider {
  constructor(
    private projectId: string,
    private termDir: string,
    private terminal: Terminal
  ) {}

  /**
   * Should this click open the link?
   *
   * A plain click is what people reach for on a path in agent output, so it
   * navigates by default — but two other jobs own the same gesture and must win:
   * a drag that just selected text (the mouseup lands on the link it started
   * on), and a full-screen TUI that asked for mouse events, where the same click
   * also moves that app's cursor. Ctrl (Cmd on macOS) always forces it, and is
   * the only case the old `metaKey`-only check ever honoured.
   */
  private claimsClick(event: MouseEvent): boolean {
    if (event.metaKey || event.ctrlKey) return true;
    if (this.terminal.hasSelection()) return false;
    const mode = this.terminal.modes?.mouseTrackingMode;
    return !mode || mode === 'none';
  }

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    const { text, startColumns, endColumns } = lineTextToColumns(line);
    const candidates = findFileLinkCandidates(text);
    if (candidates.length === 0) {
      callback(undefined);
      return;
    }

    void Promise.all(
      candidates.map(async (candidate) => {
        const target = resolveLinkTarget(candidate.rawPath, this.termDir);
        const probe = await probeCached(target);
        if (!probe.exists || probe.isDirectory) return null;
        return { candidate, target };
      }),
    )
      .then((rows) => {
        const links: ILink[] = [];
        for (const row of rows) {
          if (!row) continue;
          const { candidate, target } = row;
          const range: IBufferRange = {
            start: { x: startColumns[candidate.start] + 1, y: bufferLineNumber },
            end: { x: endColumns[candidate.end - 1] + 1, y: bufferLineNumber },
          };
          links.push({
            range,
            text: candidate.text,
            activate: (event: MouseEvent) => {
              if (!this.claimsClick(event)) return;
              openFileLink(this.projectId, target, candidate.line);
            },
          });
        }
        callback(links.length > 0 ? links : undefined);
      })
      .catch(() => callback(undefined));
  }
}
