import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IBufferLine, ILink, Terminal } from '@xterm/xterm';

const appStateMock = vi.hoisted(() => ({
  projects: [{ id: 'p1', path: '/proj' }],
  addFileReaderSession: vi.fn(),
}));
vi.mock('../state.js', () => ({ appState: appStateMock }));

import {
  FilePathLinkProvider,
  _resetLinkStatCache,
  findFileLinkCandidates,
  lineTextToColumns,
  resolveLinkTarget,
} from './terminal-link-provider.js';

const statMock = vi.fn();
const isDirectoryMock = vi.fn();
vi.stubGlobal('window', {
  rcode: { fs: { stat: statMock, isDirectory: isDirectoryMock, openInFolder: vi.fn() } },
});

/** A buffer line where every character is one cell wide. */
function asciiLine(text: string): IBufferLine {
  return {
    length: text.length,
    getCell: (col: number) => ({
      getChars: () => text[col] ?? '',
      getWidth: () => 1,
    }),
  } as unknown as IBufferLine;
}

/** A buffer line whose characters can span several cells (CJK). */
function wideLine(cells: Array<[chars: string, width: number]>): IBufferLine {
  const flat = cells.flatMap(([chars, width]) => (width === 2 ? [[chars, 2], ['', 0]] : [[chars, width]]));
  return {
    length: flat.length,
    getCell: (col: number) => {
      const cell = flat[col];
      if (!cell) return undefined;
      return { getChars: () => cell[0], getWidth: () => cell[1] };
    },
  } as unknown as IBufferLine;
}

function terminalWithLine(
  line: IBufferLine,
  opts: { hasSelection?: boolean; mouseTrackingMode?: string } = {},
): Terminal {
  return {
    buffer: { active: { getLine: () => line } },
    hasSelection: () => opts.hasSelection ?? false,
    modes: { mouseTrackingMode: opts.mouseTrackingMode ?? 'none' },
  } as unknown as Terminal;
}

function click(options: { ctrlKey?: boolean; metaKey?: boolean }): MouseEvent {
  return options as unknown as MouseEvent;
}

function collectLinks(
  line: IBufferLine,
  termDir = '/proj',
  opts: { hasSelection?: boolean; mouseTrackingMode?: string } = {},
): Promise<ILink[] | undefined> {
  return new Promise((resolve) => {
    new FilePathLinkProvider('p1', termDir, terminalWithLine(line, opts)).provideLinks(1, resolve);
  });
}

