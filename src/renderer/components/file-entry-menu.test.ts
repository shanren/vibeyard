import { beforeEach, describe, expect, it, vi } from 'vitest';

const showModalMock = vi.fn();
const showConfirmModalMock = vi.fn();
const showConfirmDialogMock = vi.fn();
const showPropertiesDialogMock = vi.fn();

vi.mock('./modal.js', () => ({
  showModal: (...args: unknown[]) => showModalMock(...args),
  showConfirmModal: (...args: unknown[]) => showConfirmModalMock(...args),
  showConfirmDialog: (...args: unknown[]) => showConfirmDialogMock(...args),
  showPropertiesDialog: (...args: unknown[]) => showPropertiesDialogMock(...args),
}));

import { entryMenuHandlers, fileEntryMenu } from './file-entry-menu.js';

const revealItemMock = vi.fn(() => Promise.resolve({ ok: true }));
const openInFolderMock = vi.fn(() => Promise.resolve({ ok: true }));
const renamePathMock = vi.fn(() => Promise.resolve({ ok: true }));
const trashItemMock = vi.fn(() => Promise.resolve({ ok: true }));
const clipboardWriteMock = vi.fn(() => Promise.resolve());

const file = { name: 'a.ts', path: '/proj/src/a.ts', isDirectory: false };

function ctx(overrides: { onMutated?: () => void } = {}) {
  return { projectPath: '/proj', ...overrides };
}

/** Run the submit callback the menu handed to showModal, as the modal would. */
async function submitModal(values: Record<string, string>): Promise<void> {
  const onSubmit = showModalMock.mock.calls.at(-1)?.[2] as (v: Record<string, string>) => Promise<void>;
  await onSubmit(values);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    rcode: {
      fs: {
        revealItem: revealItemMock,
        openInFolder: openInFolderMock,
        renamePath: renamePathMock,
        trashItem: trashItemMock,
      },
      clipboard: { write: clipboardWriteMock },
    },
  });
});

describe('fileEntryMenu', () => {
  it('offers the file menu (no folder creation rows) for a search result', () => {
    const ids = fileEntryMenu(ctx(), file).map((e) => ('separator' in e ? '---' : e.label));
    expect(ids).toEqual([
      'Open',
      'Reveal in File Explorer',
      '---',
      'Copy Path',
      'Copy Relative Path',
      '---',
      'Rename…',
      '---',
      'Delete',
      '---',
      'Properties',
    ]);
  });
});

describe('entryMenuHandlers', () => {
  it('opens the file with the OS default app', async () => {
    entryMenuHandlers(ctx(), file).open();
    expect(openInFolderMock).toHaveBeenCalledWith('/proj/src/a.ts');
  });

  it('reveals the entry in Explorer/Finder', async () => {
    entryMenuHandlers(ctx(), file).reveal();
    expect(revealItemMock).toHaveBeenCalledWith('/proj/src/a.ts');
  });

  it('copies the absolute path and the project-relative path separately', () => {
    const handlers = entryMenuHandlers(ctx(), file);
    handlers.copyPath();
    expect(clipboardWriteMock).toHaveBeenLastCalledWith('/proj/src/a.ts');
    handlers.copyRelativePath();
    expect(clipboardWriteMock).toHaveBeenLastCalledWith('src/a.ts');
  });

  it('reports a failed reveal instead of rejecting', () => {
    revealItemMock.mockReturnValueOnce(Promise.resolve({ ok: false, error: 'Path no longer exists' }));
    expect(() => entryMenuHandlers(ctx(), file).reveal()).not.toThrow();
  });
});

describe('mutations notify the caller', () => {
  it('runs onMutated after a successful rename', async () => {
    const onMutated = vi.fn();
    entryMenuHandlers(ctx({ onMutated }), file).rename();
    await submitModal({ name: 'b.ts' });
    expect(renamePathMock).toHaveBeenCalledWith('/proj/src/a.ts', 'b.ts');
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the rename fails', async () => {
    const onMutated = vi.fn();
    renamePathMock.mockReturnValueOnce(Promise.resolve({ ok: false, error: 'denied' }));
    entryMenuHandlers(ctx({ onMutated }), file).rename();
    await submitModal({ name: 'b.ts' });
    expect(showConfirmDialogMock).toHaveBeenCalledWith('Rename', 'denied', expect.anything());
    expect(onMutated).not.toHaveBeenCalled();
  });

  it('does nothing when the name is unchanged', async () => {
    const onMutated = vi.fn();
    entryMenuHandlers(ctx({ onMutated }), file).rename();
    await submitModal({ name: 'a.ts' });
    expect(renamePathMock).not.toHaveBeenCalled();
    expect(onMutated).not.toHaveBeenCalled();
  });

  it('runs onMutated after a confirmed delete', async () => {
    const onMutated = vi.fn();
    entryMenuHandlers(ctx({ onMutated }), file).delete();
    const onConfirm = showConfirmModalMock.mock.calls.at(-1)?.[2] as () => Promise<void>;
    await onConfirm();
    expect(trashItemMock).toHaveBeenCalledWith('/proj/src/a.ts');
    expect(onMutated).toHaveBeenCalledTimes(1);
  });
});
