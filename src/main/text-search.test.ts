import { describe, it, expect } from 'vitest';
import { parseGitGrepOutput, mergeMatches, TEXT_SEARCH_MAX_MATCHES } from './text-search';

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
