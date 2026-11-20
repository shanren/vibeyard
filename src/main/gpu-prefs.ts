import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Hardware acceleration verdict, kept in its own file.
 *
 * On some machines (software rasterisers, old drivers, VMs) Chromium's GPU
 * process needs seconds to produce the very first composited frame — measured
 * 3.5s to first paint versus 0.2s with `--disable-gpu`, which reads to the user
 * as a black screen after launch. It cannot be detected before the first window
 * paints, so the first launch measures it and later launches start with software
 * compositing.
 *
 * Deliberately not stored in `state.json`: that file is written wholesale by the
 * debounced renderer save, which would clobber a main-process-only flag.
 */
export interface GpuPrefs {
  softwareCompositing?: boolean;
  /** First-paint delay that triggered the decision, for diagnostics. */
  observedFirstPaintMs?: number;
  /** Epoch ms of the decision, so the verdict can be re-tested periodically. */
  decidedAt?: number;
}

/** Re-test GPU compositing this often, so a one-off slow launch (AV scan, cold
 *  file cache) cannot disable hardware acceleration forever. */
export const GPU_RETRY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** Whether this launch should composite in software. */
export function shouldUseSoftwareCompositing(prefs: GpuPrefs, now: number = Date.now()): boolean {
  if (prefs.softwareCompositing !== true) return false;
  if (prefs.decidedAt === undefined) return true;
  return now - prefs.decidedAt < GPU_RETRY_INTERVAL_MS;
}

function prefsPath(): string {
  return path.join(os.homedir(), '.rcode', 'gpu.json');
}

export function readGpuPrefs(): GpuPrefs {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as GpuPrefs;
  } catch {
    return {};
  }
}

export function writeGpuPrefs(prefs: GpuPrefs): void {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2) + '\n');
  } catch {
    // Diagnostics/optimisation only — never break startup over this.
  }
}
