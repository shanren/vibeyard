import type { PersistedState, Preferences, ProjectRecord, SessionRecord } from '../../shared/types.js';
import { restoreCost } from '../session-cost.js';
import { restoreContext } from '../session-context.js';

/**
 * Session types that no longer exist in the product. Sessions of these types
 * are dropped on load so an old state.json can't resurrect a deleted feature.
 * Kept as plain strings (not `SessionType`) so the literal stays valid while the
 * union members are being removed domain by domain.
 */
export const DROPPED_SESSION_TYPES: ReadonlySet<string> = new Set([
  'browser-tab',
  'project-tab',
  'kanban',
  'team',
  'remote-terminal',
]);

/**
 * Apply forward-compat migrations and runtime priming to a freshly-loaded state.
 * Mutates `state` in place.
 */
export function hydrateLoadedState(state: PersistedState, defaultPreferences: Preferences): void {
  state.preferences = { ...defaultPreferences, ...state.preferences };
  for (const project of state.projects) {
    project.sessions = project.sessions.filter((s) => !s.type || !DROPPED_SESSION_TYPES.has(s.type));

    // Drop references that now point at nothing: a dangling activeSessionId
    // renders an empty pane, and a dangling splitPanes entry crashes layout.
    const liveIds = new Set(project.sessions.map((s) => s.id));
    if (project.activeSessionId && !liveIds.has(project.activeSessionId)) {
      project.activeSessionId = null;
    }
    project.layout.splitPanes = project.layout.splitPanes.filter((id) => liveIds.has(id));
    if (project.layout.mode === 'swarm') project.layout.mode = 'tabs';

    for (const session of project.sessions) {
      if (session.cost) restoreCost(session.id, session.cost);
      if (session.contextWindow) restoreContext(session.id, session.contextWindow);
    }
    if (project.sessionHistory) {
      const seenIds = new Set<string>();
      for (const entry of project.sessionHistory) {
        if (seenIds.has(entry.id)) entry.id = crypto.randomUUID();
        seenIds.add(entry.id);
      }
    }
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
