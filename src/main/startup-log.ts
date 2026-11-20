import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Persistent startup diagnostics.
 *
 * "It takes 3-4 seconds to show content" is not reproducible from a description —
 * the interesting window is between the window being shown and the renderer's
 * first paint, and that spans two processes. Every launch appends one compact
 * block (main milestones + renderer paint timings + compositing mode) to
 * `~/.rcode/startup.log`, so a slow launch can be read instead of guessed.
 */
const LOG_NAME = 'startup.log';
const MAX_BYTES = 32 * 1024;
/** Every block starts with this, which makes trimming block-safe. */
const BLOCK_PREFIX = '---\n';

interface RendererReport {
  /** Page-relative timings, ms. */
  fcp?: number;
  fp?: number;
  /** `performance.timeOrigin` (epoch ms), to line page time up with process time. */
  timeOrigin?: number;
  marks?: [string, number][];
  longFrames?: { start: number; duration: number }[];
}

const marks: [string, number][] = [];

/** Record a main-process milestone. Cheap; safe to call unconditionally. */
export function recordStartupMark(label: string, value: number): void {
  marks.push([label, Math.round(value)]);
}

/** Read a recorded milestone (used to time window-shown → first-paint). */
export function markValue(label: string): number | undefined {
  return marks.find(([k]) => k === label)?.[1];
}

/**
 * Milliseconds the window was visible with nothing painted — the black screen the
 * user actually experiences. Needs both clocks: the window mark is process-relative,
 * the paint entry is page-relative from `timeOrigin`.
 */
export function computeBlackScreenMs(
  windowMarkMs: number | undefined,
  fcpPageMs: number | undefined,
  timeOriginEpochMs: number | undefined,
  processStartEpochMs: number,
): number | undefined {
  if (windowMarkMs === undefined || fcpPageMs === undefined || timeOriginEpochMs === undefined) {
    return undefined;
  }
  const windowVisible = processStartEpochMs + windowMarkMs;
  const firstPaint = timeOriginEpochMs + fcpPageMs;
  return Math.max(0, Math.round(firstPaint - windowVisible));
}

/** Append one launch's block, dropping the oldest content past MAX_BYTES. */
export function writeStartupReport(
  report: RendererReport,
  extra: Record<string, string>,
  processStartEpochMs: number = Date.now() - process.uptime() * 1000,
): void {
  const lines: string[] = [`RCode startup`, `  when     ${new Date().toISOString()}`];
  for (const [key, value] of Object.entries(extra)) lines.push(`  ${key.padEnd(11)} ${value}`);

  lines.push('  main       ' + marks.map(([k, v]) => `${k}=${v}`).join(' '));

  if (report.fcp !== undefined || report.fp !== undefined) {
    lines.push(`  paint      first-paint=${report.fp ?? '?'}ms first-content=${report.fcp ?? '?'}ms (page-relative)`);
  }
  const black = computeBlackScreenMs(
    markValue('main:window-created'),
    report.fcp ?? report.fp,
    report.timeOrigin,
    processStartEpochMs,
  );
  if (black !== undefined) {
    lines.push(`  black      ${black}ms from window shown to first content`);
  }
  if (report.marks?.length) {
    lines.push('  renderer   ' + report.marks.map(([k, v]) => `${k}=${v}`).join(' '));
  }
  if (report.longFrames?.length) {
    lines.push(
      '  longfx     ' +
        report.longFrames
          .slice(0, 5)
          .map((f) => `${Math.round(f.start)}ms+${Math.round(f.duration)}ms`)
          .join(' '),
    );
  }

  try {
    const file = path.join(os.homedir(), '.rcode', LOG_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let previous = '';
    try {
      previous = fs.readFileSync(file, 'utf8');
    } catch {
      previous = '';
    }

    // Each entry starts with BLOCK_PREFIX, so splitting yields whole blocks only.
    const blocks = (previous + BLOCK_PREFIX + lines.join('\n') + '\n')
      .split(BLOCK_PREFIX)
      .filter((block) => block.trim());
    while (blocks.length > 1 && blocks.join(BLOCK_PREFIX).length + BLOCK_PREFIX.length > MAX_BYTES) {
      blocks.shift();
    }
    fs.writeFileSync(file, blocks.map((block) => BLOCK_PREFIX + block).join(''));
  } catch {
    // Diagnostics must never break startup.
  }
}

/** Test seam. */
export function _resetStartupLogMarksForTesting(): void {
  marks.length = 0;
}
