import type { BoardColumn, BoardData, PersistedState, Preferences, ProjectRecord, SessionRecord } from '../../shared/types.js';
import { restoreCost } from '../session-cost.js';
import { restoreContext } from '../session-context.js';
import { buildKanbanSession } from './session-factory.js';

export function createDefaultBoard(): BoardData {
  const columns: BoardColumn[] = [
    { id: crypto.randomUUID(), title: 'Backlog', order: 0, behavior: 'inbox' },
    { id: crypto.randomUUID(), title: 'Ready',   order: 1, behavior: 'none' },
    { id: crypto.randomUUID(), title: 'Running', order: 2, behavior: 'active' },
    { id: crypto.randomUUID(), title: 'Done',    order: 3, behavior: 'terminal' },
  ];
  return { columns, tasks: [] };
}

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
 * Ensure every project has a board, clear stale runtime sessionIds on board tasks,
 * and migrate the legacy `layout.mode === 'board'` to a kanban tab session.
 */
export function ensureProjectDefaults(state: PersistedState): void {
  for (const project of state.projects) {
    if (!project.board) project.board = createDefaultBoard();
    for (const task of project.board.tasks) task.sessionId = undefined;

    const legacyMode = (project.layout as { mode: string }).mode;
    if (legacyMode === 'board') {
      project.layout.mode = 'tabs';
      const existingKanban = project.sessions.find((s) => s.type === 'kanban');
      const kanbanSession = existingKanban ?? buildKanbanSession({ projectName: project.name });
      if (!existingKanban) project.sessions.push(kanbanSession);
      project.activeSessionId = kanbanSession.id;
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
      sessions: p.sessions.map(({ pendingInitialPrompt, pendingSystemPrompt, ...rest }: SessionRecord) => rest as SessionRecord),
    })),
  };
}
