/**
 * Pi coding agent provider (`pi`, `@earendil-works/pi-coding-agent`).
 *
 * Contract verified against `pi --help` on a real install:
 *   pi [options] [--] [@files...] [messages...]
 *     --session-id <id>   open this directory's session with the ID, or create it
 *     --session <path|id> open an existing session by file path / id
 *     --continue, -c      continue the most recent session for this directory
 *     --session-dir <dir> where sessions are stored
 *     --model / --provider / --append-system-prompt
 *
 * `--session-id` is create-or-resume, which matches how RCode already models a
 * session: we hand it the id we assigned at creation, so the first spawn creates
 * that session and every later spawn (app restart, "Restart session") resumes it —
 * no hooks or transcript scraping needed.
 *
 * Not implemented (and declared off through `capabilities`): status hooks, cost,
 * context window, config reading. `pi` also has `--session-dir`, so a future
 * version can point sessions at a RCode-owned directory.
 */

import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';

const EMPTY_CONFIG: ProviderConfig = { mcpServers: [], agents: [], skills: [], commands: [] };
const binaryCache = { path: null as string | null };

export class PiProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'pi',
    displayName: 'Pi',
    binaryName: 'pi',
    capabilities: {
      // `--session-id` creates or resumes, driven by the id we assign up front.
      sessionResume: true,
      preassignedSessionId: true,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
      shiftEnterNewline: false,
      // The prompt is a positional argument, so it can be passed at spawn.
      pendingPromptTrigger: 'startup-arg',
    },
    defaultContextWindowSize: 0,
  };

  resolveBinaryPath(): string {
    return resolveBinary('pi', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('pi');
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
      args.push('--session-id', opts.cliSessionId);
    } else if (opts.isResume) {
      // No id on record (e.g. a session from an older build): fall back to the
      // directory's most recent session rather than starting a fresh one.
      args.push('--continue');
    }

    if (opts.extraArgs) args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));

    // `pi [options] [--] [@files...] [messages...]`: the prompt is positional, so
    // guard it with `--` — otherwise a prompt starting with `-` would be parsed
    // as a flag.
    if (opts.initialPrompt) args.push('--', opts.initialPrompt);

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
