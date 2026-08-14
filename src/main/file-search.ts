import type { SearchFilesResult } from '../shared/types';

export const SEARCH_FILES_LIMIT = 500;

/**
 * Filter a project's repo-relative file list to those whose full relative path
 * contains `query` as a case-insensitive substring, sort the matches
 * case-insensitively by relative path ascending, and truncate to `limit`.
 *
 * Pure function — no I/O, no Electron. Callers are responsible for normalizing
 * an empty/blank query away before invoking this (the IPC handler short-circuits
 * it and the renderer never sends it).
 */
export function searchProjectFiles(
  allFiles: string[],
  query: string,
  limit: number = SEARCH_FILES_LIMIT,
): SearchFilesResult {
  const q = query.toLowerCase();
  const matched = allFiles.filter((f) => f.toLowerCase().includes(q));
  matched.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { files: matched.slice(0, limit), truncated: matched.length > limit };
}
