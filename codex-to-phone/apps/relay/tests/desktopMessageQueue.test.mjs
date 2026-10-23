import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DesktopMessageQueue } from '../dist/desktop/desktopMessageQueue.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for (let n = 0; n < 200; n++) { if (await predicate()) return; await tick(); } assert.fail('queue fixture timed out'); }
async function fixture(t, file) {
  const f = { status: 'inProgress', turnId: 'old-turn', connected: true, canSend: true, sent: [], confirmed: new Set(), follows: new Set(), valid: true, delivery: 'confirmed' };
  f.queue = new DesktopMessageQueue({
    view: () => f.connected ? { status: f.status, control: { token: 'fresh-epoch', activeTurnId: f.turnId, canSend: f.canSend } } : null,
    confirmed: (thread, id) => f.connected && f.confirmed.has(id),
    follow: id => { f.follows.add(id); return () => f.follows.delete(id); },
    changed: id => f.queue.notify(id),
    send: async input => {
      f.sent.push(input); f.turnId = `next-${f.sent.length}`; f.status = 'inProgress';
      if (f.delivery === 'confirmed') f.confirmed.add(input.clientMessageId);
      return { action: 'start-turn', delivery: f.delivery };
    },
  });
  if (file) await f.queue.open(file, () => f.valid);
  f.add = (message = 'synthetic queued text', extra = {}) => { const input = { threadId: 'thread', clientMessageId: randomUUID(), message, ...extra }; return { input, result: f.queue.enqueue(input, 'device', () => { if (!f.connected) throw new Error('offline'); }) }; };
  f.complete = () => { f.turnId = null; f.status = 'completed'; f.queue.notify('thread'); };
  t.after(() => f.queue.stop());
  return f;
}

test('running turn is untouched; idle executes FIFO with explicit same-thread start and fresh guard', async t => {
  const f = await fixture(t); const one = f.add('first'), two = f.add('second'); await Promise.all([one.result, two.result]); await tick();
  assert.equal(f.sent.length, 0); assert.deepEqual([...f.follows], ['thread']);
  f.complete(); await until(() => f.sent.length === 1 && f.queue.snapshot('thread').items.length === 1);
  assert.deepEqual(f.sent[0], { threadId: 'thread', message: 'first', clientMessageId: one.input.clientMessageId, mode: 'start', controlToken: 'fresh-epoch', expectedTurnId: null });
  await tick(); assert.equal(f.sent.length, 1);
  f.complete(); await until(() => f.queue.snapshot('thread').items.length === 0);
  assert.equal(f.sent[1].message, 'second'); assert.equal(f.follows.size, 0);
});

test('cancellation wins before dispatch and repeated IDs never repeat a message', async t => {
  const f = await fixture(t); const one = f.add(); await one.result;
  await f.queue.cancel('other-thread', one.input.clientMessageId); assert.equal(f.queue.snapshot('thread').items.length, 1);
  await f.queue.cancel('thread', one.input.clientMessageId);
  await f.queue.enqueue(one.input, 'device', () => assert.fail('duplicate admission'));
  await assert.rejects(f.queue.enqueue({ ...one.input, message: 'changed' }, 'device', () => {}), /desktop_queue_id_conflict/);
  f.complete(); await tick(); assert.equal(f.sent.length, 0);
});

test('disconnect retains queue, reconnect resumes only from authoritative idle state', async t => {
  const f = await fixture(t); await f.add().result;
  f.connected = false; f.complete(); await tick(); assert.equal(f.sent.length, 0);
  f.connected = true; f.turnId = 'desktop-started-another'; f.status = 'inProgress'; f.queue.notify('thread'); await tick(); assert.equal(f.sent.length, 0);
  f.complete(); await until(() => f.sent.length === 1);
});

for (const status of ['interrupted', 'failed']) test(`${status} pauses queued work instead of undoing a stop`, async t => {
  const f = await fixture(t); const one = f.add(); await one.result;
  f.turnId = null; f.status = status; f.queue.notify('thread');
  await until(() => f.queue.snapshot('thread').items[0]?.status === 'paused'); assert.equal(f.sent.length, 0);
  await f.queue.cancel('thread', one.input.clientMessageId); assert.equal(f.follows.size, 0);
});

