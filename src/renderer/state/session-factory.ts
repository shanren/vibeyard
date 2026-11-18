import type { ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';

interface BaseOpts {
  id?: string;
  createdAt?: string;
}

export function buildCliSession(opts: BaseOpts & { name: string; providerId: ProviderId; args?: string; profileId?: string; envVars?: string }): SessionRecord {
  const { name, providerId, args, profileId, envVars, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    providerId,
    ...(args ? { args } : {}),
    ...(profileId ? { profileId } : {}),
    ...(envVars ? { envVars } : {}),
    cliSessionId: null,
    createdAt,
  };
}

export function buildDiffViewerSession(opts: BaseOpts & { name: string; filePath: string; area: string; worktreePath?: string }): SessionRecord {
  const { name, filePath, area, worktreePath, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'diff-viewer',
    diffFilePath: filePath,
    diffArea: area,
    ...(worktreePath ? { worktreePath } : {}),
    cliSessionId: null,
    createdAt,
  };
}

export function buildFileReaderSession(opts: BaseOpts & { name: string; filePath: string; lineNumber?: number }): SessionRecord {
  const { name, filePath, lineNumber, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'file-reader',
    fileReaderPath: filePath,
    ...(lineNumber !== undefined ? { fileReaderLine: lineNumber } : {}),
    cliSessionId: null,
    createdAt,
  };
}

export function buildMcpInspectorSession(opts: BaseOpts & { name: string }): SessionRecord {
  const { name, id = crypto.randomUUID(), createdAt = new Date().toISOString() } = opts;
  return {
    id,
    name,
    type: 'mcp-inspector',
    cliSessionId: null,
    createdAt,
  };
}

/**
 * Append a session to a project and mark it active. Does not call persist() or
 * emit events — those remain the caller's responsibility.
 */
export function attachSessionToProject(
  project: ProjectRecord,
  session: SessionRecord,
): SessionRecord {
  project.sessions.push(session);
  project.activeSessionId = session.id;
  // In split mode every new session joins the visible panes.
  if (project.layout.mode === 'split') project.layout.splitPanes.push(session.id);
  return session;
}
