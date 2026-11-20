import type { ProviderId, SessionRecord } from '../../shared/types.js';

/**
 * Build a fresh SessionRecord that resumes a CLI session discovered on disk.
 *
 * RCode keeps no session records of its own: `cliSessionId` points at a
 * conversation the CLI tool owns, and the CLI's own flag is create-or-resume, so
 * opening a discovered session is just a tab bound to an existing id.
 */
export function buildResumedSessionFromCliId(
  cliSessionId: string,
  name: string,
  providerId: ProviderId = 'claude',
  profileId?: string,
): SessionRecord {
  return {
    id: crypto.randomUUID(),
    name,
    providerId,
    cliSessionId,
    createdAt: new Date().toISOString(),
    ...(profileId ? { profileId } : {}),
  };
}
