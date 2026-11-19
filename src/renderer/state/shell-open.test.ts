import { describe, it, expect } from 'vitest';
import { planShellOpen, findProjectForDirectory } from './shell-open.js';
import type { ProjectRecord } from '../../shared/types.js';

// Built from char codes so the test file contains no literal backslashes.
const BS = String.fromCharCode(92);
const win = (...segments: string[]): string => segments.join(BS);

function project(id: string, path: string): ProjectRecord {
  return {
    id,
    name: id,
    path,
    sessions: [],
    activeSessionId: null,
    layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
  };
}

describe('planShellOpen', () => {
  it('uses a folder as the project directory', () => {
    expect(planShellOpen(win('E:', 'Project', 'QIS'), true)).toEqual({
      directory: 'E:/Project/QIS',
      name: 'QIS',
    });
  });

  it('strips a trailing separator and the quotes a registry command line adds', () => {
    const quoted = `"${win('E:', 'Project', 'QIS')}${BS}"`;
    expect(planShellOpen(quoted, true)).toEqual({
      directory: 'E:/Project/QIS',
      name: 'QIS',
    });
  });

  it('derives the directory for a file and keeps the file', () => {
    expect(planShellOpen(win('E:', 'Project', 'QIS', 'main.ts'), false)).toEqual({
      directory: 'E:/Project/QIS',
      file: 'E:/Project/QIS/main.ts',
      name: 'QIS',
    });
  });

  it('rejects empty or root-only input', () => {
    expect(planShellOpen('', true)).toBeNull();
    expect(planShellOpen('   ', false)).toBeNull();
  });
});

describe('findProjectForDirectory', () => {
  const projects = [project('a', win('E:', 'Project', 'QIS')), project('b', '/home/dev/app')];

  it('matches a stored Windows path regardless of separator style or case', () => {
    expect(findProjectForDirectory(projects, 'E:/Project/QIS')?.id).toBe('a');
    expect(findProjectForDirectory(projects, win('e:', 'project', 'qis'))?.id).toBe('a');
    expect(findProjectForDirectory(projects, win('E:', 'Project', 'QIS') + BS)?.id).toBe('a');
  });

  it('matches a POSIX path exactly', () => {
    expect(findProjectForDirectory(projects, '/home/dev/app')?.id).toBe('b');
  });

  it('returns undefined for an unknown directory', () => {
    expect(findProjectForDirectory(projects, 'E:/Project/other')).toBeUndefined();
  });
});
