import type { SearchTextMatch } from '../shared/types';

/** Hard cap on merged matches returned to the renderer. */
export const TEXT_SEARCH_MAX_MATCHES = 500;
/** Max matches collected per file by the walk engine (and `--max-count` for git grep). */
export const TEXT_SEARCH_MAX_PER_FILE = 20;
/** Max files the walk engine is allowed to read per search. */
export const TEXT_SEARCH_MAX_FILES = 200;
/** Wall-clock budget for a whole text search, in milliseconds. */
export const TEXT_SEARCH_TIMEOUT_MS = 5000;
/** Files larger than this are skipped by the walk engine (1 MB). */
export const TEXT_SEARCH_MAX_FILE_BYTES = 1024 * 1024;
/** Matched lines are truncated to this many characters before display. */
export const TEXT_SEARCH_MAX_LINE_CHARS = 400;

/**
 * Parse `git grep -z -n -I -i -F --untracked --no-color -e <query>` stdout.
 *
 * With `-z`, each match is emitted as `<path> NUL <line> NUL <text> LF`, so
 * `stdout.split('\0')` yields `[p1, l1, "t1\np2", l2, "t2\np3", ...]`: the tail
 * of each text block carries the NEXT match's path after a trailing LF. Paths
 * may contain spaces, CJK or leading dashes, which is why the output must never
 * be split on `:`.
 *
 * `prefix` is prepended verbatim to each path (the repo root's prefix relative
 * to the project root: `''` for the root repo, e.g. `'QIS_WF/'` for a nested
 * one — the caller supplies the trailing slash; these are IPC paths with `/`
 * separators on every platform, so no `path.join`).
 */
export function parseGitGrepOutput(stdout: string, prefix: string): SearchTextMatch[] {
  const parts = stdout.split('\0');
  const matches: SearchTextMatch[] = [];
  let path = parts[0] ?? '';
  for (let i = 0; i + 2 < parts.length; i += 2) {
    const line = Number.parseInt(parts[i + 1], 10);
    // Defensive: skip a malformed record rather than emitting NaN.
    if (!Number.isInteger(line)) continue;
    const chunk = parts[i + 2];
    const nl = chunk.lastIndexOf('\n');
    // git on Windows emits CRLF; strip the trailing CR, then cap the length.
    let text = (nl >= 0 ? chunk.slice(0, nl) : chunk).replace(/\r$/, '');
    if (text.length > TEXT_SEARCH_MAX_LINE_CHARS) {
      text = text.slice(0, TEXT_SEARCH_MAX_LINE_CHARS);
    }
    matches.push({ path: prefix + path, line, text });
    path = nl >= 0 ? chunk.slice(nl + 1) : '';
  }
  return matches;
}

/**
 * Merge matches from multiple repo roots: dedupe on (path, line) keeping the
 * first occurrence, sort by path (case-insensitive) then line ascending, and
 * cap at `limit` (default {@link TEXT_SEARCH_MAX_MATCHES}). `truncated` is true
 * when the deduped count exceeded the limit.
 */
export function mergeMatches(
  groups: SearchTextMatch[],
  limit: number = TEXT_SEARCH_MAX_MATCHES,
): { matches: SearchTextMatch[]; truncated: boolean } {
  const seen = new Set<string>();
  const deduped: SearchTextMatch[] = [];
  for (const match of groups) {
    const key = `${match.path}\0${match.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  deduped.sort(
    (a, b) =>
      a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }) || a.line - b.line,
  );
  return { matches: deduped.slice(0, limit), truncated: deduped.length > limit };
}
