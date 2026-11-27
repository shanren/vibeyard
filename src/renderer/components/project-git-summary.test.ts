import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cache lives in the git-status module; stub its reader so the summary can be
// asserted from data alone.
const statuses = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('../git-status.js', () => ({
  getGitStatus: (projectId: string) => statuses.get(projectId) ?? null,
}));

import { projectGitSummary } from './project-git-summary';

function gitStatus(overrides: Record<string, unknown> = {}) {
  return {
    isGitRepo: true,
    branch: 'main',
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    ...overrides,
  };
}

const project = (id = 'p1', path = 'E:/repo') => ({ id, name: 'repo', path, sessions: [] }) as never;

describe('projectGitSummary', () => {
  beforeEach(() => statuses.clear());

  it('falls back to the project path when the project is not a repo', () => {
    statuses.set('p1', gitStatus({ isGitRepo: false, branch: null }));
    const s = projectGitSummary(project());
    expect(s.branch).toBeNull();
    expect(s.detail).toBe('E:/repo');
    expect(s.changes).toEqual([]);
  });

  it('falls back to the path when git status has not loaded yet', () => {
    const s = projectGitSummary(project());
    expect(s.branch).toBeNull();
    expect(s.detail).toBe('E:/repo');
    expect(s.aheadBehind).toBe('');
  });

  it('uses the branch as the detail line for a repo', () => {
    statuses.set('p1', gitStatus({ branch: 'feat/x' }));
    expect(projectGitSummary(project()).detail).toBe('feat/x');
  });

  it('formats ahead and behind together', () => {
    statuses.set('p1', gitStatus({ ahead: 16, behind: 2 }));
    expect(projectGitSummary(project()).aheadBehind).toBe('↑16 ↓2');
  });

  it('omits ahead/behind when level with the remote', () => {
    statuses.set('p1', gitStatus());
    expect(projectGitSummary(project()).aheadBehind).toBe('');
  });

  it('moves the staged/modified/untracked/conflicted breakdown onto the row', () => {
    statuses.set('p1', gitStatus({ staged: 2, modified: 24, untracked: 12, conflicted: 1 }));
    expect(projectGitSummary(project()).changes).toEqual([
      { className: 'git-staged', text: '+2' },
      { className: 'git-modified', text: '~24' },
      { className: 'git-untracked', text: '?12' },
      { className: 'git-conflicted', text: '!1' },
    ]);
  });

  it('drops zero-count fragments so the row stays quiet', () => {
    statuses.set('p1', gitStatus({ modified: 3 }));
    expect(projectGitSummary(project()).changes).toEqual([{ className: 'git-modified', text: '~3' }]);
  });

  it('reads the status of the project it was given, not another one', () => {
    statuses.set('p1', gitStatus({ branch: 'main' }));
    statuses.set('p2', gitStatus({ branch: 'other' }));
    expect(projectGitSummary(project('p1')).branch).toBe('main');
    expect(projectGitSummary(project('p2')).branch).toBe('other');
  });
});
