import { describe, it, expect } from 'vitest';
import { searchProjectFiles, SEARCH_FILES_LIMIT } from './file-search';

describe('searchProjectFiles', () => {
  it('matches filenames case-insensitively (AC-5)', () => {
    const result = searchProjectFiles(['Store.ts', 'user-Store.ts', 'STORE.test.ts'], 'store');
    expect(result.files).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('matches a substring anywhere in the whole relative path (AC-6)', () => {
    const all = ['store.ts', 'userstore.ts', 'src/user-store/util.ts', 'store-utils.ts', 'unrelated.ts'];
    const result = searchProjectFiles(all, 'store');
    expect(result.files).toHaveLength(4);
    expect(result.files).toEqual(expect.arrayContaining([
      'store.ts',
      'userstore.ts',
      'src/user-store/util.ts',
      'store-utils.ts',
    ]));
  });

  it('matches directory-name segments, not just the filename (AC-7)', () => {
    const result = searchProjectFiles(['src/store/index.ts', 'src/other/index.ts'], 'store');
    expect(result.files).toEqual(['src/store/index.ts']);
  });

  it('sorts case-insensitively by relative path ascending (AC-12)', () => {
    const result = searchProjectFiles(['B.ts', 'a.ts', 'src/x.ts', 'Z.ts'], '.ts');
    expect(result.files).toEqual(['a.ts', 'B.ts', 'src/x.ts', 'Z.ts']);
  });

  it('truncates to the limit and flags truncated when matches exceed it (AC-13)', () => {
    const many = Array.from({ length: 600 }, (_, i) => `file${String(i).padStart(3, '0')}.ts`);
    const result = searchProjectFiles(many, 'file');
    expect(result.files).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it('keeps truncated false when matches are within the limit (AC-13)', () => {
    const result = searchProjectFiles(['a.ts', 'b.ts', 'c.ts'], 't');
    expect(result.files).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('honors an explicit limit parameter', () => {
    const result = searchProjectFiles(['a.ts', 'b.ts', 'c.ts'], 't', 2);
    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('exports SEARCH_FILES_LIMIT = 500', () => {
    expect(SEARCH_FILES_LIMIT).toBe(500);
  });
});
