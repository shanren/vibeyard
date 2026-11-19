/**
 * "Open with RCode" from the OS shell.
 *
 * A file-manager context-menu entry (or `rcode <path>`) hands us one path. The
 * rule the user asked for:
 *
 *   - folder already a project → just switch to it
 *   - folder not a project    → add it, then switch
 *   - a file                  → do the above for its directory, then open the file
 *
 * These helpers are pure so the decision is testable without any DOM/IPC.
 */

import { basename, dirname, normalizeShellPath, samePath } from '../../shared/platform.js';
import type { ProjectRecord } from '../../shared/types.js';

export interface ShellOpenPlan {
  /** Directory that owns the target — what a project is keyed by. */
  directory: string;
  /** Set when the shell handed us a file rather than a folder. */
  file?: string;
  /** Project name to use if we have to add one. */
  name: string;
}

/** Work out which directory (and optionally which file) a shell hand-off means. */
export function planShellOpen(target: string, isDirectory: boolean): ShellOpenPlan | null {
  const normalized = normalizeShellPath(target);
  if (!normalized) return null;

  if (isDirectory) {
    const directory = normalized;
    return { directory, name: basename(directory) || directory };
  }

  const directory = dirname(normalized);
  if (!directory || directory === '.' || directory === normalized) return null;
  return { directory, file: normalized, name: basename(directory) || directory };
}

/** The project whose root is exactly this directory, if any. */
export function findProjectForDirectory(
  projects: readonly ProjectRecord[],
  directory: string,
): ProjectRecord | undefined {
  return projects.find((project) => samePath(project.path, directory));
}
