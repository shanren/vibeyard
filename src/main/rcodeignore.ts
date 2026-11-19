import * as path from 'path';
import picomatch from 'picomatch';
import { readFileSafe } from './fs-utils';

/**
 * Ignore-file names, newest first. `.vibeyardignore` is the pre-rename name and
 * is still read so existing projects keep honouring their rules; new files are
 * only ever written as `.rcodeignore`.
 */
export const IGNORE_FILE_NAMES = ['.rcodeignore', '.vibeyardignore'] as const;

/** The name new ignore files are created with. */
export const IGNORE_FILE_NAME = IGNORE_FILE_NAMES[0];

/** Read the project's ignore file, preferring the current name. */
function readIgnoreFile(projectPath: string): string | null {
  for (const name of IGNORE_FILE_NAMES) {
    const content = readFileSafe(path.join(projectPath, name));
    if (content) return content;
  }
  return null;
}

/**
 * Reads the project's ignore file and returns its active glob patterns (blank
 * lines and `#` comments stripped). Returns an empty array when the file is
 * absent or contains no patterns.
 */
export function loadScanIgnorePatterns(projectPath: string): string[] {
  const patterns: string[] = [];
  const content = readIgnoreFile(projectPath);
  if (content) {
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (line && !line.startsWith('#')) {
        patterns.push(line);
      }
    }
  }
  return patterns;
}

/**
 * Builds a predicate that reports whether a project-relative path is excluded
 * by the project's `.rcodeignore`. Patterns are matched against both the
 * basename (e.g. `*.min.js`) and the full relative path (e.g. a glob under
 * `src/`). When there are no patterns, the predicate is a constant `false`
 * (nothing is ignored).
 */
export function buildRcodeIgnoreMatcher(projectPath: string): (relPath: string) => boolean {
  const patterns = loadScanIgnorePatterns(projectPath);
  if (patterns.length === 0) return () => false;
  const matchBasename = picomatch(patterns, { basename: true });
  const matchFullPath = picomatch(patterns);
  return (relPath: string) => matchBasename(relPath) || matchFullPath(relPath);
}
