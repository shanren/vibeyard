/**
 * Branch switcher, opened from a project's branch row in the sidebar.
 *
 * It used to live in the tab bar as `#git-status`, which meant the control only
 * ever addressed the *active* project — switching branches was a two-step move
 * (activate the project, then find the chip at the far right of the tab bar).
 * The sidebar row already names each project's branch, so the switcher belongs
 * on that row instead: one click, correct project, no activation round-trip
 * needed first.
 *
 * The menu is therefore anchored to the clicked element and scoped to an
 * explicit `projectId`; nothing here reads `appState.activeProject`.
 */

import { getGitStatus, getActiveGitPath, refreshGitStatus } from '../git-status.js';
import { t } from '../i18n.js';
import { showModal, closeModal, setModalError } from './modal.js';
import { hideTabContextMenu, getActiveContextMenu, setActiveContextMenu, positionMenu } from './tab-bar/menu.js';

export async function showBranchContextMenu(anchor: HTMLElement, projectId: string): Promise<void> {
  hideTabContextMenu();

  const status = getGitStatus(projectId);
  if (!status || !status.isGitRepo) return;

  // Worktree-aware: the active worktree's repo, not necessarily the project root.
  const gitPath = getActiveGitPath(projectId);

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';

  const elRect = anchor.getBoundingClientRect();
  menu.style.left = `${elRect.left}px`;
  menu.style.top = `${elRect.bottom + 4}px`;

  const loadingItem = document.createElement('div');
  loadingItem.className = 'tab-context-menu-item disabled';
  loadingItem.textContent = t('gitBranch.loading');
  menu.appendChild(loadingItem);

  document.body.appendChild(menu);
  setActiveContextMenu(menu);

  try {
    const branches = await window.rcode.git.listBranches(gitPath);

    // Menu was dismissed during loading
    if (getActiveContextMenu() !== menu) return;

    menu.innerHTML = '';
    menu.addEventListener('click', (ev) => ev.stopPropagation());

    const searchInput = document.createElement('input');
    searchInput.className = 'branch-search-input';
    searchInput.type = 'text';
    searchInput.placeholder = t('gitBranch.filter');
    menu.appendChild(searchInput);

    const container = document.createElement('div');
    container.className = 'branch-list-container';
    menu.appendChild(container);

    let filteredBranches = branches;
    let activeIndex = 0;
    let itemElements: HTMLElement[] = [];

    function renderBranchItems(query: string): void {
      const lowerQuery = query.toLowerCase();
      filteredBranches = lowerQuery
        ? branches.filter((b) => b.name.toLowerCase().includes(lowerQuery))
        : branches;
      activeIndex = 0;
      itemElements = [];
      container.innerHTML = '';

      if (filteredBranches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tab-context-menu-item disabled';
        empty.textContent = t('gitBranch.noMatch');
        container.appendChild(empty);
        return;
      }

      for (let i = 0; i < filteredBranches.length; i++) {
        const branch = filteredBranches[i];
        const item = document.createElement('div');
        item.className = 'tab-context-menu-item'
          + (branch.current ? ' active' : '')
          + (i === activeIndex ? ' keyboard-active' : '');
        item.textContent = (branch.current ? '✓ ' : '  ') + branch.name;

        item.addEventListener('mouseenter', () => {
          activeIndex = i;
          setActiveHighlight();
        });

        if (!branch.current) {
          item.addEventListener('click', () => {
            hideTabContextMenu();
            switchBranch(gitPath, projectId, branch.name);
          });
        }
        itemElements.push(item);
        container.appendChild(item);
      }
    }

    function setActiveHighlight(): void {
      itemElements.forEach((el, i) => {
        el.classList.toggle('keyboard-active', i === activeIndex);
      });
    }

    function setActiveAndScroll(): void {
      setActiveHighlight();
      itemElements[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    searchInput.addEventListener('input', () => renderBranchItems(searchInput.value));

    searchInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          if (filteredBranches.length > 0) {
            activeIndex = (activeIndex + 1) % filteredBranches.length;
            setActiveAndScroll();
          }
          break;
        case 'ArrowUp':
          ev.preventDefault();
          if (filteredBranches.length > 0) {
            activeIndex = (activeIndex - 1 + filteredBranches.length) % filteredBranches.length;
            setActiveAndScroll();
          }
          break;
        case 'Enter':
          ev.preventDefault();
          if (activeIndex < filteredBranches.length) {
            const selected = filteredBranches[activeIndex];
            if (!selected.current) {
              hideTabContextMenu();
              switchBranch(gitPath, projectId, selected.name);
            }
          }
          break;
        case 'Escape':
          ev.preventDefault();
          hideTabContextMenu();
          break;
      }
    });

    renderBranchItems('');

    const separator = document.createElement('div');
    separator.className = 'tab-context-menu-separator';
    menu.appendChild(separator);

    const createItem = document.createElement('div');
    createItem.className = 'tab-context-menu-item';
    createItem.textContent = t('gitBranch.create');
    createItem.addEventListener('click', () => {
      hideTabContextMenu();
      promptCreateBranch(gitPath);
    });
    menu.appendChild(createItem);

    positionMenu(menu);

    searchInput.focus();
  } catch {
    if (getActiveContextMenu() !== menu) return;
    menu.innerHTML = '';
    const errItem = document.createElement('div');
    errItem.className = 'tab-context-menu-item disabled';
    errItem.textContent = t('gitBranch.loadFailed');
    menu.appendChild(errItem);
  }
}

async function switchBranch(gitPath: string, projectId: string, branchName: string): Promise<void> {
  const freshStatus = getGitStatus(projectId);
  const dirty = freshStatus
    ? freshStatus.staged + freshStatus.modified + freshStatus.conflicted
    : 0;
  if (dirty > 0 && !confirm(t('gitBranch.dirtyConfirm', { branch: branchName }))) return;

  try {
    await window.rcode.git.checkoutBranch(gitPath, branchName);
    refreshGitStatus();
  } catch (err) {
    alert(t('gitBranch.switchFailed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

function promptCreateBranch(gitPath: string): void {
  showModal(t('gitBranch.createTitle'), [
    { label: t('gitBranch.name'), id: 'branch-name', placeholder: 'feature/my-branch' },
  ], async (values) => {
    const name = values['branch-name']?.trim();
    if (!name) {
      setModalError('branch-name', t('gitBranch.nameRequired'));
      return;
    }
    if (/\s/.test(name)) {
      setModalError('branch-name', t('gitBranch.nameNoSpaces'));
      return;
    }
    try {
      await window.rcode.git.createBranch(gitPath, name);
      closeModal();
      refreshGitStatus();
    } catch (err) {
      setModalError('branch-name', t('gitBranch.createFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  });
}
