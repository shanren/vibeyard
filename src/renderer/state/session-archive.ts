import type { ArchivedSession, ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';

const HISTORY_CAP = 500;

/**
 * Archive a session into project.sessionHistory. If a prior history entry
 * shares the same cliSessionId, update it in place; otherwise push a new one.
 * Caps history at 500 entries while preserving bookmarked entries.
 */
export function archiveSession(project: ProjectRecord, session: SessionRecord): void {
  const archived: ArchivedSession = {
    id: crypto.randomUUID(),
    name: session.name,
    providerId: (session.providerId || 'claude') as ProviderId,
    cliSessionId: session.cliSessionId,
    createdAt: session.createdAt,
    closedAt: new Date().toISOString(),
    profileId: session.profileId,
  };

  if (!project.sessionHistory) project.sessionHistory = [];

  const existingIndex = archived.cliSessionId
    ? project.sessionHistory.findIndex((a) => a.cliSessionId === archived.cliSessionId)
    : -1;
  if (existingIndex !== -1) {
    project.sessionHistory[existingIndex].closedAt = archived.closedAt;
    if (archived.name !== project.sessionHistory[existingIndex].name) {
      project.sessionHistory[existingIndex].name = archived.name;
    }
    // Always sync (not just when truthy) so clearing a session's profile is reflected.
    project.sessionHistory[existingIndex].profileId = archived.profileId;
  } else {
    project.sessionHistory.push(archived);
  }

  if (project.sessionHistory.length > HISTORY_CAP) {
    let nonBookmarkedToRemove = project.sessionHistory.length - HISTORY_CAP;
    project.sessionHistory = project.sessionHistory.filter((a) => {
      if (a.bookmarked) return true;
      if (nonBookmarkedToRemove > 0) { nonBookmarkedToRemove--; return false; }
      return true;
    });
  }
}

/** Build a fresh SessionRecord that resumes a previously archived CLI session. */
export function buildResumedSession(archived: ArchivedSession): SessionRecord {
  return {
    id: crypto.randomUUID(),
    name: archived.name,
    providerId: archived.providerId,
    cliSessionId: archived.cliSessionId,
    createdAt: new Date().toISOString(),
    profileId: archived.profileId,
  };
}

/** Build a fresh SessionRecord from a bare cliSessionId (no RCode history entry required). */
export function buildResumedSessionFromCliId(cliSessionId: string, name: string, providerId: ProviderId = 'claude', profileId?: string): SessionRecord {
  return {
    id: crypto.randomUUID(),
    name,
    providerId,
    cliSessionId,
    createdAt: new Date().toISOString(),
    ...(profileId ? { profileId } : {}),
  };
}
