import type { ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';
import { buildResumedSessionFromCliId } from './session-archive.js';

/** Find a session tab in this project that already has the given cliSessionId. */
export function findCliSessionTab(project: ProjectRecord, cliSessionId: string): SessionRecord | undefined {
  return project.sessions.find((s) => s.cliSessionId === cliSessionId);
}

export interface ResumeSourceData {
  providerId: ProviderId;
  cliSessionId: string | null | undefined;
  name: string;
  /** Source session's profile, so its transcript can be located in the right config dir. */
  profileId?: string;
}

/** Resolve a resume source from a live session id. */
export function resolveResumeSource(
  project: ProjectRecord,
  source: { sessionId?: string },
): ResumeSourceData | undefined {
  if (!source.sessionId) return undefined;
  const existing = project.sessions.find((s) => s.id === source.sessionId);
  if (!existing || !existing.providerId) return undefined;
  return {
    providerId: existing.providerId,
    cliSessionId: existing.cliSessionId,
    name: existing.name,
    profileId: existing.profileId,
  };
}

export { buildResumedSessionFromCliId };
