/**
 * What a project row shows for its git state, as data.
 *
 * The tab bar used to carry all of this in a `#git-status` chip: branch name,
 * `↑ahead ↓behind`, then `+staged ~modified ?untracked !conflicted` — but only
 * ever for the *active* project. The sidebar row already named each project's
 * branch, so the whole status line belongs there: one place to look, and it
 * belongs to the row that owns the project.
 *
 * DOM-free so the shape can be asserted without a browser.
 */

import type { ProjectRecord } from '../state.js';
import { getGitStatus } from '../git-status.js';
import { t } from '../i18n.js';

export interface ProjectGitSummary {
  /** Branch name, or null when the project is not a git repo (or HEAD is unborn). */
  branch: string | null;
  /** The row's detail line: the branch when there is one, else the project path. */
  detail: string;
  /** `↑2 ↓1`, empty when level with the remote. */
  aheadBehind: string;
  /** `+2 ~24 ?12 !1` as coloured fragments, empty when the tree is clean. */
  changes: { className: string; text: string }[];
  /** Tooltip for the change counts. */
  changesTitle: string;
}

export function projectGitSummary(project: ProjectRecord): ProjectGitSummary {
  const git = getGitStatus(project.id);
  const branch = git?.isGitRepo ? git.branch : null;

  const aheadBehind: string[] = [];
  if (git?.ahead) aheadBehind.push(`↑${git.ahead}`);
  if (git?.behind) aheadBehind.push(`↓${git.behind}`);

  const changes: ProjectGitSummary['changes'] = [];
  if (git?.staged) changes.push({ className: 'git-staged', text: `+${git.staged}` });
  if (git?.modified) changes.push({ className: 'git-modified', text: `~${git.modified}` });
  if (git?.untracked) changes.push({ className: 'git-untracked', text: `?${git.untracked}` });
  if (git?.conflicted) changes.push({ className: 'git-conflicted', text: `!${git.conflicted}` });

  return {
    branch,
    detail: branch ?? project.path,
    aheadBehind: aheadBehind.join(' '),
    changes,
    changesTitle: t('sidebar.uncommittedChanges'),
  };
}
