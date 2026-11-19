import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

vi.mock('../session-context.js', () => ({
  restoreContext: vi.fn(),
}));

vi.mock('../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn(() => null),
  getProviderAvailabilitySnapshot: vi.fn(() => null),
  getTeamChatProviderMetas: vi.fn(() => []),
}));

import { appState, _resetForTesting } from '../state';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  _resetForTesting();
});

function addProject(name = 'Test', path = '/test') {
  return appState.addProject(name, path);
}

function addProjectWithSessions(count: number) {
  const project = addProject();
  appState.toggleSplit();
  const sessions = [];
  for (let i = 0; i < count; i++) {
    sessions.push(appState.addSession(project.id, `Session ${i + 1}`)!);
  }
  return { project, sessions };
}

function mockCostData() {
}

describe('toggleSplit()', () => {
  it('switches from split to tabs and preserves splitPanes', () => {
    addProjectWithSessions(3);
    expect(appState.activeProject!.layout.mode).toBe('split');
    expect(appState.activeProject!.layout.splitPanes.length).toBe(3);
    const panesBefore = [...appState.activeProject!.layout.splitPanes];
    appState.toggleSplit(); // split -> tabs
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('tabs');
    expect(layout.splitPanes).toEqual(panesBefore);
  });

  it('switches from tabs back to split and populates splitPanes', () => {
    addProjectWithSessions(2);
    appState.toggleSplit(); // split -> tabs
    appState.toggleSplit(); // tabs -> split
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('split');
    expect(layout.splitPanes.length).toBe(2);
  });

  it('emits layout-changed', () => {
    addProjectWithSessions(2);
    const cb = vi.fn();
    appState.on('layout-changed', cb);
    appState.toggleSplit();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('includes all CLI sessions in splitPanes by default', () => {
    addProjectWithSessions(8);
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('split');
    expect(layout.splitPanes.length).toBe(8);
  });

  it('stays in split when removing sessions down to 1 pane', () => {
    const { project, sessions } = addProjectWithSessions(2);
    appState.removeSession(project.id, sessions[0].id);
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('split');
    expect(layout.splitPanes.length).toBe(1);
  });

  it('places activeSessionId first in splitPanes when toggling to split', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.toggleSplit(); // split -> tabs
    appState.setActiveSession(project.id, sessions[0].id);
    appState.toggleSplit(); // tabs -> split
    expect(appState.activeProject!.layout.splitPanes[0]).toBe(sessions[0].id);
  });
});

describe('cycleSession()', () => {
  it('cycles forward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.cycleSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('cycles backward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.cycleSession(-1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[2].id);
  });

  it('wraps around forward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[2].id);
    appState.cycleSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
  });
});

describe('gotoSession()', () => {
  it('goes to session by index', () => {
    const { sessions } = addProjectWithSessions(3);
    appState.gotoSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('no-op for out-of-bounds index', () => {
    const { sessions } = addProjectWithSessions(2);
    const before = appState.activeProject!.activeSessionId;
    appState.gotoSession(5);
    expect(appState.activeProject!.activeSessionId).toBe(before);
  });
});

describe('batch removals', () => {
  it('removeAllSessions removes all sessions', () => {
    const { project } = addProjectWithSessions(3);
    appState.removeAllSessions(project.id);
    expect(appState.activeProject!.sessions).toHaveLength(0);
  });

  it('removeSessionsFromRight removes sessions after given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeSessionsFromRight(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.sessions.map((s) => s.id)).toEqual([sessions[0].id, sessions[1].id]);
  });

  it('removeSessionsFromLeft removes sessions before given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeSessionsFromLeft(project.id, sessions[2].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.sessions.map((s) => s.id)).toEqual([sessions[2].id, sessions[3].id]);
  });

  it('removeOtherSessions removes all except given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeOtherSessions(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
    expect(appState.activeProject!.sessions[0].id).toBe(sessions[1].id);
  });
});

describe('reorderSession()', () => {
  it('moves session to a different index', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.reorderSession(project.id, sessions[0].id, 2);
    const ids = appState.activeProject!.sessions.map((s) => s.id);
    expect(ids).toEqual([sessions[1].id, sessions[2].id, sessions[0].id]);
  });

  it('no-op when fromIndex === toIndex', () => {
    const { project, sessions } = addProjectWithSessions(3);
    mockSave.mockClear();
    appState.reorderSession(project.id, sessions[1].id, 1);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('syncs splitPanes order when reordering sessions', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // already in swarm mode by default
    const panesBefore = [...appState.activeProject!.layout.splitPanes];
    expect(panesBefore).toContain(sessions[0].id);
    expect(panesBefore).toContain(sessions[1].id);
    expect(panesBefore).toContain(sessions[2].id);

    // Move first session to last position
    appState.reorderSession(project.id, sessions[0].id, 2);
    const panesAfter = appState.activeProject!.layout.splitPanes;
    const sessionIds = appState.activeProject!.sessions.map(s => s.id);
    // splitPanes should follow sessions order
    expect(panesAfter).toEqual(sessionIds);
  });
});

describe('toggleSwarm() sync new CLI sessions', () => {
  it('adds sessions created while in tabs mode to splitPanes when toggling back to swarm', () => {
    const { project, sessions } = addProjectWithSessions(2);
    appState.toggleSplit();
    expect(appState.activeProject!.layout.mode).toBe('tabs');
    const newSession = appState.addSession(project.id, 'extra')!;
    expect(appState.activeProject!.layout.splitPanes).not.toContain(newSession.id);
    appState.toggleSplit();
    expect(appState.activeProject!.layout.splitPanes).toContain(newSession.id);
  });
});

