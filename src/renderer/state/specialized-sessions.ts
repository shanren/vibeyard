import type { CliProviderCapabilities, Preferences, Profile, ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';

/** Resolve the provider id for a plan session: override → active session's → default → claude. */
export function resolvePlanProvider(
  project: ProjectRecord,
  prefs: Preferences,
  override: ProviderId | undefined,
): ProviderId {
  const activeSession = project.sessions.find((s) => s.id === project.activeSessionId);
  return override ?? activeSession?.providerId ?? prefs.defaultProvider ?? 'claude';
}

/** Build the args string for a plan session: project default args + plan-mode flag (if enabled). */
export function buildPlanSessionArgs(
  project: ProjectRecord,
  caps: CliProviderCapabilities | null | undefined,
  planMode: boolean,
): string | undefined {
  const planArg = planMode ? (caps?.planModeArg ?? '') : '';
  const base = project.defaultArgs ?? '';
  return [base, planArg].filter(Boolean).join(' ').trim() || undefined;
}

/** Resolve the providerId used when creating a plain CLI session. */
export function resolveCliProvider(prefs: Preferences, override: ProviderId | undefined): ProviderId {
  return override ?? prefs.defaultProvider ?? 'claude';
}

/**
 * Resolve the effective Profile for a session: session > project default > global
 * default > none. Only applies when the profile targets the session's provider
 * (returns undefined on mismatch, so the session uses the default config dir).
 */
export function resolveProfile(
  session: Pick<SessionRecord, 'profileId'> | undefined,
  project: Pick<ProjectRecord, 'defaultProfileId'> | undefined,
  prefs: Pick<Preferences, 'defaultProfileId'>,
  providerId: ProviderId,
  profiles: Profile[],
): Profile | undefined {
  const id = session?.profileId ?? project?.defaultProfileId ?? prefs.defaultProfileId;
  if (!id) return undefined;
  const profile = profiles.find((p) => p.id === id);
  if (!profile || profile.providerId !== providerId) return undefined;
  return profile;
}

export function findExistingDiffViewer(
  project: ProjectRecord,
  filePath: string,
  area: string,
  worktreePath: string | undefined,
): SessionRecord | undefined {
  return project.sessions.find(
    (s) => s.type === 'diff-viewer' && s.diffFilePath === filePath && s.diffArea === area && s.worktreePath === worktreePath,
  );
}

export function findExistingFileReader(project: ProjectRecord, filePath: string): SessionRecord | undefined {
  return project.sessions.find((s) => s.type === 'file-reader' && s.fileReaderPath === filePath);
}
/**
 * Build the session id we assign up front for providers whose flag creates-or-
 * resumes (`pi --session-id`, `opencode --session`). OpenCode rejects ids that do
 * not start with `ses`, hence `sessionIdPrefix`. Returns undefined when the
 * provider does not take a pre-assigned id.
 */
export function makePreassignedSessionId(
  capabilities: { preassignedSessionId?: boolean; sessionIdPrefix?: string } | null | undefined,
  uuid: string,
): string | undefined {
  if (!capabilities?.preassignedSessionId) return undefined;
  return (capabilities.sessionIdPrefix ?? '') + uuid;
}

/**
 * True when a stored session id does not match the provider's expected shape —
 * older builds handed OpenCode a bare UUID and it refused to start.
 */
export function isStoredSessionIdInvalid(
  capabilities: { sessionIdPrefix?: string } | null | undefined,
  cliSessionId: string | null | undefined,
): boolean {
  const prefix = capabilities?.sessionIdPrefix;
  if (!prefix || !cliSessionId) return false;
  return !cliSessionId.startsWith(prefix);
}
