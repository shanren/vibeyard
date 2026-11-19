import { appState, type SessionRecord } from '../../state.js';
import type { ProviderId } from '../../../shared/types.js';
import { showModal, closeModal, setModalError, FieldDef } from '../modal.js';
import { findInvalidEnvLines } from '../../../shared/env-vars.js';
import { loadProviderAvailability, getProviderAvailabilitySnapshot, resolveDefaultProviderId, getAvailableProviderMetas } from '../../provider-availability.js';
import { providerMark } from '../../icons.js';
import { hideTabContextMenu, setActiveContextMenu, positionMenu } from './menu.js';
import { t } from '../../i18n.js';

/**
 * Create a session immediately, no dialog. `providerId` decides which CLI runs;
 * omitted ⇒ the configured default (with a fallback to the first installed one,
 * so a default that is no longer installed cannot spawn a missing binary).
 *
 * Custom CLI is the one provider that cannot be created blind — it needs a
 * command — so it uses the command this project used last and otherwise opens the
 * dialog, which is the only place that can ask for one.
 */
export function quickNewSession(providerId?: ProviderId): void {
  const project = appState.activeProject;
  if (!project) return;
  (document.activeElement as HTMLElement)?.blur?.();

  const resolved = resolveProviderForNewSession(providerId);
  if (resolved === 'custom' && !project.customCliCommand) {
    void promptNewSession();
    return;
  }

  const sessionNum = project.sessions.length + 1;
  appState.addSession(project.id, t('tab.newSession.defaultName', { num: sessionNum }), undefined, resolved);
}

/** Which provider a bare "New session" click should use right now. */
export function resolveProviderForNewSession(providerId?: ProviderId): ProviderId {
  const snapshot = getProviderAvailabilitySnapshot();
  const isAvailable = (id: ProviderId) => snapshot?.availability.get(id) ?? false;
  if (providerId) return providerId;
  return resolveDefaultProviderId(isAvailable, appState.preferences.defaultProvider);
}

/**
 * The caret's menu: one row per installed CLI, choice creates a session straight
 * away. "More options…" stays because the dialog is the only way to set a name,
 * extra args, env vars or a Claude profile.
 */
export function showNewSessionMenu(x: number, y: number): void {
  hideTabContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu new-session-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const providers = getAvailableProviderMetas();
  const current = resolveProviderForNewSession();

  for (const provider of providers) {
    const item = document.createElement('div');
    item.className = 'tab-context-menu-item' + (provider.id === current ? ' active' : '');
    const needsCommand = provider.id === 'custom' && !appState.activeProject?.customCliCommand;
    const label = document.createElement('span');
    label.className = 'new-session-menu-label';
    label.innerHTML = `${providerMark(provider.id, 'button')}<span>${provider.displayName}${needsCommand ? '…' : ''}</span>`;
    item.appendChild(label);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      quickNewSession(provider.id);
    });
    menu.appendChild(item);
  }

  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';
  menu.appendChild(separator);

  const more = document.createElement('div');
  more.className = 'tab-context-menu-item';
  more.textContent = t('tab.newSessionMenu.moreOptions');
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    void promptNewSession();
  });
  menu.appendChild(more);

  document.body.appendChild(menu);
  setActiveContextMenu(menu);
  positionMenu(menu);
}

// "More" overflow menu. Deliberately excludes actions that have their own
// toolbar icon (Terminal, Browser) and the New/Custom Session actions
// (those live on the pill + its caret).
export function showMoreMenu(x: number, y: number): void {
  hideTabContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const addItem = (label: string, onClick: () => void): void => {
    const item = document.createElement('div');
    item.className = 'tab-context-menu-item';
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      onClick();
    });
    menu.appendChild(item);
  };

  const addSeparator = (): void => {
    const sep = document.createElement('div');
    sep.className = 'tab-context-menu-separator';
    menu.appendChild(sep);
  };

  const splitActive = appState.activeProject?.layout.mode === 'split';
  addItem(splitActive ? t('tab.moreMenu.splitLayoutActive') : t('tab.moreMenu.splitLayout'), () => appState.toggleSplit());


  document.body.appendChild(menu);
  setActiveContextMenu(menu);

  positionMenu(menu);
}

