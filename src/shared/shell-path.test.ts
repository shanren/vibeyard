import { describe, it, expect } from 'vitest';
import { isPathUnder, normalizeShellPath, samePath } from './platform';

// Paths are assembled from char codes so this file contains no literal
// backslashes (which are painful to keep intact through every layer).
const BS = String.fromCharCode(92);
const win = (...segments: string[]): string => segments.join(BS);

const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

describe('normalizeShellPath', () => {
  it('strips the quotes a registry command line leaves behind', () => {
    expect(normalizeShellPath(`"${win('E:', 'Project', 'QIS')}"`)).toBe('E:/Project/QIS');
  });

  it('drops trailing separators but keeps drive roots', () => {
    expect(normalizeShellPath(win('E:', 'Project', 'QIS') + BS)).toBe('E:/Project/QIS');
    expect(normalizeShellPath('E:/')).toBe('E:/');
  });

  it('upper-cases a Windows drive letter', () => {
    expect(normalizeShellPath('e:/project')).toBe('E:/project');
  });
});

describe('samePath on shell input', () => {
  it('ignores separator style and a trailing separator', () => {
    expect(samePath(win('E:', 'Project', 'QIS'), 'E:/Project/QIS')).toBe(true);
    expect(samePath(win('E:', 'Project', 'QIS') + BS, 'E:/Project/QIS')).toBe(true);
  });

  it('is case-insensitive only where the filesystem is', () => {
    expect(samePath(win('e:', 'project', 'qis'), 'E:/Project/QIS')).toBe(isCaseInsensitive);
  });
});

describe('isPathUnder with mixed separators', () => {
  it('accepts a native child under a forward-slash parent', () => {
    const child = normalizeShellPath(win('E:', 'Proj', 'src', 'a.ts'));
    const parent = normalizeShellPath('E:/Proj');
    expect(isPathUnder(child, parent)).toBe(true);
  });

  it('rejects a sibling that shares a name prefix', () => {
    expect(isPathUnder(normalizeShellPath('E:/Proj2/a.ts'), normalizeShellPath('E:/Proj'))).toBe(false);
  });
});
