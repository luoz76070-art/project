import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexStore } from '../dist/store/codexStore.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const day = 86400_000;
async function fixture(t, ages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-thread-range-'));
  const store = new CodexStore(root), now = Date.now(), files = [], rows = [];
  await fs.mkdir(path.join(root, 'sessions'));
  for (const [i, age] of ages.entries()) {
    const id = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
    const file = path.join(root, 'sessions', `rollout-${id}.jsonl`);
    await fs.writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: `/fixture/project-${i % 2}`, source: 'vscode' } }) + '\n');
    await fs.utimes(file, new Date(now - 90 * day), new Date(now - 90 * day));
    files.push(file); rows.push({ id, thread_name: `fixture session ${i}`, updated_at: new Date(now - age * day).toISOString() });
  }
  await fs.writeFile(path.join(root, 'session_index.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, now, files, rows };
}

test('Codex applies the inclusive time cutoff before search and pagination without opening old rollout heads', async t => {
  const f = await fixture(t, [1, 30, 31, 60]);
  const opened = [], open = fs.open;
  t.mock.method(fs, 'open', (...args) => { opened.push(String(args[0])); return open(...args); });
  const recent = await f.store.listThreads(1, 0, '', f.now - 30 * day);
  assert.deepEqual(recent.map(row => row.id), [f.rows[0].id]);
  const second = await f.store.listThreads(2, 1, '', f.now - 30 * day);
  assert.deepEqual(second.map(row => row.id), [f.rows[1].id]);
  assert.deepEqual(await f.store.listThreads(10, 0, 'session 2', f.now - 30 * day), []);
  assert.ok(!opened.includes(f.files[2]) && !opened.includes(f.files[3]), 'excluded metadata must not trigger head reads');
  assert.equal((await f.store.listThreads(10)).length, 4, 'internal callers keep the existing all-time default');
});

test('a newly written old Codex session returns to the recent catalog without reading its full log', async t => {
  const f = await fixture(t, [45]);
  assert.equal((await f.store.listThreads(10, 0, '', f.now - 30 * day)).length, 0);
  await fs.appendFile(f.files[0], JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'synthetic new conversation' } }) + '\n');
  let recent;
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    recent = await f.store.listThreads(10, 0, '', f.now - 30 * day);
    if (recent.length) break;
  }
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, f.rows[0].id);
  assert.ok(Date.parse(recent[0].updatedAt) >= f.now);
});

test('Codex HTTP recent/all lists filter before paging and report an exact final page', async t => {
  const f = await fixture(t, [1, 45]);
  const app = await createRelayServer({ logger: false,
    config: { host: '127.0.0.1', port: 0, token: 'synthetic-range-admin', codexHome: f.root, defaultCwd: f.root },
    services: { store: f.store, desktopControl: { stop: async () => {} }, live: { stop: async () => {} }, liveTurns: { stop: async () => {} } },
  });
  t.after(() => app.close());
  const get = url => app.inject({ url, headers: { authorization: 'Bearer synthetic-range-admin' } });
  const recent = (await get('/api/threads?limit=1')).json();
  assert.deepEqual(recent.threads.map(row => row.id), [f.rows[0].id]);
  assert.equal(recent.hasMore, false);
  assert.equal(recent.nextOffset, 1);
  const all = (await get('/api/threads?range=all&limit=1')).json();
  assert.equal(all.hasMore, true);
  const older = (await get('/api/threads?range=all&limit=1&offset=1')).json();
  assert.equal(older.hasMore, false); assert.equal(older.threads[0].id, f.rows[1].id);
  assert.equal((await get('/api/threads?range=recent&query=session%201')).json().threads.length, 0);
  assert.equal((await get('/api/threads?range=invalid')).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/threads?range=all' })).statusCode, 401);
});
