import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Read-only access to OpenCode's session store.
 *
 * OpenCode keeps everything in one SQLite database — measured 864MB on a machine
 * with a few dozen sessions, so it is opened read-only, only for the queries below,
 * and never copied or scanned wholesale. `node:sqlite` ships with Electron's Node,
 * so this needs no native dependency (no `better-sqlite3`, no rebuild step).
 *
 * Rows are JSON blobs:
 *   session.data / session.directory   → id, cwd, title, updated time
 *   message.data                       → {"role":"user"|"assistant", ...}
 *   part.data                          → {"type":"text","text":"..."}
 */
export interface OpenCodeSessionRow {
  id: string;
  directory: string;
  title: string;
  updatedMs: number;
}

/** Pseudo transcript path: these sessions have no file to point at. */
export const OPENCODE_PATH_PREFIX = 'opencode:';

/** Hard caps so a giant database cannot stall the UI. */
const MAX_SESSIONS = 500;
const MAX_PARTS = 4000;
const MAX_TEXT_CHARS = 50 * 1024;

export function openCodeDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'opencode', 'opencode.db');
}

let cached: { db: DatabaseSync; path: string } | null = null;

/** Open (or reuse) the read-only handle. Returns null when the db is absent. */
function openDb(): DatabaseSync | null {
  const dbPath = openCodeDbPath();
  if (cached && cached.path === dbPath) return cached.db;
  closeDb();
  try {
    // `fileMustExist` would only produce an exception we would swallow anyway.
    if (!fs.existsSync(dbPath)) return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    cached = { db, path: dbPath };
    return db;
  } catch {
    return null;
  }
}

export function closeDb(): void {
  if (!cached) return;
  try {
    cached.db.close();
  } catch {
    // already closed / never opened
  }
  cached = null;
}

interface SessionDbRow {
  id: string;
  directory: string | null;
  title: string | null;
  time_updated: number | null;
}

/**
 * Every session, newest first. OpenCode records an absolute `directory` on each
 * session, which is what lets the per-project panel attribute it without a slug.
 */
export function listSessions(): OpenCodeSessionRow[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        'select id, directory, title, time_updated from session order by time_updated desc limit ?',
      )
      .all(MAX_SESSIONS) as unknown as SessionDbRow[];
    return rows
      .filter((row) => typeof row.id === 'string' && row.id.length > 0)
      .map((row) => ({
        id: row.id,
        directory: row.directory ?? '',
        title: row.title ?? '',
        updatedMs: row.time_updated ?? 0,
      }));
  } catch {
    return [];
  }
}

/** Whether a session row exists (used to validate resume requests). */
export function sessionExists(id: string): boolean {
  const db = openDb();
  if (!db) return false;
  try {
    return db.prepare('select 1 as ok from session where id = ? limit 1').get(id) !== undefined;
  } catch {
    return false;
  }
}

/**
 * User-visible conversation text, in order. Reasoning/tool parts are skipped: they
 * are not the conversation, and indexing them would drown search in noise.
 */
export function readSessionText(id: string): string {
  const db = openDb();
  if (!db) return '';
  try {
    const rows = db
      .prepare(
        `select m.data as msg, p.data as part
           from part p join message m on m.id = p.message_id
          where p.session_id = ?
          order by p.time_created
          limit ?`,
      )
      .all(id, MAX_PARTS) as unknown as { msg: string | null; part: string | null }[];

    const texts: string[] = [];
    let total = 0;
    for (const row of rows) {
      if (total >= MAX_TEXT_CHARS) break;
      let role = '';
      try {
        role = (JSON.parse(row.msg ?? '{}') as { role?: string }).role ?? '';
      } catch {
        role = '';
      }
      if (role !== 'user' && role !== 'assistant') continue;
      let part: { type?: string; text?: string };
      try {
        part = JSON.parse(row.part ?? '{}') as { type?: string; text?: string };
      } catch {
        continue;
      }
      if (part.type !== 'text' || !part.text) continue;
      texts.push(part.text.trim());
      total += part.text.length;
    }
    return texts.join('\n---\n');
  } catch {
    return '';
  }
}

/** Test seam: drop the cached handle so a new database path is picked up. */
export function _resetForTesting(): void {
  closeDb();
}
