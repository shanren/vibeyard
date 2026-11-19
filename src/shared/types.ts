// Shared type definitions used across main, preload, and renderer processes.

export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 2.0;

// --- Provider ---

export type ProviderId = 'claude' | 'codex' | 'copilot' | 'gemini' | 'custom';
export type PendingPromptTrigger = 'session-start' | 'first-output' | 'startup-arg';

/**
 * UI language tag. Defined here (rather than imported from `renderer/i18n.ts`)
 * because `shared/` is the lowest common denominator between main and
 * renderer; the renderer is the source of truth for the actual catalog.
 */
export type Locale = 'en' | 'zh-CN';

/**
 * Edit-menu actions dispatched from the custom in-app title bar (Windows) to
 * the main process, which forwards them to the focused webContents — the same
 * code path the native Windows Edit menu used before it was removed.
 */
export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';

export interface CliProviderCapabilities {
  sessionResume: boolean;
  costTracking: boolean;
  contextWindow: boolean;
  hookStatus: boolean;
  configReading: boolean;
  shiftEnterNewline: boolean;
  pendingPromptTrigger: PendingPromptTrigger;
  planModeArg?: string;
}

export interface CliProviderMeta {
  id: ProviderId;
  displayName: string;
  binaryName: string;
  capabilities: CliProviderCapabilities;
  defaultContextWindowSize: number;
}

// --- Git ---

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  isBare: boolean;
}

export interface GitFileEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  area: 'staged' | 'working' | 'untracked' | 'conflicted';
}

// --- Provider Config ---

export interface McpServer { name: string; url: string; status: string; scope: 'user' | 'project'; filePath: string }
export interface Agent { name: string; model: string; category: 'plugin' | 'built-in'; scope: 'user' | 'project'; filePath: string }
export interface Skill { name: string; description: string; scope: 'user' | 'project'; filePath: string }
export interface Command { name: string; description: string; scope: 'user' | 'project'; filePath: string }
export interface ProviderConfig { mcpServers: McpServer[]; agents: Agent[]; skills: Skill[]; commands: Command[] }
export type ClaudeConfig = ProviderConfig;

// --- Cost / Context (shared with renderer modules) ---

export interface CostInfo {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalDurationMs: number;
  totalApiDurationMs: number;
  model?: string;
}

export interface ContextWindowInfo {
  totalTokens: number;
  contextWindowSize: number;
  usedPercentage: number;
}

// --- Session / State ---

export type SessionType =
  | 'mcp-inspector'
  | 'diff-viewer'
  | 'file-reader'
;

export interface SessionRecord {
  id: string;
  name: string;
  type?: SessionType;
  providerId?: ProviderId;
  args?: string;
  /** Custom environment variables (raw `KEY=VALUE` lines) injected into the PTY on spawn. */
  envVars?: string;
  /**
   * The command a `'custom'` provider session runs (e.g. `pi`, `opencode -x`).
   * Only meaningful when `providerId === 'custom'`.
   */
  customCommand?: string;
  cliSessionId: string | null;
  mcpServerUrl?: string;
  diffFilePath?: string;
  diffArea?: string;
  worktreePath?: string;
  fileReaderPath?: string;
  fileReaderLine?: number;
  createdAt: string;
  userRenamed?: boolean;
  cost?: CostInfo;
  contextWindow?: ContextWindowInfo;
  /** Persisted, sticky: which Profile backs this session's CLI config dir. Resume must reuse it. */
  profileId?: string;
  /** Transient: initial prompt to inject on first spawn. Not persisted. */
  pendingInitialPrompt?: string;
  /** Transient: system prompt to attach on first spawn. Not persisted (resume must not re-inject). */
}

// --- Team ---

// --- CLI Provider Profiles ---

/**
 * A named CLI-provider profile backed by a separate config directory, injected
 * via the provider's config-dir env var (e.g. CLAUDE_CONFIG_DIR). Lets a user
 * isolate multiple licenses/logins (work vs personal). Currently only the
 * 'claude' provider injects it; the interface stays uniform for future providers.
 */
