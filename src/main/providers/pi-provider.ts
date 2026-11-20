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

import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { MAX_INDEX_CHARS_PER_SESSION, TRANSCRIPT_TEXT_SEPARATOR } from './transcript-utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

  // ---- On-disk session history -------------------------------------------
  // `pi` keeps one JSONL per session under
  //   ~/.pi/agent/sessions/<slugified-cwd>/<created-at>_<session-id>.jsonl
  // and the first line is a `{"type":"session"}` record carrying both the id and
  // the exact cwd — so transcripts can be attributed to a project without
  // decoding the (lossy) slug.

  /** Root that holds every on-disk session, regardless of project. */
  private sessionsRoot(): string {
    return path.join(os.homedir(), '.pi', 'agent', 'sessions');
  }

  /** Absolute paths of every `*.jsonl` session file, across all project folders. */
  private async sessionFiles(): Promise<string[]> {
    const root = this.sessionsRoot();
    let dirs: fs.Dirent[];
    try {
      dirs = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: string[] = [];
    await Promise.all(
      dirs
        .filter((d) => d.isDirectory())
        .map(async (dir) => {
          const full = path.join(root, dir.name);
          try {
            const entries = await fs.promises.readdir(full);
            for (const name of entries) {
              if (name.endsWith('.jsonl')) files.push(path.join(full, name));
            }
          } catch {
            // unreadable project folder — skip it
          }
        }),
    );
    return files;
  }

  /** Read just the `type: "session"` header line of a session file. */
  private async readSessionHeader(file: string): Promise<{ id: string; cwd: string } | null> {
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(file, 'r');
      // The header line is short; a small read avoids touching large transcripts.
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
      const record = JSON.parse(firstLine) as { type?: string; id?: string; cwd?: string };
      if (record.type !== 'session' || !record.id) return null;
      return { id: record.id, cwd: record.cwd ?? '' };
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async discoverTranscripts(): Promise<TranscriptDescriptor[]> {
    const files = await this.sessionFiles();
    const out: TranscriptDescriptor[] = [];
    for (const file of files) {
      const header = await this.readSessionHeader(file);
      if (!header) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = (await fs.promises.stat(file)).mtimeMs;
      } catch {
        // vanished mid-scan
      }
      out.push({
        cliSessionId: header.id,
        transcriptPath: file,
        projectCwd: header.cwd || undefined,
        mtimeMs,
      });
    }
    return out;
  }

  getTranscriptPath(cliSessionId: string): string | null {
    // Session files are named `<timestamp>_<id>.jsonl`; the synchronous signature
    // means a shallow scan rather than the async enumeration above.
    const root = this.sessionsRoot();
    try {
      for (const dir of fs.readdirSync(root)) {
        const full = path.join(root, dir);
        let entries: string[];
        try {
          entries = fs.readdirSync(full);
        } catch {
          continue;
        }
        const hit = entries.find((name) => name.endsWith(`_${cliSessionId}.jsonl`));
        if (hit) return path.join(full, hit);
      }
    } catch {
      return null;
    }
    return null;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    const content = await fs.promises.readFile(transcriptPath, 'utf8');
    const texts: string[] = [];
    let cwd = '';
    let totalChars = 0;
    for (const line of content.split('\n')) {
      if (!line.trim() || totalChars >= MAX_INDEX_CHARS_PER_SESSION) continue;
      let record: {
        type?: string;
        cwd?: string;
        message?: { role?: string; content?: unknown };
      };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!cwd && record.cwd) cwd = record.cwd;
      if (record.type !== 'message' || !record.message?.content) continue;
      const text = textFromPiContent(record.message.content);
      if (text) {
        texts.push(text);
        totalChars += text.length;
      }
    }
    return { text: texts.join(TRANSCRIPT_TEXT_SEPARATOR), cwd };
  }

  validateSettings(): SettingsValidationResult {
    return { statusLine: 'missing', hooks: 'missing', hookDetails: {} };
  }

  reinstallSettings(): void {}
}

/**
 * Pi's message content is either a plain string or an array of blocks, where only
 * `type: "text"` blocks carry user-visible text.
 */
function textFromPiContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: string }).text;
      if (text) parts.push(text);
    }
  }
  return parts.join('\n').trim();
}
