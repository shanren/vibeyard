import type { PersistedState, Preferences, ProjectRecord, SessionRecord } from '../../shared/types.js';
import { restoreContext } from '../session-context.js';

/**
 * Session types the app still knows how to render. Anything else in a loaded
 * `state.json` is dropped, so a state file written by an older version can't
 * resurrect a deleted feature or leave a dangling pane.
 */
const KEPT_SESSION_TYPES: ReadonlySet<string> = new Set([
  'file-reader',
  'diff-viewer',
]);

/**
 * Fields that belonged to features removed in 0.0.1. An old `state.json` carries
 * them, and because hydrate merges rather than replaces, they would otherwise be
 * written straight back on the next save.
 */
const STALE_TOP_LEVEL_FIELDS = ['team', 'lastSeenVersion', 'appLaunchCount', 'starPromptDismissed'] as const;
const STALE_PROJECT_FIELDS = [
  'board',
  'overviewLayout',
  'readiness',
  'readinessHistory',
  'githubLastSeen',
] as const;
const STALE_PREFERENCE_FIELDS = ['chromeImport', 'readinessExcludedProviders'] as const;

/**
 * Apply forward-compat migrations and runtime priming to a freshly-loaded state.
 * Mutates `state` in place.
 */
export function hydrateLoadedState(state: PersistedState, defaultPreferences: Preferences): void {
  state.preferences = { ...defaultPreferences, ...state.preferences };
  for (const field of STALE_TOP_LEVEL_FIELDS) delete (state as unknown as Record<string, unknown>)[field];
  for (const field of STALE_PREFERENCE_FIELDS) {
    delete (state.preferences as unknown as Record<string, unknown>)[field];
  }
  for (const project of state.projects) {
    for (const field of STALE_PROJECT_FIELDS) delete (project as unknown as Record<string, unknown>)[field];

    project.sessions = project.sessions.filter((s) => !s.type || KEPT_SESSION_TYPES.has(s.type));

    // Drop references that now point at nothing: a dangling activeSessionId
    // renders an empty pane, and a dangling splitPanes entry crashes layout.
    const liveIds = new Set(project.sessions.map((s) => s.id));
    if (project.activeSessionId && !liveIds.has(project.activeSessionId)) {
      project.activeSessionId = null;
    }
    project.layout.splitPanes = project.layout.splitPanes.filter((id) => liveIds.has(id));
    // Older state files may still carry the removed 'swarm' grid mode.
    if ((project.layout as { mode: string }).mode === 'swarm') project.layout.mode = 'tabs';

    for (const session of project.sessions) {
      if (session.contextWindow) restoreContext(session.id, session.contextWindow);
    }
    // RCode used to keep its own session history; the CLIs are the source of truth
    // now, so any leftover archive is dropped rather than migrated.
    if ('sessionHistory' in project) delete (project as { sessionHistory?: unknown }).sessionHistory;
  }
}

/**
 * Strip transient fields that should never be persisted (in-flight prompts).
 */
export function serializeForSave(state: PersistedState): PersistedState {
  return {
    ...state,
    projects: state.projects.map((p: ProjectRecord) => ({
      ...p,
      sessions: p.sessions.map(({ pendingInitialPrompt, ...rest }: SessionRecord) => rest as SessionRecord),
    })),
  };
}
