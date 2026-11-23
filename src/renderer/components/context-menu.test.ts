// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideContextMenu, isSeparator, showContextMenu } from './context-menu.js';
import { fileTreeMenu } from './file-tree-menu.js';

function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.board-context-menu-item'));
}

afterEach(() => {
  hideContextMenu();
  document.body.innerHTML = '';
});

describe('showContextMenu', () => {
  it('renders a separator as a rule, not as a clickable row', () => {
    const action = vi.fn();
    showContextMenu(10, 10, [
      { label: 'Copy Path', action },
      { separator: true },
      { label: 'Delete', action, danger: true },
    ]);

    expect(items().map((el) => el.textContent)).toEqual(['Copy Path', 'Delete']);
    expect(document.querySelectorAll('.board-context-menu-separator')).toHaveLength(1);
  });

  it('places the rule between the two rows it separates', () => {
    showContextMenu(10, 10, [
      { label: 'A', action: () => {} },
      { separator: true },
      { label: 'B', action: () => {} },
    ]);

    const children = Array.from(document.querySelector('.board-context-menu')!.children);
    expect(children.map((el) => el.className)).toEqual([
      'board-context-menu-item',
      'board-context-menu-separator',
      'board-context-menu-item',
    ]);
  });

  it('renders the real file-tree menu with one danger row and four rules', () => {
    const entries = fileTreeMenu({ isDirectory: true }).map((entry) =>
      'separator' in entry ? entry : { ...entry, action: () => {} },
    );
    showContextMenu(10, 10, entries);

    expect(items().map((el) => el.textContent)).toEqual([
      'New File…', 'New Folder…',
      'Reveal in File Explorer', 'Copy Path', 'Copy Relative Path',
      'Rename…',
      'Delete',
      'Properties',
    ]);
    expect(document.querySelectorAll('.board-context-menu-item.danger')).toHaveLength(1);
    expect(document.querySelectorAll('.board-context-menu-separator')).toHaveLength(4);
  });

  it('runs the action and closes the menu on click', () => {
    const action = vi.fn();
    showContextMenu(10, 10, [{ label: 'Reveal', action }]);

    items()[0].click();

    expect(action).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.board-context-menu')).toBeNull();
  });

  it('does not run a disabled row', () => {
    const action = vi.fn();
    showContextMenu(10, 10, [{ label: 'Reveal', action, disabled: true }]);

    items()[0].click();

    expect(action).not.toHaveBeenCalled();
  });
});

describe('isSeparator', () => {
  it('distinguishes a rule from an action that happens to lack a label check', () => {
    expect(isSeparator({ separator: true })).toBe(true);
    expect(isSeparator({ label: 'Open', action: () => {} })).toBe(false);
  });
});
