import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

/** Hard cap on the number of paths returned for one project. */
export const ENUMERATE_MAX_FILES = 20000;
/** Hard cap on directory depth, so a symlink loop cannot hang a search. */
export const ENUMERATE_MAX_DEPTH = 12;
/** `git ls-files` must emit well under this for a realistic repo (NUL-separated). */
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10000;
/** Repeated keystrokes reuse one enumeration; the tree is not hot-reloaded anyway. */
export const ENUMERATION_CACHE_TTL_MS = 2000;

/**
 * Directories that never contribute searchable paths. `.git` is skipped for the
 * walk, while the repo it belongs to is enumerated through git itself (which
 * applies that repo's own ignore rules).
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.idea',
  '.vs',
  '.gradle',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'bin',
  'obj',
  'TestResults',
  '__pycache__',
]);

/** VCS markers that are *files* in worktrees/submodules, so they must be filtered by name. */
const VCS_MARKERS: ReadonlySet<string> = new Set(['.git', '.hg', '.svn']);

interface CacheEntry {
  files: string[];
  at: number;
}

const cache = new Map<string, CacheEntry>();

/** Test hook / project-switch hook: forget every cached enumeration. */
export function clearEnumerationCache(): void {
  cache.clear();
}

async function isRepoRoot(dir: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * `git ls-files` for one repo, as repo-relative paths with `/` separators.
 * `-z` is load-bearing twice over: it drops the trailing-newline split, and it
 * disables the `core.quotepath` escaping that turned every non-ASCII filename
 * into a `"\345\244\226..."` blob — which no query could ever match, and which
 * could not be opened as a path either.
 *
 * Returns null when `dir` is not a usable repo (or git is missing), so the
 * caller can fall back to walking that subtree.
 */
async function gitListFiles(dir: string): Promise<string[] | null> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: dir, encoding: 'utf-8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (err, out) => (err ? reject(err) : resolve(String(out))),
    );
  }).catch(() => null);
  if (stdout === null) return null;
  return stdout.split('\0').filter(Boolean);
}

/**
 * Walk `absDir`, appending repo-relative (`/`-joined) paths to `out`.
 *
 * Each directory that is its own repo root is listed through `git ls-files`
 * instead of being walked, because git's view (tracked + untracked, honouring
 * that repo's `.gitignore`) is the right one *inside* a repo. The walk still
 * descends into those directories: a project's real source often lives in
 * sub-projects that are separate repos (and are therefore ignored by, or
 * invisible to, the outer repo) — the case where an outer-only `git ls-files`
 * silently returned almost nothing.
 */
async function visit(
  absDir: string,
  relDir: string,
  walkListsFiles: boolean,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > ENUMERATE_MAX_DEPTH || out.length >= ENUMERATE_MAX_FILES) return;

  let listsFiles = walkListsFiles;
  if (await isRepoRoot(absDir)) {
    const gitFiles = await gitListFiles(absDir);
    // A repo whose own `git ls-files` fails must fall back to walking *this*
    // subtree. Inheriting the parent's `listsFiles` would silently drop it:
    // when the outer repo lists fine, this repo's files are not in that listing
    // (git never descends into a nested repo), so nothing would report them.
    if (!gitFiles) listsFiles = true;
    else {
      for (const file of gitFiles) {
        if (out.length >= ENUMERATE_MAX_FILES) return;
        out.push(relDir ? `${relDir}/${file}` : file);
      }
      listsFiles = false;
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (out.length >= ENUMERATE_MAX_FILES) return;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await visit(path.join(absDir, entry.name), rel, listsFiles, depth + 1, out);
    } else if (listsFiles && !VCS_MARKERS.has(entry.name)) {
      out.push(rel);
    }
  }
}

/**
 * List a project's files (repo-relative, `/`-separated) so the Explorer search
 * (`fs:searchFiles`), quick-open (`fs:listFiles`) and `fs:topFilesByTokens` all
 * see what the file tree shows — including sub-projects that are their own repo.
 *
 * Results are cached briefly: the search fires on every debounced keystroke and
 * the enumeration spawns one `git ls-files` per nested repo. Never mutate the
 * returned array; callers that reshape it copy first.
 */
/**
 * Walk `absDir`, appending every directory that is its own repo root to `out`.
 *
 * Mirrors `visit`'s pruning (`SKIP_DIRS`, `ENUMERATE_MAX_DEPTH`) and its silent
 * treatment of unreadable directories, but keeps descending after a hit: a repo
 * can contain further nested repos, and each root is reported separately so the
 * full-text search can run one `git grep` per repo.
 */
async function visitRepos(absDir: string, depth: number, out: string[]): Promise<void> {
  if (depth > ENUMERATE_MAX_DEPTH) return;

  if (await isRepoRoot(absDir)) out.push(absDir);

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      await visitRepos(path.join(absDir, entry.name), depth + 1, out);
    }
  }
}

/**
 * Find the project root and every nested repo root (absolute paths) so the
 * Explorer full-text search can run one `git grep` per repo. The project root
 * itself comes first when it is a repo; every other root follows sorted by
 * full path, ascending.
 *
 * Shares the enumeration cache with `enumerateProjectFiles` (key prefix
 * `repo:`), so one `clearEnumerationCache()` invalidates both.
 */
export async function findRepoRoots(cwd: string): Promise<string[]> {
  const resolvedRoot = path.resolve(cwd);
  const cacheKey = `repo:${resolvedRoot}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < ENUMERATION_CACHE_TTL_MS) return cached.files;

  const found: string[] = [];
  await visitRepos(resolvedRoot, 0, found);
  // Depth-first walk order is close to ascending but not exact (e.g. `a/z`
  // is visited before `a-x`); the contract is full-path ascending.
  const first = found[0] === resolvedRoot;
  const roots = first
    ? [resolvedRoot, ...found.slice(1).sort()]
    : found.sort();
  cache.set(cacheKey, { files: roots, at: Date.now() });
  return roots;
}

export async function enumerateProjectFiles(cwd: string): Promise<string[]> {
  const resolvedRoot = path.resolve(cwd);
  const cached = cache.get(resolvedRoot);
  const now = Date.now();
  if (cached && now - cached.at < ENUMERATION_CACHE_TTL_MS) return cached.files;

  const found: string[] = [];
  await visit(resolvedRoot, '', true, 0, found);
  // A nested repo's files can also be listed by the outer repo (e.g. a sub-project
  // directory that is tracked *and* has its own `.git`), so union them once.
  const files = [...new Set(found)];
  cache.set(resolvedRoot, { files, at: Date.now() });
  return files;
}