for (const delivery of ['submitted', 'uncertain']) test(`${delivery} is not replayed and blocks later work until identity confirmation`, async t => {
  const f = await fixture(t); f.delivery = delivery;
  const one = f.add('first'); await one.result; await f.add('later').result;
  f.complete(); await until(() => f.queue.snapshot('thread').items[0]?.status === 'uncertain');
  await assert.rejects(f.queue.cancel('thread', one.input.clientMessageId), /desktop_queue_result_pending/);
  f.complete(); await tick(); assert.equal(f.sent.length, 1);
  f.confirmed.add(one.input.clientMessageId); f.delivery = 'confirmed'; f.queue.notify('thread');
  await until(() => f.sent.length === 2); assert.equal(f.sent[1].message, 'later');
});

test('private persistence restores waiting messages and idempotency across restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-queue-')); t.after(() => fs.rm(root, { recursive: true, force: true })); const file = path.join(root, 'queue.json');
  const first = await fixture(t, file); const item = first.add(); await item.result;
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600); await first.queue.stop();
  const second = await fixture(t, file); assert.equal(second.queue.snapshot('thread').items[0].text, item.input.message);
  await second.queue.enqueue(item.input, 'device', () => assert.fail('duplicate should not re-admit'));
  second.complete(); await until(() => second.queue.snapshot('thread').items.length === 0);
  await second.queue.stop();
  const third = await fixture(t, file); await third.queue.enqueue(item.input, 'device', () => assert.fail('sent tombstone'));
  third.complete(); await tick(); assert.equal(third.sent.length, 0);
});

test('crash during sending restores as uncertain without automatic retry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-queue-crash-')); t.after(() => fs.rm(root, { recursive: true, force: true })); const file = path.join(root, 'queue.json');
  const first = await fixture(t, file); const one = first.add(); await one.result; await first.queue.stop();
  const records = JSON.parse(await fs.readFile(file, 'utf8')); records[0].status = 'sending'; await fs.writeFile(file, JSON.stringify(records));
  const second = await fixture(t, file); second.complete(); await tick(); assert.equal(second.sent.length, 0); assert.equal(second.queue.snapshot('thread').items[0].status, 'uncertain');
  second.confirmed.add(one.input.clientMessageId); second.queue.notify('thread'); await until(() => second.queue.snapshot('thread').items.length === 0);
});

test('revocation cancels waiting entries and releases their subscription', async t => {
  const f = await fixture(t); await f.add().result; await f.queue.revoke('device'); f.complete(); await tick();
  assert.equal(f.sent.length, 0); assert.equal(f.queue.snapshot('thread').items.length, 0); assert.equal(f.follows.size, 0);
});

test('restart keeps a revoked owner unknown submission as a barrier to later work', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-queue-revoked-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'queue.json');
  const first = await fixture(t, file); const one = first.add(); await one.result; await first.queue.stop();
  const records = JSON.parse(await fs.readFile(file, 'utf8')); records[0].status = 'sending'; await fs.writeFile(file, JSON.stringify(records));
  const second = await fixture(t); second.valid = false; await second.queue.open(file, () => second.valid);
  assert.equal(second.queue.snapshot('thread').items[0].status, 'uncertain');
  second.valid = true; await second.add('later').result; second.complete(); await tick();
  assert.equal(second.sent.length, 0, 'revocation cannot erase an unknown submission');
  second.confirmed.add(one.input.clientMessageId); second.queue.notify('thread');
  await until(() => second.sent.length === 1); assert.equal(second.sent[0].message, 'later');
});

test('bounded admission rejects overflow and bad storage without silently dropping messages', async t => {
  const f = await fixture(t); for (let i = 0; i < 8; i++) await f.add().result;
  await assert.rejects(f.add().result, /desktop_queue_limit/); assert.equal(f.queue.snapshot('thread').items.length, 8);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-queue-bad-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'bad.json'); await fs.writeFile(file, 'broken');
  await assert.rejects(f.queue.open(file, () => true), /desktop_queue_unavailable/); assert.equal(await fs.readFile(file, 'utf8'), 'broken');
});
