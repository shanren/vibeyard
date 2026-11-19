import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { loadScanIgnorePatterns, buildRcodeIgnoreMatcher } from './rcodeignore';

vi.mock('fs');

const mockFs = vi.mocked(fs);

/** Make readFileSync return `content` for `.rcodeignore`, throw ENOENT otherwise. */
function mockRcodeignore(content: string | null): void {
  mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
    if (String(p).endsWith('.rcodeignore') && content !== null) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadScanIgnorePatterns', () => {
  it('strips comments and blank lines', () => {
    mockRcodeignore('# a comment\n\n*.min.js\n   \n  dist/  \n');
    expect(loadScanIgnorePatterns('/proj')).toEqual(['*.min.js', 'dist/']);
  });

  it('returns empty array when the file is missing', () => {
    mockRcodeignore(null);
    expect(loadScanIgnorePatterns('/proj')).toEqual([]);
  });

  it('returns empty array when the file has only comments/blanks', () => {
    mockRcodeignore('# only comments\n\n   \n');
    expect(loadScanIgnorePatterns('/proj')).toEqual([]);
  });
});

describe('buildRcodeIgnoreMatcher', () => {
  it('matches basename globs', () => {
    mockRcodeignore('*.min.js\n');
    const isIgnored = buildRcodeIgnoreMatcher('/proj');
    expect(isIgnored('vendor/app.min.js')).toBe(true);
    expect(isIgnored('src/app.ts')).toBe(false);
  });

  it('matches full-path globs', () => {
    mockRcodeignore('src/**/*.generated.ts\n');
    const isIgnored = buildRcodeIgnoreMatcher('/proj');
    expect(isIgnored('src/api/types.generated.ts')).toBe(true);
    expect(isIgnored('lib/types.generated.ts')).toBe(false);
  });

  it('never ignores when the file is missing or empty', () => {
    mockRcodeignore(null);
    const isIgnored = buildRcodeIgnoreMatcher('/proj');
    expect(isIgnored('anything.min.js')).toBe(false);
  });
});
