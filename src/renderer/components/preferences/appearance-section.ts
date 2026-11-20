import { appState } from '../../state.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { applyZoom, getZoomFactor, ZOOM_STEPS } from '../../zoom.js';
import { TERMINAL_FONT_SIZES, getTerminalFontSize } from '../../terminal-font.js';
import { t } from '../../i18n.js';
import type { PreferencesContext, SectionController } from './section.js';
import { toggleRow } from './shared.js';
import type { Preferences } from '../../../shared/types.js';
import { DEFAULT_ACTIVE_SESSION_STATUSES } from '../active-sessions-panel.js';

type SidebarViews = { gitPanel: boolean; sessionHistory: boolean; fileTree: boolean; activeSessions: boolean };
type ActiveStatuses = NonNullable<Preferences['activeSessionStatuses']>;

export function createAppearanceSection(ctx: PreferencesContext): SectionController {
  let themeSelect: CustomSelectInstance | null = null;
  let zoomSelect: CustomSelectInstance | null = null;
  let fontSelect: CustomSelectInstance | null = null;
  let zoomPrefUnsub: (() => void) | null = null;
  let sidebarCheckboxes: Record<keyof SidebarViews, HTMLInputElement> | null = null;
  let statusCheckboxes: Record<keyof ActiveStatuses, HTMLInputElement> | null = null;

  function unsubZoom() {
    zoomPrefUnsub?.();
    zoomPrefUnsub = null;
  }

  return {
    render(container) {
      if (themeSelect) themeSelect.destroy();
      if (zoomSelect) zoomSelect.destroy();
      if (fontSelect) fontSelect.destroy();

      const themeRow = document.createElement('div');
      themeRow.className = 'modal-toggle-field';
      const themeLabel = document.createElement('label');
      themeLabel.textContent = t('appearance.theme');
      themeSelect = createCustomSelect(
        'pref-theme',
        [{ value: 'dark', label: t('appearance.themeDark') }, { value: 'light', label: t('appearance.themeLight') }],
        ctx.originalTheme,
        (value) => { document.documentElement.dataset.theme = value; },
      );
      themeRow.appendChild(themeLabel);
      themeRow.appendChild(themeSelect.element);
      container.appendChild(themeRow);

      const zoomRow = document.createElement('div');
      zoomRow.className = 'modal-toggle-field';
      const zoomLabel = document.createElement('label');
      zoomLabel.textContent = t('appearance.zoom');
      const zoomOptions = ZOOM_STEPS.map((v) => ({ value: String(v), label: `${Math.round(v * 100)}%` }));
      zoomSelect = createCustomSelect('pref-zoom', zoomOptions, String(getZoomFactor()), (value) => {
        const n = parseFloat(value);
        if (!Number.isNaN(n)) applyZoom(n);
      });
      zoomRow.appendChild(zoomLabel);
      zoomRow.appendChild(zoomSelect.element);
      container.appendChild(zoomRow);

      const fontRow = document.createElement('div');
      fontRow.className = 'modal-toggle-field';
      const fontLabel = document.createElement('label');
      fontLabel.textContent = t('appearance.terminalFontSize');
      const fontOptions = TERMINAL_FONT_SIZES.map((v) => ({ value: String(v), label: `${v}px` }));
      fontSelect = createCustomSelect('pref-terminal-font-size', fontOptions, String(getTerminalFontSize()), (value) => {
        const n = Number(value);
        if (!Number.isNaN(n)) appState.setPreference('terminalFontSize', n);
      });
      fontRow.appendChild(fontLabel);
      fontRow.appendChild(fontSelect.element);
      container.appendChild(fontRow);

      // The GPU renderer is auto-detected once (a slow software-rasterised path
      // blocks the main thread for seconds), but the verdict can be wrong on a
      // machine that was busy during the probe — so it stays overridable.
      const rendererRow = document.createElement('div');
      rendererRow.className = 'modal-toggle-field';
      const rendererLabel = document.createElement('label');
      rendererLabel.textContent = t('appearance.terminalRenderer');
      const rendererOptions = [
        { value: 'auto', label: t('appearance.terminalRendererAuto') },
        { value: 'gpu', label: t('appearance.terminalRendererGpu') },
        { value: 'cpu', label: t('appearance.terminalRendererCpu') },
      ];
      const currentRenderer = appState.preferences.terminalWebgl;
      const rendererSelect = createCustomSelect(
        'pref-terminal-renderer',
        rendererOptions,
        currentRenderer === true ? 'gpu' : currentRenderer === false ? 'cpu' : 'auto',
        (value) => {
          appState.setPreference('terminalWebgl', value === 'auto' ? undefined : value === 'gpu');
        },
      );
      rendererRow.appendChild(rendererLabel);
      rendererRow.appendChild(rendererSelect.element);
      container.appendChild(rendererRow);

      unsubZoom();
      zoomPrefUnsub = appState.on('preferences-changed', () => {
        zoomSelect?.setValue(String(getZoomFactor()));
        fontSelect?.setValue(String(getTerminalFontSize()));
      });

      const sidebarHeading = document.createElement('div');
      sidebarHeading.className = 'preferences-subheading';
      sidebarHeading.textContent = t('appearance.sidebarViews');
      container.appendChild(sidebarHeading);

      const views = appState.preferences.sidebarViews ?? { gitPanel: true, sessionHistory: true, fileTree: true, activeSessions: true };
      const toggles: { key: keyof SidebarViews; label: string }[] = [
        { key: 'fileTree', label: t('appearance.fileTree') },
        { key: 'gitPanel', label: t('appearance.gitPanel') },
        { key: 'sessionHistory', label: t('appearance.sessionHistory') },
        { key: 'activeSessions', label: t('appearance.activeSessions') },
      ];

      const checkboxes = {} as Record<keyof SidebarViews, HTMLInputElement>;
      for (const toggle of toggles) {
        const { row, checkbox } = toggleRow(`pref-sidebar-${toggle.key}`, toggle.label, views[toggle.key] ?? true);
        container.appendChild(row);
        checkboxes[toggle.key] = checkbox;
      }
      sidebarCheckboxes = checkboxes;

      const statusHeading = document.createElement('div');
      statusHeading.className = 'preferences-subheading';
      statusHeading.textContent = t('appearance.activeSessionStatuses');
      container.appendChild(statusHeading);

      const statuses = appState.preferences.activeSessionStatuses ?? DEFAULT_ACTIVE_SESSION_STATUSES;
      const statusToggles: { key: keyof ActiveStatuses; label: string }[] = [
        { key: 'working', label: t('help.status.working') },
        { key: 'input', label: t('help.status.input') },
        { key: 'waiting', label: t('help.status.waiting') },
        { key: 'completed', label: t('help.status.completed') },
      ];
      const statusBoxes = {} as Record<keyof ActiveStatuses, HTMLInputElement>;
      for (const toggle of statusToggles) {
        const { row, checkbox } = toggleRow(`pref-active-status-${toggle.key}`, toggle.label, statuses[toggle.key] ?? DEFAULT_ACTIVE_SESSION_STATUSES[toggle.key]);
        container.appendChild(row);
        statusBoxes[toggle.key] = checkbox;
      }
      statusCheckboxes = statusBoxes;

    },

    save() {
      if (themeSelect) appState.setPreference('theme', themeSelect.getValue() as 'dark' | 'light');
      if (sidebarCheckboxes) {
        appState.setPreference('sidebarViews', {
          gitPanel: sidebarCheckboxes.gitPanel.checked,
          sessionHistory: sidebarCheckboxes.sessionHistory.checked,
          fileTree: sidebarCheckboxes.fileTree.checked,
          activeSessions: sidebarCheckboxes.activeSessions.checked,
        });
      }
      if (statusCheckboxes) {
        appState.setPreference('activeSessionStatuses', {
          working: statusCheckboxes.working.checked,
          waiting: statusCheckboxes.waiting.checked,
          input: statusCheckboxes.input.checked,
          completed: statusCheckboxes.completed.checked,
        });
      }
    },

    onLeave() {
      unsubZoom();
    },

    destroy() {
      unsubZoom();
      if (themeSelect) themeSelect.destroy();
      if (zoomSelect) zoomSelect.destroy();
      themeSelect = null;
      zoomSelect = null;
    },
  };
}
