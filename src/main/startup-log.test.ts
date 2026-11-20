import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('fs');
vi.mock('os');

import {
  _resetStartupLogMarksForTesting,
  computeBlackScreenMs,
  markValue,
  recordStartupMark,
  writeStartupReport,
} from './startup-log';

beforeEach(() => {
  vi.mocked(os.homedir).mockReturnValue(path.join('/home', 'u'));
  vi.mocked(fs.readFileSync).mockImplementation(() => {
    throw new Error('ENOENT');
  });
  vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as unknown as string);
  vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  _resetStartupLogMarksForTesting();
});

afterEach(() => {
  vi.clearAllMocks();
});

const written = (): string => vi.mocked(fs.writeFileSync).mock.calls.at(-1)![1] as string;

describe('startup log', () => {
  it('records marks and reads them back', () => {
    recordStartupMark('main:window-created', 243.7);
    expect(markValue('main:window-created')).toBe(244);
    expect(markValue('nope')).toBeUndefined();
  });

  it('writes one block per launch with main marks and paint timings', () => {
    recordStartupMark('main:window-created', 240);
    writeStartupReport({ fcp: 350, fp: 340, timeOrigin: Date.now(), marks: [['renderer:ready', 320]] }, {
      version: '0.0.1',
      compositing: 'software',
    });
    const text = written();
    expect(text).toContain('main:window-created=240');
    expect(text).toContain('first-paint=340ms first-content=350ms');
    expect(text).toContain('renderer:ready=320');
    expect(text).toContain('compositing software');
    expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('/home', 'u', '.rcode', 'startup.log'), text);
  });

  it('reports window-shown → first-paint when both clocks can be aligned', () => {
    const processStart = 1_000_000;
    recordStartupMark('main:window-created', 200);
    // Page starts 500ms after the process, paints 300ms after that.
    writeStartupReport({ fcp: 300, timeOrigin: processStart + 500, marks: [] }, {}, processStart);
    const black = Number(/black\s+(\d+)ms/.exec(written())?.[1]);
    expect(black).toBe(600); // 500 + 300 - 200
  });

  it('returns undefined when a clock is missing', () => {
    expect(computeBlackScreenMs(undefined, 300, 1000, 0)).toBeUndefined();
    expect(computeBlackScreenMs(200, undefined, 1000, 0)).toBeUndefined();
    expect(computeBlackScreenMs(200, 300, undefined, 0)).toBeUndefined();
  });

  it('trims old blocks instead of growing forever', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(('---' + String.fromCharCode(10) + 'x'.repeat(40 * 1024)) as unknown as string);
    recordStartupMark('main:window-created', 200);
    writeStartupReport({ fcp: 300, timeOrigin: Date.now() }, {});
    expect(written().length).toBeLessThan(40 * 1024);
  });

  it('never throws when the log cannot be written', () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(() => writeStartupReport({ fcp: 300 }, {})).not.toThrow();
  });
});
