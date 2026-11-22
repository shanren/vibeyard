import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import type { SearchTextMatch, SearchTextResult } from '../shared/types';
import { findRepoRoots, enumerateProjectFiles } from './file-enumeration';
import { buildRcodeIgnoreMatcher } from './rcodeignore';

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

/** Walk engine reads at most this many files concurrently. */
const WALK_CONCURRENCY = 32;
/** A NUL byte within the first this-many bytes marks the file as binary. */
const BINARY_SNIFF_BYTES = 8000;
/** `git grep` stdout must emit well under this (NUL-separated matches). */
const GIT_GREP_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * The repo root's prefix relative to the project root, verbatim for
 * {@link parseGitGrepOutput}: `''` for the project root itself, otherwise the
 * `/`-separated relative path with a trailing slash (e.g. `'sub-a/'`).
 */
function rootPrefix(projectRoot: string, repoRoot: string): string {
  const rel = path.relative(projectRoot, repoRoot);
  if (!rel || rel === '.') return '';
  return rel.split(path.sep).join('/') + '/';
}

/**
 * Run `git grep -z -n -I -i -F --untracked --no-color -e <query>` in one repo
 * root. `-F` keeps the query a literal, `-i` makes it case-insensitive, `-I`
 * skips binaries, `-z` produces NUL-separated records that
 * {@link parseGitGrepOutput} can split safely (paths may contain `:`-like
 * noise, CJK, spaces or leading dashes), and `--max-count` caps matches per
 * file at the same value the walk engine uses.
 *
 * Resolves the raw stdout, `''` for a clean exit with no matches (git exits 1
 * when nothing matched — that is "no matches", not a failure), or `null` when
 * git itself failed (spawn error or timeout) so the caller can fall back to
 * walking that root's files.
 */
function gitGrepOne(dir: string, query: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [
        'grep',
        '-z',
        '-n',
        '-I',
        '-i',
        '-F',
        '--untracked',
        '--no-color',
        `--max-count=${TEXT_SEARCH_MAX_PER_FILE}`,
        '--',
        '-e',
        query,
      ],
      {
        cwd: dir,
        encoding: 'utf-8',
        timeout: TEXT_SEARCH_TIMEOUT_MS,
        maxBuffer: GIT_GREP_MAX_BUFFER,
      },
      (err, stdout) => {
        if (!err) {
          resolve(String(stdout));
          return;
        }
        // A spawned process that merely exits non-zero means "no matches"
        // (exit 1); only spawn errors (string `code`, e.g. ENOENT) and the
        // timeout kill are real failures worth walking for.
        const code = (err as NodeJS.ErrnoException).code;
        resolve(err.killed || typeof code !== 'number' ? null : '');
      },
    );
  });
}

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

/**
 * Grep one text file for a literal case-insensitive needle. Returns `null` when
 * the file cannot/should not be read (unreadable, over
 * {@link TEXT_SEARCH_MAX_FILE_BYTES}, or binary: a NUL byte within the first
 * {@link BINARY_SNIFF_BYTES} bytes).
 */
async function scanFile(
  absRoot: string,
  relPath: string,
  needle: string,
): Promise<SearchTextMatch[] | null> {
  const abs = path.join(absRoot, relPath);
  try {
    const stat = await fs.promises.stat(abs);
    if (stat.size > TEXT_SEARCH_MAX_FILE_BYTES) return null;
    const buf = await fs.promises.readFile(abs);
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
    const lines = buf.toString('utf8').split('\n');
    const matches: SearchTextMatch[] = [];
    for (let i = 0; i < lines.length && matches.length < TEXT_SEARCH_MAX_PER_FILE; i++) {
      let text = lines[i];
      if (text.toLowerCase().indexOf(needle) === -1) continue;
      if (text.endsWith('\r')) text = text.slice(0, -1);
      if (text.length > TEXT_SEARCH_MAX_LINE_CHARS) {
        text = text.slice(0, TEXT_SEARCH_MAX_LINE_CHARS);
      }
      matches.push({ path: relPath, line: i + 1, text });
    }
    return matches;
  } catch {
    return null;
  }
}

