import { estimateTokens, TOKEN_COUNT_MAX_CHARS } from '../../shared/token-estimate.js';
import { showContextMenu, type MenuEntry } from './context-menu.js';
import { showConfirmDialog, showConfirmModal, showModal, showPropertiesDialog } from './modal.js';
import {
  menuEntriesFor,
  toProjectRelative,
  type FileTreeMenuActionId,
} from './file-tree-menu.js';

/**
 * One filesystem entry a menu can act on. Absolute paths are the contract — the
 * main process resolves and re-checks every mutating call against the known
 * projects, so a project-relative path has to be resolved first
 * (`absolutePathFrom` in `shared/platform.ts`).
 */
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** What a menu needs to know beyond the entry itself. */
export interface EntryMenuContext {
  /** Absolute project root, for "Copy Relative Path". */
  projectPath: string;
  /**
   * Called after a successful mutating action (rename, delete). The Explorer's
   * search results are a snapshot of one query, so they pass a re-run here to
   * avoid leaving rows that point at entries that no longer exist.
   */
  onMutated?: () => void;
}

/** Surface a filesystem failure instead of failing silently. */
function reportActionFailure(title: string, error?: string): void {
  showConfirmDialog(title, error ?? 'The operation could not be completed.', {
    confirmLabel: 'OK',
    cancelLabel: 'Close',
    onConfirm: () => {},
  });
}

function copyToClipboard(text: string): void {
  void window.rcode.clipboard.write(text).catch(() => {});
}

function promptNewEntry(dir: DirEntry, kind: 'file' | 'folder'): void {
  const isFolder = kind === 'folder';
  showModal(
    isFolder ? 'New Folder' : 'New File',
    [{ label: 'Name', id: 'name', type: 'text', placeholder: isFolder ? 'folder-name' : 'file-name.ts' }],
    async (values) => {
      const name = (values.name ?? '').trim();
      if (!name) return;
      // The name is a bare segment (the main process rejects separators); `/`
      // joins cleanly on both platforms and the walker normalizes it.
      const target = `${dir.path}/${name}`;
      const result = isFolder
        ? await window.rcode.fs.createDirectory(target)
        : await window.rcode.fs.writeFile(target, '');
      if (!result.ok) reportActionFailure(isFolder ? 'New Folder' : 'New File', result.error);
    },
    { confirmLabel: 'Create' },
  );
}

function promptRename(entry: DirEntry, ctx: EntryMenuContext): void {
  showModal(
    `Rename ${entry.isDirectory ? 'Folder' : 'File'}`,
    [{ label: 'Name', id: 'name', type: 'text', defaultValue: entry.name }],
    async (values) => {
      const name = (values.name ?? '').trim();
      if (!name || name === entry.name) return;
      const result = await window.rcode.fs.renamePath(entry.path, name);
      if (!result.ok) reportActionFailure('Rename', result.error);
      else ctx.onMutated?.();
    },
    { confirmLabel: 'Rename' },
  );
}

function confirmAndTrash(entry: DirEntry, ctx: EntryMenuContext): void {
  const kind = entry.isDirectory ? 'folder' : 'file';
  const base = entry.isDirectory
    ? `Move "${entry.name}" and its contents to the Trash?`
    : `Move "${entry.name}" to the Trash?`;
  // Deleting a VCS directory destroys history and is not obvious from the row
  // label alone, so say what is actually at stake before the user confirms.
  const isVcsDir = entry.isDirectory && ['.git', '.hg', '.svn'].includes(entry.name);
  const message = isVcsDir
    ? `${base}

This is a version-control directory: deleting it removes the repository's history from this folder.`
    : base;
  showConfirmModal(
    `Delete ${kind}`,
    message,
    async () => {
      const result = await window.rcode.fs.trashItem(entry.path);
      if (!result.ok) reportActionFailure('Delete', result.error);
      else ctx.onMutated?.();
    },
    { confirmLabel: 'Delete', danger: true },
  );
}

async function showFileProperties(entry: DirEntry): Promise<void> {
  const [statResult, readResult] = await Promise.all([
    window.rcode.fs.stat(entry.path),
    window.rcode.fs.readFile(entry.path),
  ]);
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];
  rows.push({ label: 'Path', value: entry.path, mono: true });
  rows.push({ label: 'Type', value: fileTypeLabel(entry.name) });
  rows.push({ label: 'Size', value: statResult.ok ? formatBytes(statResult.size) : '—' });
  rows.push({ label: 'Modified', value: statResult.ok ? formatMtime(statResult.mtimeMs) : '—' });
  if (readResult.ok) {
    const lines = readResult.content.length === 0 ? 0 : readResult.content.split('\n').length;
    rows.push({ label: 'Lines', value: lines.toLocaleString() });
    if (readResult.content.length > TOKEN_COUNT_MAX_CHARS) {
      rows.push({ label: 'Tokens', value: 'too large to count' });
    } else {
      rows.push({ label: 'Tokens', value: `~ ${estimateTokens(readResult.content).toLocaleString()}` });
    }
  } else {
    const why = readResult.reason === 'binary' ? 'binary file' : 'unreadable';
    rows.push({ label: 'Lines', value: `— (${why})` });
    rows.push({ label: 'Tokens', value: `— (${why})` });
  }
  showPropertiesDialog(entry.name, rows);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatMtime(ms: number): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  let rel: string;
  if (diffSec < 60) rel = `${diffSec}s ago`;
  else if (diffSec < 3600) rel = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) rel = `${Math.floor(diffSec / 3600)}h ago`;
  else if (diffSec < 86400 * 30) rel = `${Math.floor(diffSec / 86400)}d ago`;
  else rel = `${Math.floor(diffSec / (86400 * 30))}mo ago`;
  return `${rel} · ${new Date(ms).toLocaleString()}`;
}

function fileTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '(no ext)';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Bind every menu id to its action. Shared by the file tree and the Explorer's
 * search results, which is why it takes an absolute `entry.path` and the project
 * root rather than reaching for the active project itself.
 */
export function entryMenuHandlers(
  ctx: EntryMenuContext,
  entry: DirEntry,
): Record<FileTreeMenuActionId, () => void> {
  return {
    open: () => { void window.rcode.fs.openInFolder(entry.path); },
    reveal: () => { void window.rcode.fs.revealItem(entry.path); },
    copyPath: () => copyToClipboard(entry.path),
    copyRelativePath: () => copyToClipboard(toProjectRelative(ctx.projectPath, entry.path)),
    newFile: () => promptNewEntry(entry, 'file'),
    newFolder: () => promptNewEntry(entry, 'folder'),
    rename: () => promptRename(entry, ctx),
    delete: () => confirmAndTrash(entry, ctx),
    properties: () => { void showFileProperties(entry); },
  };
}

/** Right-click menu for one entry: view/copy, mutate, then the destructive action. */
export function fileEntryMenu(ctx: EntryMenuContext, entry: DirEntry): MenuEntry[] {
  return menuEntriesFor(entry, entryMenuHandlers(ctx, entry));
}

/** Build the menu for `entry` and show it at the pointer. */
export function showFileEntryMenu(
  x: number,
  y: number,
  ctx: EntryMenuContext,
  entry: DirEntry,
): void {
  showContextMenu(x, y, fileEntryMenu(ctx, entry));
}
