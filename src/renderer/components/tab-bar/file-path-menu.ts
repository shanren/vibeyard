import { t } from '../../i18n.js';
import { absolutePathFrom } from '../../../shared/platform.js';
import type { SessionRecord } from '../../state.js';

/** The actions a file-backed tab offers for its own path. */
export type TabFilePathActionId = 'open' | 'reveal' | 'copy';

/** One row of the path group in a tab's context menu. */
export interface TabFilePathItem {
  id: TabFilePathActionId;
  label: string;
}

/**
 * Menu rows for the path a file reader / diff tab points at, in the same order
 * the file tree uses: do something visible with the file (open it in the OS
 * default app, reveal it in Explorer/Finder), then the clipboard action.
 *
 * DOM-free so the labels and their order can be asserted without a menu, and so
 * tab-list.ts only has to translate each row into a click handler.
 */
export function tabFilePathMenuItems(): TabFilePathItem[] {
  return [
    { id: 'open', label: t('contextMenu.tab.openFilePath') },
    { id: 'reveal', label: t('contextMenu.tab.revealFilePath') },
    { id: 'copy', label: t('contextMenu.tab.copyFilePath') },
  ];
}

/**
 * Run one of those rows. Both filesystem calls go through the main process,
 * which re-checks that the path is inside a known project — so a stale tab whose
 * file was deleted fails quietly instead of launching anything.
 */
export function runTabFilePathAction(id: TabFilePathActionId, filePath: string): void {
  if (id === 'open') void window.rcode.fs.openInFolder(filePath);
  else if (id === 'reveal') void window.rcode.fs.revealItem(filePath);
  else void window.rcode.clipboard.write(filePath).catch(() => {});
}

/**
 * The absolute file a tab points at, or `''` when it is not file-backed (a CLI
 * session). A file reader stores an already-absolute path; a diff session's
 * `diffFilePath` comes from `git status` and is repo-relative, so it has to be
 * anchored to the session's worktree (or the project root for the main
 * checkout). Handing a relative path to the main process would make it resolve
 * against the app's cwd and open the wrong file — or nothing.
 */
export function tabFilePath(
  session: Pick<SessionRecord, 'fileReaderPath' | 'diffFilePath' | 'worktreePath'>,
  projectPath: string,
): string {
  const rawPath = session.fileReaderPath ?? session.diffFilePath ?? '';
  if (!rawPath) return '';
  return absolutePathFrom(session.worktreePath ?? projectPath, rawPath);
}
