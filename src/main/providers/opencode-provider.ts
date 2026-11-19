/**
 * OpenCode provider (`opencode`).
 *
 * Contract verified against `opencode --help` on a real install:
 *   opencode [<subcommand>] [flags] [<directory>]
 *     --session, -s <id>   Session ID to continue, or to create if it does not exist
 *     --continue, -c       Continue the last session
 *     --prompt <string>    Prompt to use
 *     --standalone / --server / --auto
 *
 * `--session` is create-or-resume, so RCode assigns the id at session creation
 * and passes it on every spawn: first spawn creates that session, later spawns
 * (app restart, "Restart session") resume it.
 *
 * Not implemented (declared off through `capabilities`): status hooks, cost,
 * context window, config reading.
 */

import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';

const EMPTY_CONFIG: ProviderConfig = { mcpServers: [], agents: [], skills: [], commands: [] };
const binaryCache = { path: null as string | null };

export class OpencodeProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'opencode',
    displayName: 'OpenCode',
    binaryName: 'opencode',
    capabilities: {
      // `--session` creates or resumes, driven by the id we assign up front.
      sessionResume: true,
      preassignedSessionId: true,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
      shiftEnterNewline: false,
      // The prompt travels through `--prompt`, available at spawn time.
      pendingPromptTrigger: 'startup-arg',
    },
    defaultContextWindowSize: 0,
  };

  resolveBinaryPath(): string {
    return resolveBinary('opencode', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('opencode');
  }

  buildEnv(_sessionId: string, baseEnv: Record<string, string>): Record<string, string> {
    const env = { ...baseEnv };
    env.PATH = getFullPath();
    return env;
  }

  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string }): string[] {
    const args: string[] = [];

    // Create-or-resume with the id RCode assigned to this session.
    if (opts.cliSessionId) {
      args.push('--session', opts.cliSessionId);
    } else if (opts.isResume) {
      // No id on record: continue the last session instead of starting fresh.
      args.push('--continue');
    }

    if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    if (opts.initialPrompt) args.push('--prompt', opts.initialPrompt);

    return args;
  }

  async installHooks(): Promise<void> {}
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
