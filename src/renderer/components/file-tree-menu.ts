import type { MenuEntry } from './context-menu.js';
import type { DirEntry } from './file-entry-menu.js';

/** Actions a file-tree row can offer. `id` is what the dispatcher switches on. */
export type FileTreeMenuActionId =
  | 'open'
  | 'reveal'
  | 'copyPath'
  | 'copyRelativePath'
  | 'newFile'
  | 'newFolder'
  | 'rename'
  | 'delete'
  | 'properties';

/** One row of the menu: an action, or a rule between groups. */
export type FileTreeMenuEntry =
  | { separator: true }
  | { id: FileTreeMenuActionId; label: string; danger?: boolean };

/**
 * The right-click menu for a tree row, VS Code style: view/copy first, then the
 * mutating actions, with destructive work alone in the last group.
 *
 * Folders get creation entries; files get Open. `Properties` is last for both.
 * Kept DOM-free so the grouping and labels can be asserted in tests, and so the
 * renderer only has to translate ids into calls.
 */
export function fileTreeMenu(entry: Pick<DirEntry, 'isDirectory'>): FileTreeMenuEntry[] {
  if (entry.isDirectory) {
    return [
      { id: 'newFile', label: 'New File…' },
      { id: 'newFolder', label: 'New Folder…' },
      { separator: true },
      { id: 'reveal', label: 'Reveal in File Explorer' },
      { id: 'copyPath', label: 'Copy Path' },
      { id: 'copyRelativePath', label: 'Copy Relative Path' },
      { separator: true },
      { id: 'rename', label: 'Rename…' },
      { separator: true },
      { id: 'delete', label: 'Delete', danger: true },
      { separator: true },
      { id: 'properties', label: 'Properties' },
    ];
  }
  return [
    { id: 'open', label: 'Open' },
    { id: 'reveal', label: 'Reveal in File Explorer' },
    { separator: true },
    { id: 'copyPath', label: 'Copy Path' },
    { id: 'copyRelativePath', label: 'Copy Relative Path' },
    { separator: true },
    { id: 'rename', label: 'Rename…' },
    { separator: true },
    { id: 'delete', label: 'Delete', danger: true },
    { separator: true },
    { id: 'properties', label: 'Properties' },
  ];
}

/**
 * Project-relative form of an absolute path, always with `/` separators so it
 * pastes the same on every platform. Falls back to the absolute path when the
 * entry is not under the project root (an "outside the tree" row).
 */
export function toProjectRelative(projectPath: string, entryPath: string): string {
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const full = entryPath.replace(/\\/g, '/');
  if (full === root) return '';
  if (full.startsWith(`${root}/`)) return full.slice(root.length + 1);
  return full;
}

/** Turn the spec into renderer menu entries, wiring each id to its handler. */
export function menuEntriesFor(
  entry: Pick<DirEntry, 'isDirectory'>,
  handlers: Record<FileTreeMenuActionId, () => void>,
): MenuEntry[] {
  return fileTreeMenu(entry).map((item) =>
    'separator' in item
      ? item
      : {
          label: item.label,
          danger: item.danger,
          action: handlers[item.id],
        },
  );
}
