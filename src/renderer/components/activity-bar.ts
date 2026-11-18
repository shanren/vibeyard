/**
 * Activity Bar — the 48px icon rail on the far left (VS Code's activity bar).
 *
 * It owns *view switching* for the left column and nothing else:
 *   Projects → the project list sidebar
 *   Files    → the Explorer panel
 *   Git      → the sidebar with the project's git panel open
 *   Sessions → the sidebar with the project's session-history panel open
 *
 * There is exactly one left column visible at a time, mirroring VS Code. The
 * Settings gear at the bottom opens Preferences, like VS Code's gear.
 */

import { appState } from '../state.js';
import { ICON_FILES, ICON_GIT, ICON_PROJECTS, ICON_SESSIONS, ICON_SETTINGS } from '../icons.js';
import { openProjectPanel } from './sidebar.js';
import { showPreferencesModal } from './preferences-modal.js';
import { gitChangeCount, onChange as onGitChange } from '../git-status.js';
import { getStatus as getSessionStatus, onChange as onActivityChange } from '../session-activity.js';
import { isCliSession } from '../session-utils.js';
import { t } from '../i18n.js';

export type ActivityView = 'projects' | 'files' | 'git' | 'sessions';

interface ViewDef {
  view: ActivityView;
  icon: string;
  labelKey: string;
}

const VIEWS: ViewDef[] = [
  { view: 'projects', icon: ICON_PROJECTS, labelKey: 'activityBar.projects' },
  { view: 'files', icon: ICON_FILES, labelKey: 'activityBar.files' },
  { view: 'git', icon: ICON_GIT, labelKey: 'activityBar.git' },
  { view: 'sessions', icon: ICON_SESSIONS, labelKey: 'activityBar.sessions' },
];

let root: HTMLElement | null = null;
let current: ActivityView = 'projects';
const items = new Map<ActivityView, HTMLButtonElement>();
const badges = new Map<ActivityView, HTMLElement>();

/** Switch the left column to a view. Idempotent. */
export function setActivityView(view: ActivityView): void {
  current = view;
  const wantExplorer = view === 'files';

  appState.setExplorerPanelOpen(wantExplorer);

  // Exactly one left column: the Explorer replaces the sidebar, not stacks on it.
  const sidebarCollapsed = appState.sidebarCollapsed;
  if (wantExplorer && !sidebarCollapsed) appState.toggleSidebar();
  if (!wantExplorer && sidebarCollapsed) appState.toggleSidebar();

  if (view === 'git') openProjectPanel('git');
  else if (view === 'sessions') openProjectPanel('history');
  else openProjectPanel(null);

  applyActive();
}

/** The view the left column is currently showing, derived from live state. */
export function getActivityView(): ActivityView {
  if (appState.explorerPanelOpen) return 'files';
  return current === 'files' ? 'projects' : current;
}

function applyActive(): void {
  const active = getActivityView();
  for (const [view, btn] of items) {
    btn.classList.toggle('active', view === active);
  }
}

/** Counts shown as activity-bar badges (VS Code shows the same for Problems/SCM). */
export function computeBadges(): Partial<Record<ActivityView, number>> {
  const project = appState.activeProject;
  const out: Partial<Record<ActivityView, number>> = {};
  if (project) {
    const changes = gitChangeCount(project.id);
    if (changes && changes > 0) out.git = changes;
  }
  const busy = project
    ? project.sessions.filter((s) => {
        if (!isCliSession(s)) return false;
        const status = getSessionStatus(s.id);
        return status === 'working' || status === 'waiting' || status === 'input';
      }).length
    : 0;
  if (busy > 0) out.sessions = busy;
  return out;
}

function updateBadges(): void {
  const counts = computeBadges();
  for (const [view, el] of badges) {
    const n = counts[view];
    if (n && n > 0) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
}

function buildItem(def: ViewDef): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'activity-bar-item';
  btn.type = 'button';
  btn.title = t(def.labelKey);
  btn.setAttribute('aria-label', t(def.labelKey));
  btn.innerHTML = def.icon;

  const badge = document.createElement('span');
  badge.className = 'activity-bar-badge hidden';
  btn.appendChild(badge);
  badges.set(def.view, badge);

  btn.addEventListener('click', () => {
    // Clicking the active view collapses the left column, like VS Code.
    if (getActivityView() === def.view) {
      if (def.view === 'files') appState.setExplorerPanelOpen(false);
      else appState.toggleSidebar();
      applyActive();
      return;
    }
    setActivityView(def.view);
  });

  items.set(def.view, btn);
  return btn;
}

export function initActivityBar(): void {
  root = document.getElementById('activity-bar');
  if (!root) return;

  root.innerHTML = '';
  for (const def of VIEWS) root.appendChild(buildItem(def));

  const spacer = document.createElement('div');
  spacer.className = 'activity-bar-spacer';
  root.appendChild(spacer);

  const bottom = document.createElement('div');
  bottom.className = 'activity-bar-bottom';
  const settings = document.createElement('button');
  settings.className = 'activity-bar-item';
  settings.type = 'button';
  settings.title = t('activityBar.settings');
  settings.setAttribute('aria-label', t('activityBar.settings'));
  settings.innerHTML = ICON_SETTINGS;
  settings.addEventListener('click', () => showPreferencesModal());
  bottom.appendChild(settings);
  root.appendChild(bottom);

  const relabel = () => {
    for (const def of VIEWS) {
      const btn = items.get(def.view);
      if (!btn) continue;
      btn.title = t(def.labelKey);
      btn.setAttribute('aria-label', t(def.labelKey));
    }
    settings.title = t('activityBar.settings');
    settings.setAttribute('aria-label', t('activityBar.settings'));
  };

  applyActive();
  updateBadges();

  appState.on('state-loaded', () => {
    // Exactly one left column after a restore: if the Explorer was open when the
    // app quit, hide the sidebar instead of stacking two 300px columns.
    if (appState.explorerPanelOpen && !appState.sidebarCollapsed) appState.toggleSidebar();
    applyActive();
    updateBadges();
  });
  appState.on('project-changed', () => { applyActive(); updateBadges(); });
  appState.on('session-added', updateBadges);
  appState.on('session-removed', updateBadges);
  appState.on('session-changed', updateBadges);
  appState.on('sidebar-toggled', applyActive);
  appState.on('explorer-toggled', applyActive);
  appState.on('preferences-changed', relabel);

  onGitChange(() => updateBadges());
  onActivityChange(() => updateBadges());
}
