import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-items-page-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
await build({ entryPoints: ['apps/mobile/src/features/workItems/model.ts'], outfile: path.join(dir, 'model.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { groupWorkItems, defaultTab, loadAllWorkItems, workItemTabs, stateHints, emptyText, workItemPageLimit } = await import(pathToFileURL(path.join(dir, 'model.mjs')).href);
const item = (n, state, minutes) => ({ uid: `u${String(n).padStart(4, '0')}`, revision: 1, kind: 'task', title: `事项 ${n}`, state, createdAt: '2026-11-14T00:00:00Z', updatedAt: new Date(Date.parse('2026-11-14T02:00:00Z') - minutes * 60000).toISOString() });

test('five state tabs in workflow order, each with a hint and an empty text', () => {
  assert.deepEqual(workItemTabs.map(t => t.state), ['todo', 'in_progress', 'to_verify', 'done', 'returned']);
  for (const { state } of workItemTabs) { assert.ok(stateHints[state]); assert.ok(emptyText[state]); }
  assert.match(stateHints.to_verify, /验收通过才算完成/);
});
test('grouping sorts each state by latest update and ignores unknown states', () => {
  const groups = groupWorkItems([item(1, 'todo', 30), item(2, 'todo', 5), item(3, 'done', 1), { ...item(4, 'todo', 1), state: 'archived' }]);
  assert.deepEqual(groups.todo.map(i => i.uid), ['u0002', 'u0001']); assert.equal(groups.done.length, 1);
  assert.equal(Object.values(groups).flat().length, 3);
});
test('the page opens on what needs the user', () => {
  assert.equal(defaultTab(groupWorkItems([item(1, 'todo', 1), item(2, 'to_verify', 9)])), 'to_verify');
  assert.equal(defaultTab(groupWorkItems([item(1, 'in_progress', 1)])), 'in_progress');
  assert.equal(defaultTab(groupWorkItems([item(1, 'in_progress', 1), item(2, 'todo', 1)])), 'todo');
  assert.equal(defaultTab(groupWorkItems([])), 'todo');
});
test('loading follows cursors up to the page limit, de-duplicates and reports truncation', async () => {
  const all = Array.from({ length: 230 }, (_, i) => item(i, 'todo', i));
  const calls = [];
  const result = await loadAllWorkItems(async cursor => { calls.push(cursor); const start = cursor ? Number(cursor) : 0; return { storeId: 's', items: all.slice(Math.max(0, start - 1), start + 50), nextCursor: start + 50 < all.length ? String(start + 50) : null }; });
  assert.equal(result.items.length, workItemPageLimit); assert.equal(result.truncated, true);
  assert.equal(new Set(result.items.map(i => i.uid)).size, result.items.length);
  const small = await loadAllWorkItems(async () => ({ storeId: 's', items: all.slice(0, 3), nextCursor: null }));
  assert.deepEqual([small.items.length, small.truncated], [3, false]);
});
test('a store replaced between pages restarts once instead of mixing two stores', async () => {
  let call = 0;
  const result = await loadAllWorkItems(async cursor => { call++; if (call === 1) return { storeId: 'old', items: [item(1, 'todo', 1)], nextCursor: 'x' };
    if (call === 2) return { storeId: 'new', items: [item(2, 'todo', 1)], nextCursor: null }; return { storeId: 'new', items: [item(3, 'done', 1)], nextCursor: null }; });
  assert.deepEqual(result.items.map(i => i.uid), ['u0003']);
});
