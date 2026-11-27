import { appState } from '../../state.js';
import { onChange as onStatusChange } from '../../session-activity.js';
import { onChange as onUnreadChange } from '../../session-unread.js';
import { ICON_TERMINAL, ICON_MENU, ICON_FILES, providerMark } from '../../icons.js';
import { loadProviderAvailability, hasMultipleAvailableProviders, getProviderDisplayName } from '../../provider-availability.js';
import { t } from '../../i18n.js';
import { getActiveContextMenu, hideTabContextMenu } from './menu.js';
import { render, updateTabStatus, initMiddleClickClose } from './tab-list.js';
import { showMoreMenu, showNewSessionMenu, promptNewSession, quickNewSession, resolveProviderForNewSession } from './session-menu.js';

const btnAddSession = document.getElementById('btn-add-session')!;
const btnAddSessionMenu = document.getElementById('btn-add-session-menu')!;
const btnMore = document.getElementById('btn-more')!;
const btnToggleExplorer = document.getElementById('btn-toggle-explorer')!;
// Terminal toggle is wired in project-terminal.ts; we only own its icon here.
const btnToggleTerminal = document.getElementById('btn-toggle-terminal')!;

export function initTabBar(): void {
  initMiddleClickClose();
  btnToggleTerminal.innerHTML = ICON_TERMINAL;
  btnMore.innerHTML = ICON_MENU;
  btnToggleExplorer.innerHTML = ICON_FILES;

  // With no projects there is nothing to attach a session to, so the CTA would be
  // a dead button on first run. The empty state offers "New project" instead.
  const newSessionGroup = document.querySelector('.new-session-group') as HTMLElement | null;
  const syncNewSessionAvailability = (): void => {
    newSessionGroup?.classList.toggle('hidden', appState.projects.length === 0);
  };
  syncNewSessionAvailability();
  appState.on('state-loaded', syncNewSessionAvailability);
  appState.on('project-added', syncNewSessionAvailability);
  appState.on('project-removed', syncNewSessionAvailability);

  btnAddSession.addEventListener('click', () => quickNewSession());
  btnAddSession.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMoreMenu(e.clientX, e.clientY);
  });
  // The pill creates a session with the default CLI immediately; its caret lets you
  // pick a different installed CLI (still immediate) or fall back to the dialog.
  btnAddSessionMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btnAddSessionMenu.getBoundingClientRect();
    showNewSessionMenu(rect.left, rect.bottom + 4);
  });

  // Icon-only button: the text label lives in the tooltip and the accessible
  // name instead of costing ~80px of tab bar (the shortcut is the usual path).
  const newSessionIcon = btnAddSession.querySelector('.new-session-icon');
  const syncNewSessionButton = (): void => {
    const providerId = resolveProviderForNewSession();
    const name = getProviderDisplayName(providerId);
    if (newSessionIcon) newSessionIcon.innerHTML = providerMark(providerId, 'button');
    btnAddSession.title = t('tab.newSession.tooltip', { name });
    btnAddSession.setAttribute('aria-label', t('tab.newSession.label'));
    btnAddSessionMenu.title = t('tab.newSession.moreTooltip');
  };
  syncNewSessionButton();
  appState.on('state-loaded', syncNewSessionButton);
  appState.on('preferences-changed', syncNewSessionButton);
  loadProviderAvailability().then(syncNewSessionButton).catch(() => {});
  btnMore.addEventListener('click', (e) => {
    e.stopPropagation();
    if (getActiveContextMenu()) {
      hideTabContextMenu();
      return;
    }
    const rect = btnMore.getBoundingClientRect();
    showMoreMenu(rect.left, rect.bottom + 4);
  });

  // Icons only distinguish providers when multiple are installed
  loadProviderAvailability().then(() => {
    if (hasMultipleAvailableProviders()) render();
  }).catch(() => {});

  appState.on('state-loaded', render);
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', render);
  appState.on('session-changed', render);
  appState.on('layout-changed', render);

  onStatusChange(updateTabStatus);

  onUnreadChange(render);

  // Git state is rendered on the project rows in the sidebar (see
  // components/sidebar.ts); the tab bar no longer owns a branch chip.

  document.addEventListener('click', hideTabContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTabContextMenu(); });

  render();
}
