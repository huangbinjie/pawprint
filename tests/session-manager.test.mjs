import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mutateSessions, searchSessions } from '../electron/session-manager.mjs';

const id = n => `01a0f1ea-4534-7651-b950-045a233fe6${String(n).padStart(2, '0')}`;

test('session manager searches safe names across active and archived chats', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paw-session-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(root, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, name TEXT, title TEXT, preview TEXT, first_user_message TEXT, cwd TEXT, model_provider TEXT, model TEXT, rollout_path TEXT, updated_at INTEGER, updated_at_ms INTEGER, archived INTEGER, archived_at INTEGER, source TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id(1), 'Fix login', 'PRIVATE PROMPT', 'Investigate authentication timeout', 'PRIVATE BODY', '/projects/pawprint', 'openai', 'gpt', null, 1, 1000, 0, null, 'cli');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id(2), 'Old release notes', 'PRIVATE PROMPT', 'Prepare release notes', 'PRIVATE BODY', '/projects/docs', 'openai', 'gpt', null, 2, 2000, 1, 3, 'cli');
  db.close();
  assert.deepEqual((await searchSessions(root, { query: 'release', includeArchived: true })).map(row => row.id), [id(2)]);
  const privateMatch = await searchSessions(root, { query: 'PRIVATE PROMPT', includeArchived: true });
  assert.deepEqual(privateMatch.map(row => row.id), [id(2), id(1)]);
  assert.equal(privateMatch.some(row => row.title.includes('PRIVATE')), false);
  assert.deepEqual((await searchSessions(root, { query: 'authentcation timeuot', includeArchived: true })).map(row => row.id), [id(1)]);
  assert.deepEqual((await searchSessions(root, { includeArchived: false })).map(row => row.id), [id(1)]);
});

test('session manager archives and deletes selected sessions and their local rollout', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paw-session-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'), { recursive: true });
  const rollout = path.join(root, 'sessions', 'chat.jsonl');
  await writeFile(rollout, '{}\n');
  const db = new DatabaseSync(path.join(root, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, name TEXT, cwd TEXT, rollout_path TEXT, updated_at INTEGER, archived INTEGER, archived_at INTEGER, source TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)').run(id(1), 'Chat', root, rollout, 1, 0, null, 'cli');
  db.close();
  assert.deepEqual(await mutateSessions(root, 'archive', [id(1)]), { count: 1 });
  assert.equal((await searchSessions(root, { includeArchived: true }))[0].archived, true);
  assert.deepEqual(await mutateSessions(root, 'delete', [id(1)]), { count: 1 });
  assert.deepEqual(await searchSessions(root), []);
  await assert.rejects(import('node:fs/promises').then(fs => fs.stat(rollout)), { code: 'ENOENT' });
});
