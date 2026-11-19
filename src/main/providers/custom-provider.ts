/**
 * Custom CLI provider — runs any user-supplied command as a session.
 *
 * This is the escape hatch for CLIs Vibeyard has no adapter for (pi, opencode,
 * aider, …). You type the command once per project and it becomes a real
 * session: its own PTY, tab, and entry in the sidebar.
 *
 * What it deliberately does NOT do — because none of it can be done without the
 * CLI's own cooperation, and pretending otherwise would show the user empty
 * state:
 *   - session resume (no `--resume` contract we can rely on)
 *   - hook-based status (working / waiting / needs-input)
 *   - cost / context-window tracking
 *   - transcript discovery for history + global search
 *   - config reading (MCP servers, agents, skills)
 *
 * Everything is declared through `capabilities` so the UI hides what is absent
 * instead of rendering dead controls.
 */

import type { BrowserWindow } from 'electron';
import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';

const EMPTY_CONFIG: ProviderConfig = { mcpServers: [], agents: [], skills: [], commands: [] };

/**
 * Split a user-typed command line into a binary and its leading arguments.
 * Handles the three shapes people actually type: `pi`, `pi --verbose`,
 * and `"/opt/My Tools/pi" --flag`.
 */
export function splitCommandLine(command: string): { binary: string; args: string[] } {
  const input = command.trim();
  if (!input) return { binary: '', args: [] };

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);

  return { binary: tokens[0] ?? '', args: tokens.slice(1) };
}

export class CustomProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'custom',
    displayName: 'Custom CLI',
    // No fixed binary: the command comes from the session.
    binaryName: '',
    capabilities: {
      sessionResume: false,
      costTracking: false,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
      shiftEnterNewline: false,
      // Unknown CLI: write the pending prompt to stdin once it starts talking.
      pendingPromptTrigger: 'first-output',
    },
    defaultContextWindowSize: 0,
  };

  resolveBinaryPath(): string {
    // Only reached when a custom session has no command, which the New Session
    // dialog prevents. Returning an empty string makes the failure obvious
    // instead of spawning some unrelated binary.
    return '';
  }

  validatePrerequisites(): boolean {
    // Always offerable: the user supplies the command.
    return true;
  }

  buildEnv(_sessionId: string, baseEnv: Record<string, string>): Record<string, string> {
    const env = { ...baseEnv };
    // Same augmented PATH the other providers use (nvm / homebrew / npm bin).
    env.PATH = getFullPath();
    return env;
  }

  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string }): string[] {
    const args: string[] = [];
    if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    return args;
  }

  /** Turn the session's command + args into a spawnable binary + argv. */
  buildSpawn(opts: { command: string; extraArgs: string; initialPrompt?: string }): { binary: string; args: string[] } {
    const { binary, args } = splitCommandLine(opts.command);
    if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    // No initialPrompt: we cannot know whether an arbitrary CLI takes a prompt
    // as an argument. The renderer writes it to stdin instead
    // (`pendingPromptTrigger: 'first-output'`).
    return { binary, args };
  }

  async installHooks(_win?: BrowserWindow | null): Promise<void> {}
  installStatusScripts(): void {}
  cleanup(): void {}

  async getConfig(): Promise<ProviderConfig> {
    return EMPTY_CONFIG;
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    return { statusLine: 'missing', hooks: 'missing', hookDetails: {} };
  }

  reinstallSettings(): void {}
}
