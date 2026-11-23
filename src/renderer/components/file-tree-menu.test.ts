import { describe, expect, it } from 'vitest';
import { fileTreeMenu, menuEntriesFor, toProjectRelative } from './file-tree-menu.js';

describe('fileTreeMenu', () => {
  it('gives a file Open, reveal, copy, rename, delete and properties in VS Code group order', () => {
    const ids = fileTreeMenu({ isDirectory: false }).map((e) => ('separator' in e ? '---' : e.id));
    expect(ids).toEqual([
      'open', 'reveal', '---',
      'copyPath', 'copyRelativePath', '---',
      'rename', '---',
      'delete', '---',
      'properties',
    ]);
  });

  it('replaces Open with New File / New Folder for a folder', () => {
    const ids = fileTreeMenu({ isDirectory: true }).map((e) => ('separator' in e ? '---' : e.id));
    expect(ids.slice(0, 4)).toEqual(['newFile', 'newFolder', '---', 'reveal']);
    expect(ids).not.toContain('open');
  });

  it('renders Delete as the only danger entry, never first or last-but-one of a group', () => {
    for (const entry of [{ isDirectory: true }, { isDirectory: false }]) {
      const entries = fileTreeMenu(entry);
      const dangers = entries.filter((e) => 'danger' in e && e.danger);
      expect(dangers.map((e) => ('id' in e ? e.id : ''))).toEqual(['delete']);
      const labels = entries.map((e) => ('label' in e ? e.label : ''));
      expect(labels[labels.length - 1]).toBe('Properties');
    }
  });

  it('groups every label under a separator instead of one flat list', () => {
    expect(fileTreeMenu({ isDirectory: false }).filter((e) => 'separator' in e)).toHaveLength(4);
  });
});

describe('toProjectRelative', () => {
  it('strips the project root and uses forward slashes', () => {
    expect(toProjectRelative('E:\\work\\proj', 'E:\\work\\proj\\src\\a.ts')).toBe('src/a.ts');
    expect(toProjectRelative('/work/proj', '/work/proj/src/a.ts')).toBe('src/a.ts');
  });

  it('leaves an outside path untouched rather than inventing a relative form', () => {
    expect(toProjectRelative('/work/proj', '/elsewhere/a.ts')).toBe('/elsewhere/a.ts');
  });

  it('returns an empty string for the project root itself', () => {
    expect(toProjectRelative('/work/proj/', '/work/proj')).toBe('');
  });

  it('is not fooled by a sibling whose name shares the prefix', () => {
    expect(toProjectRelative('/work/proj', '/work/proj-2/a.ts')).toBe('/work/proj-2/a.ts');
  });
});

describe('menuEntriesFor', () => {
  it('wires each action id to its handler and keeps the separators', () => {
    const called: string[] = [];
    const handler = (id: string) => () => called.push(id);
    const entries = menuEntriesFor({ isDirectory: false }, {
      open: handler('open'),
      reveal: handler('reveal'),
      copyPath: handler('copyPath'),
      copyRelativePath: handler('copyRelativePath'),
      newFile: handler('newFile'),
      newFolder: handler('newFolder'),
      rename: handler('rename'),
      delete: handler('delete'),
      properties: handler('properties'),
    });

    for (const entry of entries) {
      if (!('separator' in entry)) entry.action();
    }
    expect(called).toEqual([
      'open', 'reveal', 'copyPath', 'copyRelativePath', 'rename', 'delete', 'properties',
    ]);
    expect(entries.filter((e) => 'separator' in e)).toHaveLength(4);
  });
});