/**
 * Node fallback for the directories git cannot help with: read the candidate
 * files from {@link enumerateProjectFiles}, honouring `.rcodeignore` and the
 * walk caps. `relRoots` limits the scan to files under those repo-relative
 * roots (a failed repo root only falls back to the files it would have
 * covered); `null` scans everything — the no-git-root case. Sets `truncated`
 * when the file cap, match cap or the `deadline` budget forced an early stop.
 */
async function walkSearch(
  absRoot: string,
  query: string,
  relRoots: string[] | null,
  deadline: number,
): Promise<{ matches: SearchTextMatch[]; truncated: boolean }> {
  const ignore = buildRcodeIgnoreMatcher(absRoot);
  const needle = query.toLowerCase();
  const enumerated = await enumerateProjectFiles(absRoot);
  const candidates = enumerated.filter(
    (file) =>
      !ignore(file) &&
      (!relRoots ||
        relRoots.some((rel) => rel === '' || file === rel || file.startsWith(rel + '/'))),
  );

  const matches: SearchTextMatch[] = [];
  let truncated = false;
  let scanned = 0;

  for (let i = 0; i < candidates.length; i += WALK_CONCURRENCY) {
    if (
      scanned >= TEXT_SEARCH_MAX_FILES ||
      matches.length >= TEXT_SEARCH_MAX_MATCHES ||
      Date.now() > deadline
    ) {
      truncated = true;
      break;
    }
    // Never read past the file cap: the last batch is trimmed to the allowance.
    const batch = candidates.slice(
      i,
      i + Math.min(WALK_CONCURRENCY, TEXT_SEARCH_MAX_FILES - scanned),
    );
    scanned += batch.length;
    const results = await Promise.all(batch.map((file) => scanFile(absRoot, file, needle)));
    for (const found of results) {
      if (found) matches.push(...found);
    }
  }
  return { matches, truncated };
}

/**
 * Explorer full-text search over one project: literal, case-insensitive only.
 *
 * Runs one `git grep` per discovered repo root in parallel (nested repos first
 * via {@link findRepoRoots}), so a project whose real source lives in
 * gitignored sub-projects is still searched. A root whose git grep fails
 * (spawn error/timeout) falls back to the walk engine over just the files
 * enumeration reports under that root; with no git roots at all, everything is
 * walked. `engine` is `'git'` only when at least one git grep ran and no
 * fallback was needed; any fallback reports `'walk'`. Never rejects.
 */
export async function searchText(cwd: string, query: string): Promise<SearchTextResult> {
  const started = Date.now();
  // Blank query: nothing to spawn, nothing to walk.
  if (!query.trim()) {
    return { matches: [], truncated: false, engine: 'git', tookMs: 0 };
  }

  const projectRoot = path.resolve(cwd);
  const deadline = started + TEXT_SEARCH_TIMEOUT_MS;
  const roots = await findRepoRoots(projectRoot);

  const failedRelRoots: string[] = [];
  const gitGroups = await Promise.all(
    roots.map(async (root) => {
      const rel = rootPrefix(projectRoot, root);
      const stdout = await gitGrepOne(root, query);
      if (stdout === null) {
        failedRelRoots.push(rel.slice(0, -1)); // prefix minus its trailing slash
        return [];
      }
      return parseGitGrepOutput(stdout, rel);
    }),
  );

  // No git roots, or at least one git grep failed: walk what git could not cover.
  let walkResult: { matches: SearchTextMatch[]; truncated: boolean } | null = null;
  if (roots.length === 0 || failedRelRoots.length > 0) {
    walkResult = await walkSearch(projectRoot, query, roots.length ? failedRelRoots : null, deadline);
  }

  const merged = mergeMatches([
    ...gitGroups.flat(),
    ...(walkResult ? walkResult.matches : []),
  ]);
  return {
    matches: merged.matches,
    truncated: merged.truncated || (walkResult?.truncated ?? false),
    engine: roots.length > 0 && failedRelRoots.length === 0 ? 'git' : 'walk',
    tookMs: Date.now() - started,
  };
}
