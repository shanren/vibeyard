import type { IBuffer, IBufferCell, IBufferLine, IDisposable, Terminal } from '@xterm/xterm';

/** Where the IME pre-edit (and the OS candidate window) should be anchored, in
 *  viewport cells. */
export interface ImeAnchor {
  row: number;
  column: number;
}

/** Terminal cell geometry, measured from `.xterm-screen`. */
export interface CellMetrics {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

/** Pixel placement for the helper textarea / composition view. */
export interface ImePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  maxWidth: number;
}

/**
 * Bottom-most reverse-video blank cell in the viewport, i.e. a block caret a TUI
 * drew for itself (`ESC[7m` + space).
 *
 * Agent TUIs hide the real terminal cursor and keep it wherever their last write
 * ended — pi, for one, parks it at the far right of its input row (or on the
 * status bar below it) while the visible caret sits after the prompt text. xterm
 * anchors the pre-edit to that parked cell, where its own width clamp
 * (`cols * cellWidth - cursorLeft`) leaves about one cell of room, so the pinyin
 * is clipped to a sliver and the candidate window opens ~90 columns away from
 * the caret. Any TUI that draws its own caret has to draw it as a highlighted
 * cell, so the bottom-most inverted blank cell is the best available proxy for
 * "where the user is typing".
 */
export function findBlockCaretAnchor(buffer: IBuffer, rows: number, cols: number): ImeAnchor | null {
  for (let row = rows - 1; row >= 0; row--) {
    const line = buffer.getLine(buffer.baseY + row);
    if (!line) continue;
    const column = findLineBlockCaret(line, cols);
    if (column !== null) return { row, column };
  }
  return null;
}

function findLineBlockCaret(line: IBufferLine, cols: number): number | null {
  for (let column = Math.min(line.length, cols) - 1; column >= 0; column--) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    if (isBlankCell(cell) && cell.isInverse()) return column;
  }
  return null;
}

function isBlankCell(cell: IBufferCell): boolean {
  const chars = cell.getChars();
  return chars === '' || chars === ' ';
}

/** Anchor for the IME: the TUI's drawn caret when there is one, else the terminal cursor. */
export function resolveImeAnchor(buffer: IBuffer, rows: number, cols: number): ImeAnchor {
  const blockCaret = findBlockCaretAnchor(buffer, rows, cols);
  if (blockCaret) return blockCaret;
  return {
    row: clamp(buffer.cursorY, rows - 1),
    column: clamp(buffer.cursorX, cols - 1),
  };
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, Math.max(max, 0)));
}

/**
 * Pixel placement for an anchor, mirroring what xterm's CompositionHelper writes,
 * except that `maxWidth` is measured from the anchor so the pre-edit keeps the
 * whole run to the right edge instead of the one cell a parked cursor leaves.
 */
export function computeImePlacement(anchor: ImeAnchor, cells: CellMetrics): ImePlacement {
  const left = anchor.column * cells.cellWidth;
  const top = anchor.row * cells.cellHeight;
  return {
    left,
    top,
    width: Math.max(cells.cellWidth, 1),
    height: Math.max(cells.cellHeight, 1),
    maxWidth: Math.max(cells.cols * cells.cellWidth - left, cells.cellWidth),
  };
}

/** Cell geometry from the rendered screen box (padding/font/zoom independent). */
export function measureCells(
  screen: Pick<DOMRect, 'width' | 'height'>,
  cols: number,
  rows: number,
): CellMetrics | null {
  const cellWidth = screen.width / cols;
  const cellHeight = screen.height / rows;
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  return { cellWidth, cellHeight, cols, rows };
}

/**
 * Keep the IME pre-edit and the helper textarea on the caret while a composition
 * is in flight.
 *
 * Two things fight this. `compositionstart` is handled by xterm first (bubble
 * order), which syncs the textarea to the terminal cursor; and while composing
 * xterm rewrites both nodes on every render, plus once more from a `setTimeout(0)`
 * it queues after each render. So corrections are applied immediately, again
 * after that timer (coalesced), and once per render for as long as the
 * composition view is active.
 */
export function attachImeAnchor(terminal: Terminal): IDisposable {
  const element = terminal.element;
  const textarea = terminal.textarea;
  const view = element?.querySelector<HTMLElement>('.composition-view') ?? null;
  const screen = element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
  if (!element || !textarea || !screen) {
    return { dispose: () => {} };
  }

  let renderSubscription: IDisposable | null = null;
  let correctionTimer: ReturnType<typeof setTimeout> | null = null;

  const apply = (): void => {
    const cells = measureCells(screen.getBoundingClientRect(), terminal.cols, terminal.rows);
    if (!cells) return;
    const placement = computeImePlacement(
      resolveImeAnchor(terminal.buffer.active, cells.rows, cells.cols),
      cells,
    );
    const left = `${placement.left}px`;
    const top = `${placement.top}px`;
    const height = `${placement.height}px`;

    if (view) {
      view.style.left = left;
      view.style.top = top;
      view.style.height = height;
      view.style.lineHeight = height;
      view.style.maxWidth = `${placement.maxWidth}px`;
      view.style.overflow = 'hidden';
    }

    textarea.style.left = left;
    textarea.style.top = top;
    textarea.style.height = height;
    textarea.style.lineHeight = height;
    // Mirror xterm: the textarea must be wide enough to hold the composing text,
    // otherwise the IME is handed a caret rect that does not cover it.
    const composed = view?.classList.contains('active') ? view.getBoundingClientRect().width : 0;
    textarea.style.width = `${Math.max(composed, placement.width)}px`;
  };

  const scheduleCorrection = (): void => {
    if (correctionTimer !== null) clearTimeout(correctionTimer);
    correctionTimer = setTimeout(() => {
      correctionTimer = null;
      // xterm hid the view (composition ended) while the timer was pending.
      if (view && !view.classList.contains('active')) return;
      apply();
    }, 0);
  };

  const isComposing = (): boolean => view?.classList.contains('active') ?? false;

  const stopFollowingRenders = (): void => {
    renderSubscription?.dispose();
    renderSubscription = null;
    if (correctionTimer !== null) {
      clearTimeout(correctionTimer);
      correctionTimer = null;
    }
  };

  const onComposition = (): void => {
    apply();
    scheduleCorrection();
    renderSubscription ??= terminal.onRender(() => {
      if (!isComposing()) {
        stopFollowingRenders();
        return;
      }
      apply();
      scheduleCorrection();
    });
  };

  element.addEventListener('compositionstart', onComposition);
  element.addEventListener('compositionupdate', onComposition);
  element.addEventListener('compositionend', stopFollowingRenders);

  return {
    dispose: () => {
      element.removeEventListener('compositionstart', onComposition);
      element.removeEventListener('compositionupdate', onComposition);
      element.removeEventListener('compositionend', stopFollowingRenders);
      stopFollowingRenders();
    },
  };
}