export interface Profile {
  id: string;
  name: string;
  providerId: ProviderId;
  /** Absolute, resolved config dir (managed under ~/.vibeyard/profiles/<id> or a custom path). */
  configDir: string;
  /** True when configDir is the auto-managed path; false when the user supplied a custom path. */
  managed: boolean;
  createdAt: number;
}

export interface ArchivedSession {
  id: string;
  name: string;
  providerId: ProviderId;
  cliSessionId: string | null;
  createdAt: string;
  closedAt: string;
  bookmarked?: boolean;
  /** Preserved so a resumed session reuses the same profile config dir (CLAUDE_CONFIG_DIR). */
  profileId?: string;
  cost: {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
  } | null;
}

export interface InitialContextSnapshot {
  sessionId: string;
  timestamp: string;
  totalTokens: number;
  contextWindowSize: number;
  usedPercentage: number;
}

export interface DeepSearchResult {
  providerId: ProviderId;
  cliSessionId: string;
  projectSlug: string;
  projectCwd: string;
  snippet: string;
  score: number;
  /** Title derived from the first user message — fallback when Vibeyard has no name for this session. */
  derivedName?: string;
  /** Profile whose config dir holds this transcript, so resume reopens under the right CLAUDE_CONFIG_DIR. */
  profileId?: string;
}

/** A CLI session transcript on disk that belongs to a specific project — used to
 *  surface a provider's own session history inside the per-project Sessions panel. */
export interface ProjectTranscript {
  providerId: ProviderId;
  cliSessionId: string;
  transcriptPath: string;
  /** Name derived from the first user message, or a truncated cliSessionId fallback. */
  name: string;
  /** Last-modified time of the transcript file (ms epoch). */
  mtimeMs: number;
  /** Profile whose config dir holds this transcript (Claude profiles). */
  profileId?: string;
}

export interface ProjectInsightsData {
  initialContextSnapshots: InitialContextSnapshot[];
  dismissed: string[];
}

// --- Board ---

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  layout: {
    mode: 'tabs' | 'split';
    splitPanes: string[];
    splitDirection: 'horizontal' | 'vertical';
  };
  sessionHistory?: ArchivedSession[];
  insights?: ProjectInsightsData;
  defaultArgs?: string;
  /** Last custom CLI command used in this project, prefilled in New Session. */
  customCliCommand?: string;
  /** Default profile applied to new sessions in this project (overridden per-session). */
  defaultProfileId?: string;
  defaultEnv?: string;
  terminalPanelOpen?: boolean;
  terminalPanelHeight?: number;
}


export interface Preferences {
  soundOnSessionWaiting: boolean;
  notificationsDesktop: boolean;
  debugMode: boolean;
  sessionHistoryEnabled: boolean;
  insightsEnabled: boolean;
  autoTitleEnabled: boolean;
  confirmCloseWorkingSession: boolean;
  zoomFactor?: number;
  defaultProvider?: ProviderId;
  /** UI language tag. See `Locale` for the supported set. */
  locale?: Locale;
  /** Global fallback profile applied when neither the session nor the project specifies one. */
  defaultProfileId?: string;
  statusLineConsent?: 'granted' | 'declined' | null;
  // The foreign statusLine command the user was asked about when they made
  // the consent decision. Used to detect new conflicts (different command)
  // vs the previously-acknowledged one.
  statusLineConsentCommand?: string | null;
  copyOnSelect?: boolean;
  keybindings?: Record<string, string>;
  theme?: 'dark' | 'light';
  sidebarViews?: {
    gitPanel: boolean;
    sessionHistory: boolean;
    fileTree: boolean;
    /** Show the global cross-project "Active Sessions" section in the sidebar. */
    activeSessions: boolean;
  };
  /**
   * Which live session statuses count as "active" for the global Active Sessions
   * sidebar section. Absent ⇒ the default set (working, input, completed).
   */
  activeSessionStatuses?: {
    working: boolean;
    waiting: boolean;
    input: boolean;
    completed: boolean;
  };
}

