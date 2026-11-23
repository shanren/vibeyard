import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { validateEntryName, resolveRenameTarget } from './fs-ops';

describe('validateEntryName', () => {
  it('accepts ordinary names, including spaced and CJK ones', () => {
    expect(validateEntryName('app.ts')).toEqual({ ok: true, name: 'app.ts' });
    expect(validateEntryName('  my notes.md  ')).toEqual({ ok: true, name: 'my notes.md' });
    expect(validateEntryName('项目结构.md')).toEqual({ ok: true, name: '项目结构.md' });
  });

  it('rejects an empty or dot-only name', () => {
    expect(validateEntryName('   ')).toMatchObject({ ok: false });
    expect(validateEntryName('.')).toMatchObject({ ok: false });
    expect(validateEntryName('..')).toMatchObject({ ok: false });
  });

  it('rejects path separators, so a rename cannot move an entry elsewhere', () => {
    expect(validateEntryName('../escape.ts')).toMatchObject({ ok: false });
    expect(validateEntryName('sub/escape.ts')).toMatchObject({ ok: false });
    expect(validateEntryName('sub\\escape.ts')).toMatchObject({ ok: false });
  });

  it('rejects characters the filesystem refuses and names ending in dot or space', () => {
    expect(validateEntryName('a:b.ts')).toMatchObject({ ok: false });
    expect(validateEntryName('a*b.ts')).toMatchObject({ ok: false });
    expect(validateEntryName('trailing.')).toMatchObject({ ok: false });
    // A trailing space is trimmed rather than rejected: the user gets the name
    // they meant, and the trimmed value is what the caller compares.
    expect(validateEntryName('trailing ')).toEqual({ ok: true, name: 'trailing' });
  });

  it('rejects Windows device names in any case, with or without an extension', () => {
    expect(validateEntryName('con')).toMatchObject({ ok: false });
    expect(validateEntryName('LPT1.txt')).toMatchObject({ ok: false });
    expect(validateEntryName('console.ts')).toMatchObject({ ok: true });
  });

  it('caps the name at 255 bytes of UTF-8', () => {
    expect(validateEntryName('a'.repeat(255))).toMatchObject({ ok: true });
    expect(validateEntryName('a'.repeat(256))).toMatchObject({ ok: false });
    // CJK is 3 bytes per char, so 100 chars already overflows.
    expect(validateEntryName('文'.repeat(100))).toMatchObject({ ok: false });
  });
});

describe('resolveRenameTarget', () => {
  it('returns the sibling path for a valid new name', () => {
    const result = resolveRenameTarget(path.join('/work/proj', 'a.ts'), 'b.ts');
    expect(result).toEqual({ ok: true, target: path.join('/work/proj', 'b.ts') });
  });

  it('refuses a rename that does not change the name', () => {
    expect(resolveRenameTarget(path.join('/work/proj', 'a.ts'), 'a.ts')).toMatchObject({ ok: false });
  });

  it('propagates a name-validation failure', () => {
    expect(resolveRenameTarget(path.join('/work/proj', 'a.ts'), '../b.ts')).toMatchObject({ ok: false });
  });

  it('never produces a path in a different directory', () => {
    const source = path.join('/work/proj', 'src', 'a.ts');
    const result = resolveRenameTarget(source, 'b.ts');
    expect(result.ok && path.dirname(result.target)).toBe(path.dirname(source));
  });
});
