import { describe, it, expect, vi } from 'vitest';

vi.mock('../session-cost.js', () => ({ restoreCost: vi.fn() }));
vi.mock('../session-context.js', () => ({ restoreContext: vi.fn() }));

import { hydrateLoadedState, serializeForSave } from './persistence.js';
import type { PersistedState, ProjectRecord, SessionRecord } from '../../shared/types.js';

function baseState(session: Partial<SessionRecord>): PersistedState {
  return {
    version: 1,
    activeProjectId: 'p1',
    preferences: {} as PersistedState['preferences'],
    projects: [
      {
        id: 'p1',
        name: 'Proj',
        path: '/p',
        activeSessionId: 's1',
        layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
        sessions: [{ id: 's1', name: 'S', cliSessionId: null, createdAt: '0', ...session }],
      },
    ],
  };
}

describe('hydrateLoadedState', () => {
  const prefs = {} as PersistedState['preferences'];

  function stateWithSessions(sessions: SessionRecord[], patch: Partial<ProjectRecord> = {}): PersistedState {
    const state = baseState({});
    state.projects[0].sessions = sessions;
    Object.assign(state.projects[0], patch);
    return state;
  }

  it('drops sessions whose type was removed from the product', () => {
    const state = stateWithSessions([
      { id: 'keep', name: 'CLI', cliSessionId: null, createdAt: '0' },
      { id: 'gone', name: 'Board', cliSessionId: null, createdAt: '0', type: 'kanban' },
    ]);

    hydrateLoadedState(state, prefs);

    expect(state.projects[0].sessions.map((s) => s.id)).toEqual(['keep']);
  });

  it('keeps every session type that survived', () => {
    const types = [undefined, 'file-reader', 'diff-viewer', 'mcp-inspector'] as const;
    const sessions = types.map((type, i) => ({
      id: `s${i}`, name: `S${i}`, cliSessionId: null, createdAt: '0', ...(type ? { type } : {}),
    })) as SessionRecord[];

    const state = stateWithSessions(sessions);
    hydrateLoadedState(state, prefs);

    expect(state.projects[0].sessions).toHaveLength(types.length);
  });

  it('clears activeSessionId when it pointed at a dropped session', () => {
    const state = stateWithSessions(
      [{ id: 'gone', name: 'Team', cliSessionId: null, createdAt: '0', type: 'team' }],
      { activeSessionId: 'gone' },
    );

    hydrateLoadedState(state, prefs);

    expect(state.projects[0].activeSessionId).toBeNull();
  });

  it('drops dangling splitPanes and demotes swarm mode to tabs', () => {
    const state = stateWithSessions(
      [
        { id: 'keep', name: 'CLI', cliSessionId: null, createdAt: '0' },
        { id: 'gone', name: 'Browser', cliSessionId: null, createdAt: '0', type: 'team' },
      ],
      { layout: { mode: 'swarm', splitPanes: ['keep', 'gone'], splitDirection: 'horizontal' } },
    );

    hydrateLoadedState(state, prefs);

    expect(state.projects[0].layout.splitPanes).toEqual(['keep']);
    expect(state.projects[0].layout.mode).toBe('tabs');
  });
});

describe('serializeForSave', () => {
  it('preserves the sticky profileId on sessions (resume must reuse the config dir)', () => {
    const out = serializeForSave(baseState({ profileId: 'work' }));
    expect(out.projects[0].sessions[0].profileId).toBe('work');
  });

  it('strips the transient pending prompts', () => {
    const out = serializeForSave(baseState({ profileId: 'work', pendingInitialPrompt: 'hi', pendingSystemPrompt: 'sys' }));
    const s = out.projects[0].sessions[0];
    expect(s.profileId).toBe('work');
    expect(s.pendingInitialPrompt).toBeUndefined();
    expect(s.pendingSystemPrompt).toBeUndefined();
  });

  it('passes the top-level profiles array through unchanged', () => {
    const state = baseState({});
    state.profiles = [{ id: 'work', name: 'Work', providerId: 'claude', configDir: '/cfg/work', managed: true, createdAt: 0 }];
    const out = serializeForSave(state);
    expect(out.profiles).toEqual(state.profiles);
  });
});
