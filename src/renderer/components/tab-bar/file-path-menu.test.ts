import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting, setLocale } from '../../i18n.js';
import { runTabFilePathAction, tabFilePath, tabFilePathMenuItems } from './file-path-menu.js';

const openInFolderMock = vi.fn(() => Promise.resolve({ ok: true }));
const revealItemMock = vi.fn(() => Promise.resolve({ ok: true }));
const clipboardWriteMock = vi.fn(() => Promise.resolve());
const clipboardRejectMock = vi.fn(() => Promise.reject(new Error('denied')));

beforeEach(() => {
  _resetForTesting();
  setLocale('en');
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    rcode: {
      fs: { openInFolder: openInFolderMock, revealItem: revealItemMock },
      clipboard: { write: clipboardWriteMock },
    },
  });
});

afterEach(() => {
  _resetForTesting();
});

describe('tabFilePathMenuItems', () => {
  it('offers open, reveal and copy in the file tree order', () => {
    expect(tabFilePathMenuItems().map((i) => i.id)).toEqual(['open', 'reveal', 'copy']);
    expect(tabFilePathMenuItems().map((i) => i.label)).toEqual([
      'Open File',
      'Reveal in File Explorer',
      'Copy File Path',
    ]);
  });

  it('is translated', () => {
    setLocale('zh-CN');
    expect(tabFilePathMenuItems().map((i) => i.label)).toEqual([
      '打开文件',
      '在资源管理器中显示',
      '复制文件路径',
    ]);
  });
});

describe('runTabFilePathAction', () => {
  it('opens the file with the OS default app', () => {
    runTabFilePathAction('open', '/proj/src/a.ts');
    expect(openInFolderMock).toHaveBeenCalledWith('/proj/src/a.ts');
    expect(revealItemMock).not.toHaveBeenCalled();
  });

  it('reveals the file in Explorer/Finder', () => {
    runTabFilePathAction('reveal', '/proj/src/a.ts');
    expect(revealItemMock).toHaveBeenCalledWith('/proj/src/a.ts');
    expect(openInFolderMock).not.toHaveBeenCalled();
  });

  it('copies the path', () => {
    runTabFilePathAction('copy', '/proj/src/a.ts');
    expect(clipboardWriteMock).toHaveBeenCalledWith('/proj/src/a.ts');
  });

  it('swallows a clipboard rejection instead of raising an unhandled rejection', async () => {
    vi.stubGlobal('window', {
      rcode: {
        fs: { openInFolder: openInFolderMock, revealItem: revealItemMock },
        clipboard: { write: clipboardRejectMock },
      },
    });
    expect(() => runTabFilePathAction('copy', '/proj/src/a.ts')).not.toThrow();
    await Promise.resolve();
    expect(clipboardRejectMock).toHaveBeenCalledWith('/proj/src/a.ts');
  });
});
describe('tabFilePath', () => {
  it('is empty for a CLI session, so the menu omits the path group', () => {
    expect(tabFilePath({}, '/proj')).toBe('');
  });

  it('passes a file reader path through (it is stored absolute)', () => {
    expect(tabFilePath({ fileReaderPath: '/proj/src/a.ts' }, '/proj')).toBe('/proj/src/a.ts');
  });

  it('anchors a repo-relative diff path to the project root', () => {
    expect(tabFilePath({ diffFilePath: 'src/a.ts' }, '/proj')).toBe('/proj/src/a.ts');
  });

  it('anchors it to the session worktree when the diff came from one', () => {
    expect(tabFilePath({ diffFilePath: 'src/a.ts', worktreePath: '/proj/.worktrees/fix' }, '/proj'))
      .toBe('/proj/.worktrees/fix/src/a.ts');
  });
});
