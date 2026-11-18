/**
 * Status Bar — VS Code's 22px bottom strip.
 *
 * Left: the active project's branch + working-tree counts (this replaces the
 * old `#git-status` chip that lived in the tab bar; VS Code has no branch
 * indicator up there). Clicking it opens the same branch context menu.
 * Right: live session counts by status, then the aggregate session cost.
 *
 * Everything here is read-only telemetry — no view state lives in this module.
 */

import { appState } from '../state.js';
import { esc } from '../dom-utils.js';
import { t } from '../i18n.js';
import { getGitStatus, onChange as onGitChange } from '../git-status.js';
import { onChange as onGitStatusChange, getStatus as getSessionStatus } from '../session-activity.js';
import { getAggregateCost, onChange as onCostChange } from '../session-cost.js';
import { isCliSession } from '../session-utils.js';
import { showBranchContextMenu } from './tab-bar/git-status-bar.js';

let root: HTMLElement | null = null;
let branchEl: HTMLButtonElement | null = null;
let statusesEl: HTMLElement | null = null;
let costEl: HTMLElement | null = null;

function renderBranch(): void {
  if (!branchEl) return;
  const project = appState.activeProject;
  const status = project ? getGitStatus(project.id) : null;

  if (!project || !status || !status.isGitRepo) {
    branchEl.classList.add('hidden');
    return;
  }
  branchEl.classList.remove('hidden');

  const parts: string[] = [];
  if (status.branch) parts.push(`<span class="status-bar-branch">⎇ ${esc(status.branch)}</span>`);
  const ab: string[] = [];
  if (status.ahead > 0) ab.push(`↑${status.ahead}`);
  if (status.behind > 0) ab.push(`↓${status.behind}`);
  if (ab.length) parts.push(`<span>${ab.join(' ')}</span>`);
  if (status.staged > 0) parts.push(`<span>+${status.staged}</span>`);
  if (status.modified > 0) parts.push(`<span>~${status.modified}</span>`);
  if (status.untracked > 0) parts.push(`<span>?${status.untracked}</span>`);
  if (status.conflicted > 0) parts.push(`<span>!${status.conflicted}</span>`);

  branchEl.innerHTML = parts.join('');
  branchEl.title = status.branch ? t('statusBar.branchTooltip', { branch: status.branch }) : '';
}

function renderSessionStatuses(): void {
  if (!statusesEl) return;
  const project = appState.activeProject;
  if (!project) {
    statusesEl.innerHTML = '';
    return;
  }

  const counts = { working: 0, waiting: 0, input: 0, idle: 0, completed: 0 };
  for (const session of project.sessions) {
    if (!isCliSession(session)) continue;
    const status = getSessionStatus(session.id);
    counts[status] += 1;
  }

  const order: Array<keyof typeof counts> = ['working', 'waiting', 'input'];
  const parts = order
    .filter((key) => counts[key] > 0)
    .map(
      (key) =>
        `<span class="status-bar-item" title="${esc(t(`statusBar.status.${key}`))}">` +
        `<span class="status-bar-dot ${key}"></span>${counts[key]}</span>`,
    );

  statusesEl.innerHTML = parts.join('');
}

function renderCost(): void {
  if (!costEl) return;
  const cost = getAggregateCost();
  if (!cost || !cost.totalCostUsd) {
    costEl.classList.add('hidden');
    return;
  }
  costEl.classList.remove('hidden');
  costEl.textContent = `$${cost.totalCostUsd.toFixed(2)}`;
  costEl.title = t('statusBar.costTooltip');
}

export function initStatusBar(): void {
  root = document.getElementById('status-bar');
  if (!root) return;

  root.innerHTML = '';

  branchEl = document.createElement('button');
  branchEl.type = 'button';
  branchEl.className = 'status-bar-item hidden';
  branchEl.addEventListener('click', (e) => {
    void showBranchContextMenu(e, branchEl ?? undefined);
  });
  root.appendChild(branchEl);

  statusesEl = document.createElement('div');
  statusesEl.className = 'status-bar-item';
  root.appendChild(statusesEl);

  const spacer = document.createElement('div');
  spacer.className = 'status-bar-spacer';
  root.appendChild(spacer);

  const right = document.createElement('div');
  right.className = 'status-bar-right';
  costEl = document.createElement('span');
  costEl.className = 'status-bar-item hidden';
  right.appendChild(costEl);
  root.appendChild(right);

  const renderAll = () => {
    renderBranch();
    renderSessionStatuses();
    renderCost();
  };

  appState.on('state-loaded', renderAll);
  appState.on('project-changed', renderAll);
  appState.on('session-added', renderSessionStatuses);
  appState.on('session-removed', renderSessionStatuses);
  appState.on('session-changed', renderSessionStatuses);
  appState.on('preferences-changed', renderAll);

  onGitChange(() => renderBranch());
  onGitStatusChange(() => renderSessionStatuses());
  onCostChange(() => {
    renderSessionStatuses();
    renderCost();
  });

  renderAll();
}
