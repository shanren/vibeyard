import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGitGrepOutput,
  mergeMatches,
  TEXT_SEARCH_MAX_MATCHES,
  searchText,
} from './text-search';
import { clearEnumerationCache } from './file-enumeration';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `git` is the only external process involved: the mock answers per repo dir
// (keyed by `path.resolve(cwd)`) so these tests can model an outer repo plus
// nested sub-project repos without spawning anything.
const gitReplies = vi.hoisted(() => new Map<string, string | Error>());
const gitCalls = vi.hoisted(() => [] as { cwd: string; args: string[] }[]);

vi.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    opts: { cwd?: string },
    cb: (err: Error | null, stdout?: string) => void,
  ) => {
    const cwd = opts.cwd ?? '';
    gitCalls.push({ cwd, args });
    const reply = gitReplies.get(cwd);
    if (reply instanceof Error) cb(reply);
    else if (reply === undefined) cb(new Error('not a git repository'));
    else cb(null, reply);
  },
}));

describe('parseGitGrepOutput', () => {
  it('parses path/line/text triples from -z output', () => {
    const stdout = 'src/a.ts\x0012\x00const x = 1;\nsrc/b.ts\x007\x00hit here\n';
    expect(parseGitGrepOutput(stdout, '')).toEqual([
      { path: 'src/a.ts', line: 12, text: 'const x = 1;' },
      { path: 'src/b.ts', line: 7, text: 'hit here' },
    ]);
  });

  it('strips CRLF line endings', () => {
    expect(parseGitGrepOutput('a.md\x003\x00text\r\n', '')).toEqual([
      { path: 'a.md', line: 3, text: 'text' },
    ]);
  });

  it('keeps paths with spaces, CJK and leading dashes intact', () => {
    const stdout = 'docs/项目 结构.md\x009\x00命中\n-docs/note.md\x002\x00dash hit\n';
    expect(parseGitGrepOutput(stdout, 'QIS_WF/')).toEqual([
      { path: 'QIS_WF/docs/项目 结构.md', line: 9, text: '命中' },
      { path: 'QIS_WF/-docs/note.md', line: 2, text: 'dash hit' },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseGitGrepOutput('', '')).toEqual([]);
  });

  it('truncates over-long matched lines to the display cap', () => {
    const long = 'x'.repeat(2000);
    const [match] = parseGitGrepOutput(`a.ts\x001\x00${long}\n`, '');
    expect(match.text.length).toBe(400);
  });
});

describe('mergeMatches', () => {
  it('dedupes on (path, line) and sorts by path then line', () => {
    const merged = mergeMatches([
      { path: 'b.ts', line: 9, text: 'b9' },
      { path: 'a.ts', line: 20, text: 'a20' },
      { path: 'a.ts', line: 3, text: 'a3' },
      { path: 'a.ts', line: 3, text: 'a3-duplicate' },
    ]);
    expect(merged.matches.map((m) => `${m.path}:${m.line}`)).toEqual(['a.ts:3', 'a.ts:20', 'b.ts:9']);
    expect(merged.truncated).toBe(false);
  });

  it('caps at the default limit and flags truncated', () => {
    const many = Array.from({ length: TEXT_SEARCH_MAX_MATCHES + 5 }, (_, i) => ({
      path: 'a.ts',
      line: i + 1,
      text: 'x',
    }));
    const merged = mergeMatches(many);
    expect(merged.matches).toHaveLength(TEXT_SEARCH_MAX_MATCHES);
    expect(merged.truncated).toBe(true);
  });
});

describe('searchText', () => {
  let root: string;

  /** Queue a `git grep -z` reply for one repo dir: one record = path NUL line NUL text LF. */
  function replyFor(dirRel: string, records: { path: string; line: number; text: string }[]): void {
    const dir = dirRel ? path.join(root, dirRel) : root;
    gitReplies.set(
      path.resolve(dir),
      records.map((r) => `${r.path}\x00${r.line}\x00${r.text}\n`).join(''),
    );
  }

  function makeProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'rcode-text-search-'));
  }

  function writeFile(rel: string, content = 'x'): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  /** Mark a directory as its own repo root (`git worktree` style `.git` file is fine). */
  function markRepo(rel = ''): void {
    const dir = rel ? path.join(root, rel) : root;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: elsewhere');
  }

  beforeEach(() => {
    gitReplies.clear();
    gitCalls.length = 0;
    clearEnumerationCache();
    root = makeProject();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('runs git grep in every repo root and prefixes nested results', async () => {
    // root 是仓库（回复 AGENTS.md\0 1 \0 hit\n），并嵌套 sub-a 仓库（回复 pom.xml\0 2 \0 hit\n）
    markRepo();
    markRepo('sub-a');
    replyFor('', [{ path: 'AGENTS.md', line: 1, text: 'hit' }]);
    replyFor('sub-a', [{ path: 'pom.xml', line: 2, text: 'hit' }]);
    const result = await searchText(root, 'hit');
    expect(result.engine).toBe('git');
    expect(result.matches).toEqual([
      { path: 'AGENTS.md', line: 1, text: 'hit' },
      { path: 'sub-a/pom.xml', line: 2, text: 'hit' },
    ]);
    expect(gitCalls.map((c) => c.args.join(' '))).toEqual([
      expect.stringContaining('-F'),
      expect.stringContaining('-F'),
    ]);
  });

  it('passes the query as a literal -e argument after --', async () => {
    markRepo();
    replyFor('', []);
    await searchText(root, '-n a.*b');
    expect(gitCalls[0].args.slice(-3)).toEqual(['--', '-e', '-n a.*b']);
  });

  it('falls back to walking when git fails for a root', async () => {
    markRepo();
    writeFile('src/app.ts', 'needle'); // 内容含 'needle'
    gitReplies.set(path.resolve(root), new Error('git: old version'));
    const result = await searchText(root, 'needle');
    expect(result.engine).toBe('walk');
    expect(result.matches).toEqual([
      { path: 'src/app.ts', line: 1, text: expect.stringContaining('needle') },
    ]);
  });

  it('skips binaries, files over 1MB and rcodeignored files in the walk engine', async () => {
    writeFile('bin.dat', 'needle\0needle'); // NUL 头 → 二进制
    writeFile('huge.ts', 'needle'.repeat(200000)); // > 1MB
    writeFile('hidden.ts', 'needle'); // .rcodeignore 命中
    writeFile('.rcodeignore', 'hidden.ts\n');
    writeFile('ok.ts', 'a needle b');
    const result = await searchText(root, 'needle');
    expect(result.matches.map((m) => m.path)).toEqual(['ok.ts']);
  });

  it('returns no matches without spawning anything for a blank query', async () => {
    markRepo();
    expect(await searchText(root, '   ')).toEqual({
      matches: [],
      truncated: false,
      engine: 'git',
      tookMs: 0,
    });
    expect(gitCalls).toHaveLength(0);
  });
});
