import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Real filesystem, real JSONL parsing: only the home directory is redirected.
let fakeHome = '';
vi.mock('os', async (importOriginal) => ({ ...(await importOriginal<typeof import('os')>()), homedir: () => fakeHome }));
vi.mock('../pty-manager', () => ({ getFullPath: () => '' }));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));

import { PiProvider } from './pi-provider';

const provider = new PiProvider();
const ROOT = (): string => path.join(fakeHome, '.pi', 'agent', 'sessions');

function writeSession(dir: string, file: string, lines: string[]): string {
  const full = path.join(ROOT(), dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.join('\n'));
  return full;
}

const header = (id: string, cwd: string): string =>
  JSON.stringify({ type: 'session', version: 3, id, timestamp: 't', cwd });

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rcode-pi-'));
});

afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('PiProvider on-disk history', () => {
  it('discovers sessions and attributes them by the cwd in the header line', async () => {
    const appCwd = path.join('E:', 'Project', 'app');
    const otherCwd = path.join('E:', 'Project', 'other');
    writeSession('--E--Project-app--', '2026-11-20T01-00-00-000Z_sess-a.jsonl', [header('sess-a', appCwd)]);
    writeSession('--E--Project-other--', '2026-11-20T02-00-00-000Z_sess-b.jsonl', [header('sess-b', otherCwd)]);

    const found = await provider.discoverTranscripts();

    expect(found.map((d) => d.cliSessionId).sort()).toEqual(['sess-a', 'sess-b']);
    const a = found.find((d) => d.cliSessionId === 'sess-a')!;
    expect(a.projectCwd).toBe(appCwd);
    expect(a.transcriptPath).toBe(path.join(ROOT(), '--E--Project-app--', '2026-11-20T01-00-00-000Z_sess-a.jsonl'));
    expect(a.mtimeMs).toBeGreaterThan(0);
  });

  it('ignores non-session files and malformed headers', async () => {
    writeSession('--E--Project-app--', 'bad.jsonl', ['{"type":"message","id":"x"}']);
    writeSession('--E--Project-app--', 'garbage.jsonl', ['not json']);
    writeSession('--E--Project-app--', 'notes.txt', ['ignore me']);
    expect(await provider.discoverTranscripts()).toEqual([]);
  });

  it('returns an empty list when no sessions directory exists', async () => {
    expect(await provider.discoverTranscripts()).toEqual([]);
  });

  it('extracts only user and assistant text from the body', async () => {
    const cwd = path.join('E:', 'Project', 'app');
    const file = writeSession('--E--Project-app--', '2026-11-20T01-00-00-000Z_sess-a.jsonl', [
      header('sess-a', cwd),
      JSON.stringify({ type: 'model_change', provider: 'x', modelId: 'y' }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'fix the filter' } }),
      JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use' }] },
      }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'and the tests' }] } }),
      'not json at all',
    ]);

    const indexed = await provider.indexTranscript(file);

    expect(indexed.cwd).toBe(cwd);
    expect(indexed.text).toContain('fix the filter');
    expect(indexed.text).toContain('on it');
    expect(indexed.text).toContain('and the tests');
    expect(indexed.text).not.toContain('model_change');
  });

  it('finds a transcript by session id, and null when it is gone', () => {
    const file = writeSession('--E--Project-app--', '2026-11-20T01-00-00-000Z_sess-a.jsonl', [header('sess-a', 'x')]);

    expect(provider.getTranscriptPath('sess-a')).toBe(file);
    expect(provider.getTranscriptPath('missing')).toBeNull();
  });
});
