import { describe, expect, it } from 'vitest';
import type { IBuffer } from '@xterm/xterm';
import {
  computeImePlacement,
  findBlockCaretAnchor,
  measureCells,
  resolveImeAnchor,
  type CellMetrics,
} from './terminal-ime.js';

/** Minimal IBufferCell: a 1-wide cell holding `chars`, inverted when `inverse`. */
function cell(chars: string, inverse = false) {
  return { getChars: () => chars, getWidth: () => 1, isInverse: () => (inverse ? 1 : 0) };
}

/** A buffer line of `text`, with the cell at each index in `inverseAt` drawn inverted. */
function line(text: string, inverseAt: number[] = []) {
  const cells = [...text].map((ch, i) => cell(ch === ' ' ? '' : ch, inverseAt.includes(i)));
  return {
    length: cells.length,
    getCell: (column: number) => cells[column],
  };
}

function buffer(lines: ReturnType<typeof line>[], cursor: { row: number; column: number }): IBuffer {
  return {
    baseY: 0,
    cursorY: cursor.row,
    cursorX: cursor.column,
    getLine: (row: number) => lines[row],
  } as unknown as IBuffer;
}

const CELLS: CellMetrics = { cellWidth: 7, cellHeight: 15, cols: 100, rows: 30 };

describe('findBlockCaretAnchor', () => {
  it('finds the block caret a TUI drew after its prompt text', () => {
    // pi paints `ESC[7m` + space as its caret; its real cursor is parked at the far right.
    const buf = buffer(
      [line('────────────────────────'), line('hey ', [3]), line('────────────────────────'), line('> ready')],
      { row: 3, column: 99 },
    );
    expect(findBlockCaretAnchor(buf, 4, 100)).toEqual({ row: 1, column: 3 });
  });

  it('prefers the bottom-most block caret', () => {
    const buf = buffer([line('a ', [1]), line('b ', [1])], { row: 0, column: 0 });
    expect(findBlockCaretAnchor(buf, 2, 100)).toEqual({ row: 1, column: 1 });
  });

  it('ignores inverted text: a highlighted label is not a caret', () => {
    const buf = buffer([line('accept edits', [0, 1, 2, 3])], { row: 0, column: 0 });
    expect(findBlockCaretAnchor(buf, 1, 100)).toBeNull();
  });

  it('ignores blank cells past the end of the line and empty rows', () => {
    const buf = buffer([line(''), line('   ')], { row: 0, column: 0 });
    expect(findBlockCaretAnchor(buf, 2, 100)).toBeNull();
  });

  it('skips the trailing blank half of a wide character', () => {
    const wide = {
      length: 3,
      getCell: (column: number) =>
        column === 0
          ? cell('你')
          : column === 1
            ? { getChars: () => '', getWidth: () => 0, isInverse: () => 0 }
            : cell('', true),
    };
    const buf = buffer([wide], { row: 0, column: 0 });
    expect(findBlockCaretAnchor(buf, 1, 100)).toEqual({ row: 0, column: 2 });
  });
});

describe('resolveImeAnchor', () => {
  it('anchors on the terminal cursor when no block caret exists', () => {
    const buf = buffer([line('$ ')], { row: 0, column: 2 });
    expect(resolveImeAnchor(buf, 30, 100)).toEqual({ row: 0, column: 2 });
  });

  it('clamps a cursor parked outside the viewport', () => {
    const buf = buffer([line('x')], { row: 42, column: 197 });
    expect(resolveImeAnchor(buf, 30, 100)).toEqual({ row: 29, column: 99 });
  });

  it('prefers the drawn caret over the parked cursor', () => {
    const buf = buffer([line('> hey ', [5]), line('status')], { row: 1, column: 99 });
    expect(resolveImeAnchor(buf, 2, 100)).toEqual({ row: 0, column: 5 });
  });
});

describe('computeImePlacement', () => {
  it('leaves the whole run to the right edge for the pre-edit', () => {
    const placement = computeImePlacement({ row: 4, column: 2 }, CELLS);
    expect(placement).toEqual({
      left: 14,
      top: 60,
      width: 7,
      height: 15,
      // Anchoring on a parked cursor at column 99 left 7px here, which clipped the
      // pinyin to a sliver; anchoring on the caret leaves the rest of the row.
      maxWidth: 686,
    });
  });

  it('never starves the pre-edit of width at the last column', () => {
    const placement = computeImePlacement({ row: 0, column: 99 }, CELLS);
    expect(placement.maxWidth).toBeGreaterThanOrEqual(CELLS.cellWidth);
  });
});

describe('measureCells', () => {
  it('derives cell size from the rendered screen box', () => {
    expect(measureCells({ width: 700, height: 450 }, 100, 30)).toEqual({
      cellWidth: 7,
      cellHeight: 15,
      cols: 100,
      rows: 30,
    });
  });

  it('reports nothing for a hidden pane, whose box has no size', () => {
    expect(measureCells({ width: 0, height: 0 }, 100, 30)).toBeNull();
  });
});
