import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  _resetForTesting,
  closeDb,
  listSessions,
  openCodeDbPath,
  readSessionText,
  sessionExists,
} from './opencode-store';

/** Build a throwaway database with the two tables OpenCode actually records. */
function seedDb(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    create table session (
      id text primary key, project_id text, workspace_id text, parent_id text, slug text,
      directory text, path text, title text, version text, share_url text,
      summary_additions integer, summary_deletions integer, summary_files integer,
      summary_diffs text, metadata text, cost real, tokens_input integer, tokens_output integer,
      tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer,
      revert text, permission text, agent text, model text,
      time_created integer, time_updated integer, time_compacting integer, time_archived integer
    );
    create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
  `);
  const insertSession = db.prepare(
    'insert into session (id, directory, title, time_created, time_updated) values (?, ?, ?, ?, ?)',
  );
  insertSession.run('ses_old', 'E:/work/alpha', 'older work', 1000, 1000);
  insertSession.run('ses_new', 'E:/work/alpha', 'newest work', 2000, 5000);
  insertSession.run('ses_other', 'E:/work/beta', 'other project', 1500, 1500);

  const insertMessage = db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)');
  const insertPart = db.prepare(
    'insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)',
  );
  insertMessage.run('m1', 'ses_new', 5010, JSON.stringify({ role: 'user' }));
  insertMessage.run('m2', 'ses_new', 5020, JSON.stringify({ role: 'assistant' }));
  insertPart.run('p1', 'm1', 'ses_new', 5011, JSON.stringify({ type: 'text', text: 'how do I filter rows' }));
  insertPart.run('p2', 'm2', 'ses_new', 5021, JSON.stringify({ type: 'reasoning', text: 'thinking hard' }));
  insertPart.run('p3', 'm2', 'ses_new', 5022, JSON.stringify({ type: 'text', text: 'use the filter prop' }));
  db.close();
}

let tmpHome = '';

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rcode-oc-'));
  // ~/.local/share/opencode/opencode.db
  seedDb(path.join(tmpHome, '.local', 'share', 'opencode', 'opencode.db'));
});

afterEach(() => {
  closeDb();
  delete process.env.XDG_DATA_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('opencode-store', () => {
  it('resolves the database under ~/.local/share by default', () => {
    expect(openCodeDbPath()).toBe(path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'));
  });

  it('lists sessions newest first with their recorded directory', () => {
    process.env.XDG_DATA_HOME = path.join(tmpHome, '.local', 'share');
    _resetForTesting();

    const rows = listSessions();

    expect(rows.map((r) => r.id)).toEqual(['ses_new', 'ses_other', 'ses_old']);
    expect(rows[0].directory).toBe('E:/work/alpha');
    expect(rows[0].title).toBe('newest work');
    expect(rows[0].updatedMs).toBe(5000);
  });

  it('reports existence only for real session ids', () => {
    process.env.XDG_DATA_HOME = path.join(tmpHome, '.local', 'share');
    _resetForTesting();

    expect(sessionExists('ses_new')).toBe(true);
    expect(sessionExists('ses_missing')).toBe(false);
  });

  it('returns only user and assistant text, in order', () => {
    process.env.XDG_DATA_HOME = path.join(tmpHome, '.local', 'share');
    _resetForTesting();

    const text = readSessionText('ses_new');

    expect(text).toContain('how do I filter rows');
    expect(text).toContain('use the filter prop');
    expect(text).not.toContain('thinking hard');
  });

  it('degrades to empty results when the database is missing', () => {
    process.env.XDG_DATA_HOME = path.join(tmpHome, 'nowhere');
    _resetForTesting();

    expect(listSessions()).toEqual([]);
    expect(sessionExists('ses_new')).toBe(false);
    expect(readSessionText('ses_new')).toBe('');
  });
});
