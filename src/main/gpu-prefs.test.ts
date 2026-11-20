import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('fs');
vi.mock('os');

import { readGpuPrefs, shouldUseSoftwareCompositing, writeGpuPrefs, GPU_RETRY_INTERVAL_MS } from './gpu-prefs';

afterEach(() => {
  vi.clearAllMocks();
});

describe('shouldUseSoftwareCompositing', () => {
  it('is false when nothing was decided', () => {
    expect(shouldUseSoftwareCompositing({})).toBe(false);
    expect(shouldUseSoftwareCompositing({ softwareCompositing: false })).toBe(false);
  });

  it('is true for a recent software verdict', () => {
    const now = 1_700_000_000_000;
    expect(shouldUseSoftwareCompositing({ softwareCompositing: true, decidedAt: now - 1000 }, now)).toBe(true);
  });

  it('re-tests GPU once the verdict is old enough', () => {
    const now = 1_700_000_000_000;
    const stale = now - GPU_RETRY_INTERVAL_MS - 1;
    expect(shouldUseSoftwareCompositing({ softwareCompositing: true, decidedAt: stale }, now)).toBe(false);
  });

  it('honours a verdict written before decidedAt existed', () => {
    expect(shouldUseSoftwareCompositing({ softwareCompositing: true })).toBe(true);
  });
});

describe('readGpuPrefs / writeGpuPrefs', () => {
  it('returns empty prefs when the file is missing or unreadable', () => {
    vi.mocked(os.homedir).mockReturnValue(path.join('/home', 'u'));
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readGpuPrefs()).toEqual({});
  });

  it('reads persisted prefs', () => {
    vi.mocked(os.homedir).mockReturnValue(path.join('/home', 'u'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ softwareCompositing: true }) as unknown as string);
    expect(readGpuPrefs()).toEqual({ softwareCompositing: true });
  });

  it('writes into the rcode home and never throws', () => {
    vi.mocked(os.homedir).mockReturnValue(path.join('/home', 'u'));
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as unknown as string);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    writeGpuPrefs({ softwareCompositing: true, observedFirstPaintMs: 3200 });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join('/home', 'u', '.rcode', 'gpu.json'),
      expect.stringContaining('"softwareCompositing": true'),
    );
  });

  it('swallows write failures', () => {
    vi.mocked(os.homedir).mockReturnValue(path.join('/home', 'u'));
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(() => writeGpuPrefs({ softwareCompositing: true })).not.toThrow();
  });
});
