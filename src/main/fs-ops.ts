import * as path from 'path';

/** A rename/create request is rejected before it reaches the filesystem. */
export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** Characters Windows refuses in a file name (and that break shell interop elsewhere). */
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Validate a single path segment the user typed into a New/Rename prompt.
 *
 * Accepts only a bare name: no separators, no `.`/`..`, no trailing dot or
 * space, none of the characters the OS rejects. Trimming happens here so both
 * callers (new file/folder, rename) share one rule set, and the comparison the
 * caller does afterwards ("did the name actually change?") sees the trimmed
 * value.
 */
export function validateEntryName(raw: string): NameCheck {
  const name = raw.trim();
  if (name === '') return { ok: false, reason: 'Name cannot be empty' };
  if (name === '.' || name === '..') return { ok: false, reason: 'Invalid name' };
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: 'Name cannot contain a path separator' };
  }
  if (ILLEGAL_CHARS.test(name)) {
    return { ok: false, reason: 'Name contains characters the filesystem rejects' };
  }
  // Trailing spaces are already gone via trim; a trailing dot is still possible
  // and Windows silently strips it, so the name the user sees would differ.
  if (name.endsWith('.')) {
    return { ok: false, reason: 'Name cannot end with a dot' };
  }
  if (RESERVED_WINDOWS.test(name)) {
    return { ok: false, reason: 'That name is reserved by the operating system' };
  }
  if (Buffer.byteLength(name, 'utf8') > 255) {
    return { ok: false, reason: 'Name is too long' };
  }
  return { ok: true, name };
}

/**
 * Work out the sibling path a rename would produce, so the caller can reject it
 * before touching the disk: `validateEntryName` for the new segment, plus the
 * "must be a sibling" rule (a rename never moves an entry to another folder).
 */
export function resolveRenameTarget(
  sourcePath: string,
  rawName: string,
): { ok: true; target: string } | { ok: false; reason: string } {
  const check = validateEntryName(rawName);
  if (!check.ok) return check;
  const dir = path.dirname(sourcePath);
  const target = path.join(dir, check.name);
  if (target === sourcePath) return { ok: false, reason: 'Name is unchanged' };
  return { ok: true, target };
}
