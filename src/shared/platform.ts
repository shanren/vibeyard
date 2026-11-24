// Cross-platform path utils — pure JS, no Node.js APIs.

export function lastSeparatorIndex(filePath: string): number {
  return Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
}

export function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false;
  if (filePath.startsWith('/') || filePath.startsWith('\\')) return true;
  return /^[a-zA-Z]:[\\/]/.test(filePath);
}

export function basename(filePath: string): string {
  const trimmed = filePath.endsWith('/') || filePath.endsWith('\\')
    ? filePath.slice(0, -1)
    : filePath;
  const i = lastSeparatorIndex(trimmed);
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

export function dirname(filePath: string): string {
  const trimmed = filePath.length > 1 && (filePath.endsWith('/') || filePath.endsWith('\\'))
    ? filePath.slice(0, -1)
    : filePath;
  const i = lastSeparatorIndex(trimmed);
  if (i === -1) return '.';
  if (i === 0) return trimmed.slice(0, 1); // root: '/' or '\'
  return trimmed.slice(0, i);
}

/** True when `child` is `parent` itself or nested anywhere beneath it. */
export function isPathUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + '/') || child.startsWith(parent + '\\');
}

/**
 * The absolute form of `filePath`, taken as relative to `basePath` when it is
 * not already rooted. Git-derived paths (diff sessions, search results) are
 * repo-relative, while the main process resolves every path it is handed and
 * rejects anything outside a known project — so callers must join before they
 * act on one.
 *
 * The join uses `basePath`'s own separator, so the result is a native-looking
 * path rather than the mixed `C:\proj/src/a.ts` that string concatenation with
 * `/` produces. An empty or missing base returns the input untouched.
 */
export function absolutePathFrom(basePath: string, filePath: string): string {
  if (isAbsolutePath(filePath) || !basePath) return filePath;
  const sep = basePath.includes('\\') ? '\\' : '/';
  const root = basePath.replace(/[\\/]+$/, '');
  const rest = filePath.replace(/^[\\/]+/, '').split(/[\\/]/).join(sep);
  return rest ? `${root}${sep}${rest}` : root;
}

/**
 * Normalise a path that arrived from outside the app (a shell command line, a
 * file-manager hand-off) into the form we store on projects:
 *
 *   - strip the surrounding quotes a registry command line leaves behind
 *   - collapse `\` to `/` so mixed-separator paths compare equal
 *   - drop trailing separators (`E:/Proj/` → `E:/Proj`), keeping bare roots intact
 *   - upper-case a Windows drive letter (`e:/proj` → `E:/proj`)
 *
 * Windows paths are case-insensitive, but the whole path is not lower-cased:
 * Linux/macOS are case-sensitive and share this helper.
 */
export function normalizeShellPath(raw: string): string {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  p = p.replace(/\\/g, '/');
  // Collapse duplicate separators, keeping a leading `//` (UNC) intact.
  p = p.replace(/([^:])\/{2,}/g, '$1/');
  while (p.length > 1 && p.endsWith('/')) {
    if (/^[a-zA-Z]:\/$/.test(p)) break; // keep drive roots
    p = p.slice(0, -1);
  }
  if (/^[a-z]:\//.test(p)) p = p[0].toUpperCase() + p.slice(1);
  return p;
}

/** Windows and macOS compare paths case-insensitively by default; Linux does not. */
function isCaseInsensitiveFs(): boolean {
  // `process` is absent in the browser harness.
  const platform = typeof process !== 'undefined' ? process.platform : '';
  return platform === 'win32' || platform === 'darwin';
}

/**
 * Compare two paths for equality ignoring separator style (`/` vs `\`), a
 * trailing separator, and — on Windows/macOS — letter case. The file watcher and
 * the shell hand-off emit OS-native paths while some callers build paths by
 * string concatenation, so a raw `===` is unreliable.
 */
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  const na = normalizeShellPath(a);
  const nb = normalizeShellPath(b);
  if (na === nb) return true;
  if (!isCaseInsensitiveFs()) return false;
  return na.toLowerCase() === nb.toLowerCase();
}
