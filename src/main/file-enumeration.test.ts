import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `git` is the only external process involved: the mock answers per repo dir so
// these tests can model an outer repo that ignores its sub-projects.
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

import {
  enumerateProjectFiles,
  findRepoRoots,
  clearEnumerationCache,
  ENUMERATE_MAX_FILES,
  ENUMERATION_CACHE_TTL_MS,
} from './file-enumeration';

let root: string;

function toGitOutput(files: string[]): string {
  return files.length ? `${files.join('\0')}\0` : '';
}

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rcode-enum-'));
}

function writeFile(rel: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
}

/** Mark a directory as its own repo root (`git worktree` style `.git` file is fine). */
function markRepo(rel = ''): void {
  const dir = rel ? path.join(root, rel) : root;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: elsewhere');
}

function replyFor(dirRel: string, files: string[]): void {
  const dir = dirRel ? path.join(root, dirRel) : root;
  gitReplies.set(path.resolve(dir), toGitOutput(files));
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

describe('enumerateProjectFiles', () => {
  it('lists a repo through git, honouring its ignore rules', async () => {
    markRepo();
    writeFile('src/app.ts');
    writeFile('node_modules/dep/index.js');
    replyFor('', ['src/app.ts', '.gitignore']);

    expect(await enumerateProjectFiles(root)).toEqual(['src/app.ts', '.gitignore']);
  });

  it('finds sub-projects that are their own repo and are ignored by the outer repo', async () => {
    // The reported bug: project root is a repo whose .gitignore hides the
    // sub-projects, so an outer-only `git ls-files` returned almost nothing.
    markRepo();
    replyFor('', ['AGENTS.md']);
    writeFile('AGENTS.md');
    writeFile('.gitignore');

    markRepo('sub-a');
    writeFile('sub-a/pom.xml');
    replyFor('sub-a', ['pom.xml', 'src/main/App.java']);

    markRepo('nested/sub-b');
    writeFile('nested/sub-b/Dockerfile');
    replyFor('nested/sub-b', ['Dockerfile']);

    expect(new Set(await enumerateProjectFiles(root))).toEqual(new Set([
      'AGENTS.md',
      'sub-a/pom.xml',
      'sub-a/src/main/App.java',
      'nested/sub-b/Dockerfile',
    ]));
  });

  it('lists a file once when both the outer repo and a nested repo report it', async () => {
    markRepo();
    writeFile('docs/guide.md');
    replyFor('', ['docs/guide.md']);

    markRepo('docs');
    replyFor('docs', ['guide.md', 'guide.md']);

    expect(await enumerateProjectFiles(root)).toEqual(['docs/guide.md']);
  });

  it('requests NUL-separated output so non-ASCII paths are never escaped', async () => {
    markRepo();
    writeFile('docs/项目结构文档.md');
    replyFor('', ['docs/项目结构文档.md']);

    expect(await enumerateProjectFiles(root)).toEqual(['docs/项目结构文档.md']);
    expect(gitCalls[0].args).toContain('-z');
  });

  it('walks a non-repo project, listing dotfiles but skipping heavy directories', async () => {
    writeFile('a.ts');
    writeFile('.env');
    writeFile('node_modules/pkg/index.js');
    writeFile('target/classes/App.class');
    writeFile('src/deep/b.ts');

    expect(new Set(await enumerateProjectFiles(root))).toEqual(new Set([
      'a.ts',
      '.env',
      'src/deep/b.ts',
    ]));
    expect(gitCalls).toHaveLength(0);
  });

  it('falls back to walking the subtree when git fails at a repo root', async () => {
    markRepo();
    writeFile('kept.md');
    writeFile('node_modules/dep/index.js');
    gitReplies.set(path.resolve(root), new Error('git: command not found'));

    expect(await enumerateProjectFiles(root)).toEqual(['kept.md']);
  });

  it('returns repo-relative paths with / separators on every platform', async () => {
    markRepo();
    replyFor('', ['src/app.ts']);

    expect(await enumerateProjectFiles(root)).toEqual(['src/app.ts']);
    expect(gitCalls[0].cwd).toBe(path.resolve(root));
    expect(gitCalls[0].args.slice(0, 3)).toEqual(['ls-files', '-z', '--cached']);
  });

  it('caches one enumeration across debounced keystrokes and re-runs after clear', async () => {
    markRepo();
    replyFor('', ['a.ts']);

    expect(await enumerateProjectFiles(root)).toEqual(['a.ts']);
    expect(await enumerateProjectFiles(root)).toEqual(['a.ts']);
    expect(gitCalls).toHaveLength(1);

    clearEnumerationCache();
    expect(await enumerateProjectFiles(root)).toEqual(['a.ts']);
    expect(gitCalls).toHaveLength(2);
  });

  it('refreshes the cache once the TTL elapses', async () => {
    vi.useFakeTimers();
    try {
      markRepo();
      replyFor('', ['a.ts']);
      await enumerateProjectFiles(root);
      await enumerateProjectFiles(root);
      expect(gitCalls).toHaveLength(1);

      vi.advanceTimersByTime(ENUMERATION_CACHE_TTL_MS + 1);
      await enumerateProjectFiles(root);
      expect(gitCalls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the number of returned paths', async () => {
    markRepo();
    const many = Array.from({ length: ENUMERATE_MAX_FILES + 50 }, (_, i) => `f${i}.ts`);
    replyFor('', many);

    expect(await enumerateProjectFiles(root)).toHaveLength(ENUMERATE_MAX_FILES);
  });
});

describe('findRepoRoots', () => {
  it('returns the project root first when it is a repo, then nested repo roots', async () => {
    markRepo();
    markRepo('sub-a');
    markRepo('nested/sub-b');

    // Non-root roots are ordered by full path, ascending (ordinal compare).
    expect(await findRepoRoots(root)).toEqual([
      path.resolve(root),
      path.resolve(root, 'nested/sub-b'),
      path.resolve(root, 'sub-a'),
    ]);
  });

  it('finds a repo nested inside a non-repo root', async () => {
    markRepo('only-repo');

    expect(await findRepoRoots(root)).toEqual([path.resolve(root, 'only-repo')]);
  });

  it('returns [] for a plain directory with no repos', async () => {
    writeFile('a.ts');

    expect(await findRepoRoots(root)).toEqual([]);
  });

  it('does not descend into pruned directories', async () => {
    markRepo('node_modules/evil');

    expect(await findRepoRoots(root)).toEqual([]);
  });

  it('caches within the TTL, so a second call does not walk again', async () => {
    markRepo('sub-a');
    const first = await findRepoRoots(root);

    // A repo created after the first call must not appear in the cached
    // second result — that proves the walk was skipped within the TTL.
    markRepo('sub-late');
    expect(await findRepoRoots(root)).toEqual(first);

    clearEnumerationCache();
    expect(await findRepoRoots(root)).toEqual([
      path.resolve(root, 'sub-a'),
      path.resolve(root, 'sub-late'),
    ]);
  });
});