// --- Settings Validation ---

export interface SettingsValidationResult {
  statusLine: 'missing' | 'vibeyard' | 'foreign';
  hooks: 'missing' | 'complete' | 'partial';
  foreignStatusLineCommand?: string;
  hookDetails: Record<string, boolean>;
}

export interface SettingsWarningData {
  sessionId: string;
  statusLine: SettingsValidationResult['statusLine'];
  hooks: SettingsValidationResult['hooks'];
}

export interface StatusLineConflictData {
  foreignCommand: string;
}

export interface PersistedState {
  version: 1;
  projects: ProjectRecord[];
  activeProjectId: string | null;
  preferences: Preferences;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  explorerPanelOpen?: boolean;
  /** Global, provider-scoped CLI profiles (e.g. Claude work/personal config dirs). */
  profiles?: Profile[];
}



// --- Cost / Context ---

export interface CostData {
  cost: { total_cost_usd: number; total_duration_ms: number; total_api_duration_ms: number };
  model?: string;
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_tokens?: number;
    context_window_size?: number;
    used_percentage?: number;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  };
}

// --- Tool Failure ---

export interface ToolFailureData {
  tool_name: string;
  tool_input: Record<string, unknown>;
  error: string;
}

// --- Session Inspector ---

export type InspectorEventType =
  // Core 7 (status + inspector)
  | 'session_start' | 'user_prompt' | 'tool_use' | 'tool_failure'
  | 'stop' | 'stop_failure' | 'permission_request'
  // Inspector-only events
  | 'permission_denied'
  | 'pre_tool_use'
  | 'subagent_start' | 'subagent_stop'
  | 'notification'
  | 'pre_compact' | 'post_compact'
  | 'session_end'
  | 'task_created' | 'task_completed'
  | 'worktree_create' | 'worktree_remove'
  | 'cwd_changed' | 'file_changed' | 'config_change'
  | 'elicitation' | 'elicitation_result'
  | 'instructions_loaded'
  | 'teammate_idle'
  | 'status_update';

export interface InspectorEvent {
  type: InspectorEventType;
  timestamp: number;
  hookEvent: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  error?: string;
  cost_snapshot?: { total_cost_usd: number; total_duration_ms: number };
  context_snapshot?: { total_tokens: number; context_window_size: number; used_percentage: number };
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  agent_transcript_path?: string;
  message?: string;
  task_id?: string;
  worktree_path?: string;
  cwd?: string;
  file_path?: string;
  config_key?: string;
  question?: string;
  answer?: string;
}

export interface ToolUsageStats {
  tool_name: string;
  calls: number;
  failures: number;
  totalCost: number;
}

export interface ContextDataPoint {
  timestamp: number;
  usedPercentage: number;
  totalTokens: number;
}

// --- MCP ---

export interface McpResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// --- Usage Stats ---

export interface StatsDailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface StatsModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
}

// --- Filesystem IPC ---

/** A single filesystem change emitted by the directory watcher (chokidar-backed). */
export type FsChangeType = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

export interface FsChange {
  /** Absolute path of the entry that changed. */
  path: string;
  /** Absolute path of the parent directory (the watched dir the change belongs to). */
  dir: string;
  type: FsChangeType;
}

export type ReadFileResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'binary' | 'error' };

export type FileStatResult =
  | { ok: true; size: number; mtimeMs: number }
  | { ok: false };

export interface TopFile {
  path: string;
  tokens: number;
  size: number;
}

export type TopFilesResult =
  | { ok: true; files: TopFile[]; scanned: number; skipped: number }
  | { ok: false };

/** Result of the Explorer global file search (`fs:searchFiles`). */
export interface SearchFilesResult {
  /** Repo-relative paths, sorted case-insensitively ascending, length ≤ SEARCH_FILES_LIMIT. */
  files: string[];
  /** True when the total match count exceeded the limit (renderer shows a truncation footnote). */
  truncated: boolean;
}