describe('findFileLinkCandidates', () => {
  it('finds a relative path with a line and column', () => {
    const [candidate] = findFileLinkCandidates('  at src/renderer/state.ts:42:7');
    expect(candidate).toMatchObject({
      rawPath: 'src/renderer/state.ts',
      line: 42,
      column: 7,
      text: 'src/renderer/state.ts:42:7',
    });
    expect(candidate.start).toBe(5);
  });

  it('finds Windows paths with backslashes and a drive letter', () => {
    const [candidate] = findFileLinkCandidates('error TS1005: C:\\repo\\src\\a.ts:12');
    expect(candidate.rawPath).toBe('C:\\repo\\src\\a.ts');
    expect(candidate.line).toBe(12);
  });

  it('finds absolute POSIX paths', () => {
    const [candidate] = findFileLinkCandidates('/home/me/proj/src/a.ts:3');
    expect(candidate.rawPath).toBe('/home/me/proj/src/a.ts');
    expect(candidate.line).toBe(3);
  });

  it('trims sentence punctuation that hugs the path', () => {
    const [candidate] = findFileLinkCandidates('see (src/a.ts), then stop.');
    expect(candidate.text).toBe('src/a.ts');
    expect(candidate.rawPath).toBe('src/a.ts');
  });

  it('links an unqualified name only when it carries a line number', () => {
    expect(findFileLinkCandidates('state.ts:12')).toHaveLength(1);
    expect(findFileLinkCandidates('Node.js v20 and v1.2.3')).toHaveLength(0);
  });

  it('ignores paths inside URLs — those are web links', () => {
    expect(findFileLinkCandidates('https://example.com/repo/src/a.ts')).toHaveLength(0);
  });

  it('finds several paths on one line', () => {
    const candidates = findFileLinkCandidates('moved src/a.ts -> src/b.ts');
    expect(candidates.map((c) => c.rawPath)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('resolveLinkTarget', () => {
  it('joins a relative path onto the terminal directory', () => {
    expect(resolveLinkTarget('src/a.ts', '/proj')).toBe('/proj/src/a.ts');
  });

  it('collapses ./ and ../ segments', () => {
    expect(resolveLinkTarget('./src/../lib/a.ts', '/proj')).toBe('/proj/lib/a.ts');
    expect(resolveLinkTarget('../other/a.ts', '/proj')).toBe('/other/a.ts');
  });

  it('keeps a relative path relative when it climbs above an empty base', () => {
    expect(resolveLinkTarget('../a.ts', '')).toBe('../a.ts');
  });

  it('normalises Windows separators and drive case', () => {
    expect(resolveLinkTarget('src\\a.ts', 'E:\\workspace\\proj')).toBe('E:/workspace/proj/src/a.ts');
    expect(resolveLinkTarget('e:/workspace/a.ts', 'E:\\workspace\\proj')).toBe('E:/workspace/a.ts');
  });

  it('passes absolute POSIX paths through untouched', () => {
    expect(resolveLinkTarget('/opt/x/a.ts', '/proj')).toBe('/opt/x/a.ts');
  });

  it('never climbs above the root', () => {
    expect(resolveLinkTarget('../../../a.ts', '/proj')).toBe('/a.ts');
  });
});

describe('lineTextToColumns', () => {
  it('counts a wide character as two columns', () => {
    // "中文 src" — each CJK glyph is 2 cells, so 's' is character 3 but cell 5.
    const { text, startColumns } = lineTextToColumns(
      wideLine([['中', 2], ['文', 2], [' ', 1], ['s', 1], ['r', 1], ['c', 1]]),
    );
    expect(text).toBe('中文 src');
    expect(startColumns[0]).toBe(0);
    expect(startColumns[3]).toBe(5);
  });
});

describe('FilePathLinkProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLinkStatCache();
    statMock.mockResolvedValue({ ok: true, size: 10, mtimeMs: 1 });
    isDirectoryMock.mockResolvedValue(false);
  });

  afterEach(() => {
    _resetLinkStatCache();
  });

  it('exposes only paths that exist', async () => {
    statMock.mockImplementation(async (p: string) =>
      p.endsWith('/proj/src/a.ts') ? { ok: true, size: 10, mtimeMs: 1 } : { ok: false },
    );
    const links = await collectLinks(asciiLine('open src/a.ts and src/missing.ts'));
    expect(links?.map((l) => l.text)).toEqual(['src/a.ts']);
  });

  it('rejects directories', async () => {
    isDirectoryMock.mockResolvedValue(true);
    expect(await collectLinks(asciiLine('see src/renderer for details'))).toBeUndefined();
  });

  it('opens the file reader at the printed line on Ctrl+click', async () => {
    const links = await collectLinks(asciiLine('at src/a.ts:42'));
    expect(links).toHaveLength(1);
    links![0].activate(click({ ctrlKey: true }), links![0].text);
    expect(appStateMock.addFileReaderSession).toHaveBeenCalledWith('p1', '/proj/src/a.ts', 42);
  });

  it('opens the file reader on Cmd+click (macOS)', async () => {
    const links = await collectLinks(asciiLine('at src/a.ts'));
    links![0].activate(click({ metaKey: true }), links![0].text);
    expect(appStateMock.addFileReaderSession).toHaveBeenCalledWith('p1', '/proj/src/a.ts', undefined);
  });

  it('opens on a plain click — that is the gesture people reach for', async () => {
    const links = await collectLinks(asciiLine('at src/a.ts:7'));
    links![0].activate(click({}), links![0].text);
    expect(appStateMock.addFileReaderSession).toHaveBeenCalledWith('p1', '/proj/src/a.ts', 7);
  });

  it('ignores a click that ended a text selection', async () => {
    const links = await collectLinks(asciiLine('at src/a.ts'), '/proj', { hasSelection: true });
    links![0].activate(click({}), links![0].text);
    expect(appStateMock.addFileReaderSession).not.toHaveBeenCalled();
  });

  it('ignores a plain click while a TUI owns mouse events', async () => {
    const links = await collectLinks(asciiLine('at src/a.ts'), '/proj', { mouseTrackingMode: 'any' });
    links![0].activate(click({}), links![0].text);
    expect(appStateMock.addFileReaderSession).not.toHaveBeenCalled();
  });

  it('still opens with Ctrl inside a mouse-tracking TUI', async () => {
    const links = await collectLinks(asciiLine('at src/a.ts:5'), '/proj', { mouseTrackingMode: 'any' });
    links![0].activate(click({ ctrlKey: true }), links![0].text);
    expect(appStateMock.addFileReaderSession).toHaveBeenCalledWith('p1', '/proj/src/a.ts', 5);
  });

  it('hands paths outside the project to the OS', async () => {
    const links = await collectLinks(asciiLine('at /elsewhere/b.ts'), '/proj');
    links![0].activate(click({ ctrlKey: true }), links![0].text);
    expect(appStateMock.addFileReaderSession).not.toHaveBeenCalled();
    expect(window.rcode.fs.openInFolder).toHaveBeenCalledWith('/elsewhere/b.ts');
  });

  it('maps the link range onto buffer columns around wide characters', async () => {
    // "中 src/a.ts": the path starts at character 2 but at cell 3 (1-based x=4).
    const cells: Array<[string, number]> = [['中', 2], [' ', 1], ...('src/a.ts'.split('').map((c) => [c, 1] as [string, number]))];
    const links = await collectLinks(wideLine(cells));
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe('src/a.ts');
    expect(links![0].range.start).toEqual({ x: 4, y: 1 });
    expect(links![0].range.end).toEqual({ x: 11, y: 1 });
  });

  it('reuses the stat result for repeated hovers', async () => {
    const line = asciiLine('at src/a.ts');
    await collectLinks(line);
    await collectLinks(line);
    expect(statMock).toHaveBeenCalledTimes(1);
  });
});
