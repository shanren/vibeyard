export type { McpServer, Agent, Skill, Command, ProviderConfig, ClaudeConfig, GitWorktree, GitFileEntry, CostData, McpResult, ProviderId, CliProviderMeta, CliProviderCapabilities } from '../shared/types.js';
import type { CostData, ProviderConfig, GitWorktree, McpResult, ProviderId, CliProviderMeta, TopFilesResult, SearchFilesResult, FsChange, DeepSearchResult, ProjectTranscript, EditAction, ReadFileResult } from '../shared/types.js';

// The renderer's view of the preload bridge. Deliberately the SAME type
// preload declares, so a namespace removed from preload becomes a compile
// error here instead of a runtime TypeError (esbuild does not type-check).
export type { VibeyardApi } from '../preload/preload.js';