export async function promptNewSession(onCreated?: (session: SessionRecord) => void): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  const sessionNum = project.sessions.length + 1;

  let providerSnapshot = getProviderAvailabilitySnapshot();
  if (!providerSnapshot) {
    await loadProviderAvailability();
    providerSnapshot = getProviderAvailabilitySnapshot();
  }
  const providers = providerSnapshot?.providers ?? [];
  const availabilityMap = providerSnapshot?.availability ?? new Map();

  const fields: FieldDef[] = [
    { label: t('tab.newSessionModal.nameLabel'), id: 'session-name', placeholder: t('tab.newSessionModal.namePlaceholder', { num: sessionNum }), defaultValue: t('tab.newSessionModal.namePlaceholder', { num: sessionNum }) },
    { label: t('tab.newSessionModal.argumentsLabel'), id: 'session-args', placeholder: t('tab.newSessionModal.argumentsPlaceholder'), defaultValue: project.defaultArgs ?? '' },
    {
      label: t('tab.newSessionModal.keepArgsLabel'),
      id: 'keep-args',
      type: 'checkbox',
      defaultValue: project.defaultArgs ? 'true' : undefined,
    },
    { label: t('tab.newSessionModal.envLabel'), id: 'session-env', type: 'textarea', placeholder: t('tab.newSessionModal.envPlaceholder'), defaultValue: project.defaultEnv ?? '' },
    {
      label: t('tab.newSessionModal.keepEnvLabel'),
      id: 'keep-env',
      type: 'checkbox',
      defaultValue: project.defaultEnv ? 'true' : undefined,
    },
  ];

  const preferred = appState.preferences.defaultProvider ?? 'claude';
  const effectiveProvider = (availabilityMap.get(preferred) ? preferred : providers.find(p => availabilityMap.get(p.id))?.id) ?? 'claude';
  if (providers.length > 1) {
    fields.unshift({
      label: t('tab.newSessionModal.providerLabel'),
      id: 'provider',
      type: 'select',
      defaultValue: effectiveProvider,
      onSelectChange: (value) => {
        setProfileFieldVisible(value === 'claude');
        setCustomCommandFieldVisible(value === 'custom');
      },
      options: providers.map(p => {
        const available = availabilityMap.get(p.id);
        return { value: p.id, label: available ? p.displayName : t('tab.newSessionModal.providerNotInstalled', { name: p.displayName }), disabled: !available };
      }),
    });
  }

  // Custom CLI: the user supplies the command. It sits directly under Provider —
  // it is the one field that matters for that provider — and is prefilled with
  // the last command used in this project.
  fields.splice(providers.length > 1 ? 1 : 0, 0, {
    label: t('tab.newSessionModal.customCommandLabel'),
    id: 'custom-command',
    type: 'text',
    placeholder: t('tab.newSessionModal.customCommandPlaceholder'),
    defaultValue: project.customCliCommand ?? '',
  });

  // Profile picker (Claude only). Defaults to the project/global default.
  const claudeProfiles = appState.profiles.filter(p => p.providerId === 'claude');
  if (claudeProfiles.length > 0) {
    fields.push({
      label: t('tab.newSessionModal.profileLabel'),
      id: 'profile',
      type: 'select',
      defaultValue: project.defaultProfileId ?? appState.preferences.defaultProfileId ?? '',
      options: [
        { value: '', label: t('sidebar.defaultProfileOption') },
        ...claudeProfiles.map(p => ({ value: p.id, label: p.name })),
      ],
    });
  }

  showModal(t('tab.newSessionModal.title'), fields, (values) => {
    const name = values['session-name']?.trim();
    if (!name) return;

    const envVars = values['session-env']?.trim() || undefined;
    if (envVars) {
      const invalid = findInvalidEnvLines(envVars);
      if (invalid.length > 0) {
        setModalError('session-env', t('tab.newSessionModal.envError', { line: invalid[0] }));
        return;
      }
    }

    closeModal();
    const args = values['session-args']?.trim() || undefined;
    const keepArgs = values['keep-args'] === 'true';
    project.defaultArgs = keepArgs ? (args || undefined) : undefined;
    const keepEnv = values['keep-env'] === 'true';
    project.defaultEnv = keepEnv ? (envVars || undefined) : undefined;
    const providerId = (values['provider'] || 'claude') as ProviderId;
    const customCommand = values['custom-command']?.trim();
    if (providerId === 'custom' && !customCommand) {
      setModalError('custom-command', t('tab.newSessionModal.customCommandRequired'));
      return;
    }
    // Profiles only apply to Claude; ignore the field for other providers.
    const profileId = providerId === 'claude' ? (values['profile'] || undefined) : undefined;
    const session = appState.addSession(
      project.id, name, args, providerId, profileId, envVars,
      providerId === 'custom' ? customCommand : undefined,
    );
    if (session && onCreated) onCreated(session);
  });

  // Profiles only apply to Claude — hide the field when the dialog opens
  // defaulted to a non-Claude provider. The provider select's onSelectChange
  // keeps it in sync as the user switches.
  if (claudeProfiles.length > 0) setProfileFieldVisible(effectiveProvider === 'claude');
  setCustomCommandFieldVisible(effectiveProvider === 'custom');
}

/** Toggle the Custom CLI command field's wrapper in the open New Session modal. */
function setCustomCommandFieldVisible(visible: boolean): void {
  const wrapper = document.getElementById('modal-custom-command')?.closest('.modal-field') as HTMLElement | null;
  if (wrapper) wrapper.style.display = visible ? '' : 'none';
}

/** Toggle the Profile field's wrapper in the open New Session modal. */
function setProfileFieldVisible(visible: boolean): void {
  const wrapper = document.getElementById('modal-profile')?.closest('.modal-field') as HTMLElement | null;
  if (wrapper) wrapper.style.display = visible ? '' : 'none';
}
