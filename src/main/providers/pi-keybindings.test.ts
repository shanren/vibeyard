import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let fakeHome = '';
vi.mock('os', async (importOriginal) => ({ ...(await importOriginal<typeof import('os')>()), homedir: () => fakeHome }));

import { ensurePiLineScrollBindings, keybindingsPath } from './pi-keybindings';

const FILE = (): string => path.join(fakeHome, '.pi', 'agent', 'keybindings.json');

function write(content: string): void {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), content);
}

function read(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rcode-pi-kb-'));
});

afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('pi line-scroll bindings', () => {
  it('resolves to the agent directory', () => {
    expect(keybindingsPath()).toBe(path.join(fakeHome, '.pi', 'agent', 'keybindings.json'));
  });

  it('creates the file with lineUp/lineDown when none exists', () => {
    expect(ensurePiLineScrollBindings()).toBe(true);
    expect(read()).toEqual({
      'tui.altScreen.lineUp': ['shift+up'],
      'tui.altScreen.lineDown': ['shift+down'],
    });
  });

  it('preserves bindings the user already set', () => {
    write(JSON.stringify({ 'tui.altScreen.lineUp': ['ctrl+y'], 'app.quit': ['ctrl+q'] }));

    expect(ensurePiLineScrollBindings()).toBe(true);

    const bindings = read();
    expect(bindings['tui.altScreen.lineUp']).toEqual(['ctrl+y']);
    expect(bindings['tui.altScreen.lineDown']).toEqual(['shift+down']);
    expect(bindings['app.quit']).toEqual(['ctrl+q']);
  });

  it('is idempotent — a second call writes nothing', () => {
    ensurePiLineScrollBindings();
    const before = fs.statSync(FILE()).mtimeMs;

    expect(ensurePiLineScrollBindings()).toBe(false);
    expect(fs.statSync(FILE()).mtimeMs).toBe(before);
  });

  it('leaves an unparseable file untouched', () => {
    write('{ not json');

    expect(ensurePiLineScrollBindings()).toBe(false);
    expect(fs.readFileSync(FILE(), 'utf8')).toBe('{ not json');
  });

  it('never throws when the file cannot be written', () => {
    // Simulate a read-only home without touching the real filesystem.
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.chmodSync(path.dirname(FILE()), 0o500);
    try {
      expect(() => ensurePiLineScrollBindings()).not.toThrow();
    } finally {
      fs.chmodSync(path.dirname(FILE()), 0o700);
    }
  });
});
