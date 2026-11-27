// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The switcher is scoped by an explicit projectId, so the state and git modules
// only need to answer "what is this project's repo path" and "did we refresh".
const repos = vi.hoisted(() => new Map<string, { isGitRepo: boolean; branch: string | null }>());
const activeProjectId = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('../state.js', () => ({
  appState: {
    get activeProjectId() { return activeProjectId.value; },
    get activeProject() { return { id: activeProjectId.value, path: '/should/not/be/used' }; },
    on: vi.fn(),
  },
}));

vi.mock('../git-status.js', () => ({
  getGitStatus: (projectId: string) => repos.get(projectId) ?? null,
  getActiveGitPath: (projectId: string) => `/repo/${projectId}`,
  refreshGitStatus: vi.fn(),
}));

import { showBranchContextMenu } from './git-branch-switcher.js';

function stubBridge(branches: Record<string, { name: string; current: boolean }[]>) {
  const listBranches = vi.fn((path: string) => Promise.resolve(branches[path] ?? []));
  const checkoutBranch = vi.fn(() => Promise.resolve());
  const createBranch = vi.fn(() => Promise.resolve());
  (window as unknown as { rcode: unknown }).rcode = { git: { listBranches, checkoutBranch, createBranch } };
  return { listBranches, checkoutBranch, createBranch };
}

async function openMenu(projectId: string) {
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => ({ left: 10, bottom: 20 }) as DOMRect;
  document.body.appendChild(anchor);
  await showBranchContextMenu(anchor, projectId);
  await new Promise((r) => setTimeout(r, 0));
  return document.querySelector('.tab-context-menu') as HTMLElement | null;
}

describe('branch switcher', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    repos.clear();
    activeProjectId.value = 'a';
    repos.set('a', { isGitRepo: true, branch: 'main' });
    repos.set('b', { isGitRepo: true, branch: 'release' });
  });

  it('lists the branches of the project it was opened for, not the active one', async () => {
    const bridge = stubBridge({
      '/repo/a': [{ name: 'main', current: true }],
      '/repo/b': [{ name: 'release', current: true }, { name: 'main', current: false }],
    });

    const menu = await openMenu('b');

    expect(bridge.listBranches).toHaveBeenCalledWith('/repo/b');
    const items = [...menu!.querySelectorAll('.branch-list-container .tab-context-menu-item')];
    expect(items.map((i) => i.textContent?.trim())).toEqual(['✓ release', 'main']);
  });

  it('checks the branch out in that project’s repo', async () => {
    const bridge = stubBridge({
      '/repo/b': [{ name: 'release', current: true }, { name: 'main', current: false }],
    });
    const menu = await openMenu('b');

    const target = [...menu!.querySelectorAll('.branch-list-container .tab-context-menu-item')]
      .find((i) => i.textContent?.trim() === 'main') as HTMLElement;
    target.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(bridge.checkoutBranch).toHaveBeenCalledWith('/repo/b', 'main');
  });

  it('does nothing for a project that is not a git repo', async () => {
    repos.set('c', { isGitRepo: false, branch: null });
    const bridge = stubBridge({});

    expect(await openMenu('c')).toBeNull();
    expect(bridge.listBranches).not.toHaveBeenCalled();
  });
});
