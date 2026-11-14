import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkItemStore } from '../dist/workItems/store.js';
import { limits } from '../dist/workItems/schema.js';
import { fields, result, binding } from './workItemFixtures.mjs';

const guard = () => {};
const mutation = expectedRevision => ({ mutationId: randomUUID(), expectedRevision });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'work-item-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: await WorkItemStore.open(root) };
}
const create = store => store.create(randomUUID(), fields(), 'device-a', mutation(0), guard);
const legacy = () => ({ revision: 1, id: randomUUID(), status: 'draft', text: '旧交接', createdAt: 1 });

test('atomic snapshots, restart-stable identity and shared data; receipts survive response loss', async t => {
  const { root, store } = await fixture(t), uid = randomUUID(), command = mutation(0), events = [];
  store.subscribe(event => events.push(event));
  const first = await store.create(uid, fields(), 'device-a', command, guard);
  assert.equal(first.item.state, 'todo'); assert.equal(first.storeRevision, 1);
  assert.deepEqual(events, [{ uid, revision: 1, storeRevision: 1 }]);
  assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(store.file + '.bak', 'utf8')).storeRevision, 0);
  const restarted = await WorkItemStore.open(root);
  assert.deepEqual(await restarted.create(uid, fields(), 'device-a', command, guard), first);
  const edit = mutation(1);
  await restarted.patch(uid, { detail: '设备B编辑' }, edit, 'device-b', guard);
  const again = await WorkItemStore.open(root);
  assert.equal((await again.patch(uid, { detail: '设备B编辑' }, edit, 'device-b', guard)).item.revision, 2);
  await assert.rejects(again.patch(uid, { detail: '不相同的重试' }, edit, 'device-b', guard), /mutation_conflict/);
  assert.equal((await fs.readdir(path.dirname(store.file))).some(file => file.endsWith('.tmp')), false);
  const external = again.get(uid); external.item.title = '不能修改内部数据';
  assert.equal(again.get(uid).item.title, fields().title);
});

test('simultaneous CAS writers have exactly one winner and pagination detects concurrent edits', async t => {
  const { store } = await fixture(t), { item } = await create(store);
  const edits = await Promise.allSettled(['a', 'b'].map(title => store.patch(item.uid, { title }, mutation(1), title, guard)));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(edits.find(r => r.status === 'rejected').reason.message, /revision_conflict/);
  await create(store);
  const page = store.list(undefined, undefined, 1);
  assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
  assert.equal('detail' in page.items[0], false, 'list only exposes summary fields');
  assert.equal(store.list(undefined, page.nextCursor, 1).items.length, 1);
  await create(store);
  assert.throws(() => store.list(undefined, page.nextCursor), /cursor_stale/);
});

test('persist and revocation failures preserve primary snapshot, in-memory state and event count', async t => {
  const { store } = await fixture(t), { item } = await create(store), before = await fs.readFile(store.file, 'utf8'), events = [];
  store.subscribe(e => events.push(e));
  const original = store.atomic.bind(store);
  const stub = t.mock.method(store, 'atomic', async (file, content, guard) => {
    if (file === store.file) throw new Error('simulated rename failure');
    return original(file, content, guard);
  });
  await assert.rejects(store.patch(item.uid, { title: 'not committed' }, mutation(1), 'device', guard), /rename failure/);
  assert.equal(await fs.readFile(store.file, 'utf8'), before); assert.equal(store.get(item.uid).item.revision, 1); assert.equal(events.length, 0);
  stub.mock.restore();
  let checks = 0;
  await assert.rejects(store.patch(item.uid, { title: 'revoked' }, mutation(1), 'device', () => { if (++checks === 2) throw new Error('unauthorized'); }), /unauthorized/);
  assert.equal(await fs.readFile(store.file, 'utf8'), before); assert.equal(events.length, 0);
  assert.equal((await store.patch(item.uid, { title: 'valid' }, mutation(1), 'device-b', guard)).item.revision, 2);
});

test('corrupt, future or missing primary with backup stays unavailable without deleting evidence', async t => {
  const { root, store } = await fixture(t);
  await create(store);
  const original = await fs.readFile(store.file, 'utf8'), backup = await fs.readFile(store.file + '.bak', 'utf8');
  for (const corrupted of ['{broken', JSON.stringify({ ...JSON.parse(original), schemaVersion: 2 })]) {
    await fs.writeFile(store.file, corrupted);
    const closed = await WorkItemStore.open(root);
    assert.throws(() => closed.info(), /store_unavailable/);
    assert.equal(await fs.readFile(store.file, 'utf8'), corrupted);
    assert.equal(await fs.readFile(store.file + '.bak', 'utf8'), backup);
  }
  await fs.rm(store.file);
  const missing = await WorkItemStore.open(root);
  assert.throws(() => missing.info(), /store_unavailable/);
  await assert.rejects(fs.stat(store.file), { code: 'ENOENT' });
  // An operator can restore a validated backup while Relay is stopped.
  await fs.copyFile(store.file + '.bak', store.file);
  assert.equal((await WorkItemStore.open(root)).info().storeId, store.info().storeId);
});

test('full count, full bytes and per-item limits reject instead of evicting', async t => {
  const { root, store } = await fixture(t);
  await create(store);
  const baseline = JSON.parse(await fs.readFile(store.file, 'utf8'));
  for (const [count, detail] of [[limits.items, 'small'], [600, 'x'.repeat(limits.detail)]]) {
    const snapshot = { ...baseline, entries: Array.from({ length: count }, () => ({ ...structuredClone(baseline.entries[0]), item: { ...baseline.entries[0].item, uid: randomUUID(), detail } })) };
    const raw = JSON.stringify(snapshot);
    if (count === limits.items) {
      await fs.writeFile(store.file, raw);
      const full = await WorkItemStore.open(root);
      await assert.rejects(create(full), /capacity/);
      assert.equal(full.list().items.length, 50); assert.equal(await fs.readFile(store.file, 'utf8'), raw);
    } else {
      // A near-full file must open, but the next bounded item cannot push it over 32MiB.
      snapshot.entries.length = Math.floor(limits.storeBytes / (raw.length / count)) - 1;
      await fs.writeFile(store.file, JSON.stringify(snapshot));
      const full = await WorkItemStore.open(root);
      let rejected = false;
      for (let i = 0; i < 3; i++) {
        try { await full.create(randomUUID(), { ...fields(), detail }, 'device', mutation(0), guard); }
        catch (error) { assert.match(error.message, /capacity/); rejected = true; break; }
      }
      assert.equal(rejected, true);
    }
  }
});

test('only existing local uploads can be referenced; symlinks and mismatched sizes are rejected', async t => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'mobile-uploads'));
  await fs.writeFile(path.join(root, 'mobile-uploads', 'fixture.txt'), 'hello');
  await fs.writeFile(path.join(root, 'outside.txt'), 'hello');
  await fs.symlink(path.join(root, 'outside.txt'), path.join(root, 'mobile-uploads', 'escape.txt'));
  const asset = { id: randomUUID(), relativePath: 'mobile-uploads/fixture.txt', fileName: 'fixture.txt', size: 5, managed: false };
  await store.create(randomUUID(), { ...fields(), assets: [asset] }, 'device', mutation(0), guard);
  for (const patch of [{ relativePath: '../outside.txt' }, { relativePath: 'mobile-uploads/../outside.txt' }, { relativePath: 'mobile-uploads/escape.txt' },
    { relativePath: 'mobile-uploads/missing' }, { size: 6 }]) {
    await assert.rejects(store.create(randomUUID(), { ...fields(), assets: [{ ...asset, ...patch }] }, 'device', mutation(0), guard), /asset_/);
  }
  assert.equal(await fs.readFile(path.join(root, 'mobile-uploads', 'fixture.txt'), 'utf8'), 'hello');
});

test('legacy draft, uncertain, queued and delivered map independently of completion; import is restart idempotent', async t => {
  const { root, store } = await fixture(t), storeId = store.info().storeId;
  for (const delivery of ['draft', 'uncertain', 'queue', 'desktop']) {
    const handoff = legacy();
    if (delivery !== 'draft') Object.assign(handoff, { status: delivery === 'uncertain' ? 'uncertain' : 'confirmed', clientMessageId: handoff.id,
      target: { scope: 'fixture', threadId: randomUUID(), title: '旧会话', cwd: root }, message: '冻结的发送正文', ...(delivery !== 'uncertain' ? { acceptance: delivery } : {}) });
    const draft = { id: handoff.id, text: '网页编辑正文', scope: 'fixture', targetId: '', attachments: [] };
    const packet = { storeId, scope: 'fixture', handoff, draft };
    const imported = await store.importHandoff(packet, 'device-a', guard);
    assert.equal(imported.imports.length, 1);
    const saved = store.get(imported.imports[0].uid).item;
    assert.equal(saved.state, delivery === 'desktop' ? 'in_progress' : 'todo');
    assert.equal(saved.currentAttempt.delivery, { draft: 'none', uncertain: 'unknown', queue: 'queued', desktop: 'delivered' }[delivery]);
    assert.equal(saved.detail, delivery === 'draft' ? draft.text : handoff.text);
    assert.equal(saved.currentAttempt.lastTurn, null); assert.equal(saved.currentAttempt.turnId, null);
    const reopened = await WorkItemStore.open(root);
    assert.deepEqual((await reopened.importHandoff(packet, 'device-b', guard)).imports, imported.imports);
    await assert.rejects(store.importHandoff({ ...packet, draft: { ...draft, text: 'different' } }, 'device', guard), /import_conflict/);
  }
  const packet = { storeId, scope: 'fixture', handoff: legacy(), draft: { id: randomUUID(), text: '独立遗留草稿', scope: 'fixture', targetId: '', attachments: [] } };
  assert.equal((await store.importHandoff(packet, 'device', guard)).imports.length, 2);
  assert.throws(() => store.importHandoff({ ...packet, scope: 'other' }, 'device', guard), /import_scope/);
  await assert.rejects(store.importHandoff({ ...packet, storeId: randomUUID() }, 'device', guard), /store_changed/);
});

test('internal delivery and result writes still obey revision CAS and cannot verify an item', async t => {
  const { store } = await fixture(t), { item } = await create(store);
  const attempt = { ...item.currentAttempt, channel: 'agent', agentId: 'deepseek', sessionId: 'fixture', turnId: 'turn-fixture',
    clientMessageId: randomUUID(), delivery: 'delivered', message: 'freeze' };
  await store.recordDelivery(item.uid, attempt, 'system', mutation(1));
  const running = store.get(item.uid).item;
  await store.applyTurnResult(item.uid, binding(running), result(), 'agent', mutation(2));
  assert.equal(store.get(item.uid).item.state, 'to_verify');
  await store.verify(item.uid, 'accept', null, mutation(3), 'device-b', guard);
  await store.applyTurnResult(item.uid, binding(running), result('failed'), 'system', mutation(4));
  assert.equal(store.get(item.uid).item.state, 'done');
});

test('migration keeps only frozen upload references and rejects missing uploads without a partial import', async t => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'mobile-uploads'));
  const file = path.join(root, 'mobile-uploads', 'frozen.txt'); await fs.writeFile(file, 'hello');
  const handoff = legacy(); Object.assign(handoff, { status: 'uncertain', clientMessageId: handoff.id,
    target: { scope: 'fixture', threadId: randomUUID(), title: '原会话' }, message: `冻结正文\n\n已上传附件：\n- frozen.txt | ${file}` });
  const packet = { storeId: store.info().storeId, scope: 'fixture', handoff, draft: { id: handoff.id, text: '后来的修改', scope: 'fixture', targetId: '', attachments: [
    { id: 'old-upload-id', fileName: 'frozen.txt', path: file, size: 5 },
    { id: 'later-upload-id', fileName: 'later.txt', path: path.join(root, 'mobile-uploads', 'missing.txt'), size: 5 },
  ] } };
  const imported = await store.importHandoff(packet, 'device', guard), item = store.get(imported.imports[0].uid).item;
  assert.equal(item.assets.length, 1); assert.equal(item.assets[0].relativePath, 'mobile-uploads/frozen.txt');
  assert.equal(item.currentAttempt.message, handoff.message); assert.equal(item.currentAttempt.delivery, 'unknown');
  const before = store.info().storeRevision;
  const bad = { ...packet, handoff: legacy(), draft: { ...packet.draft, id: randomUUID() } };
  await assert.rejects(store.importHandoff(bad, 'device', guard), /asset_unavailable/);
  assert.equal(store.info().storeRevision, before); assert.equal(store.list().items.length, 1);
});

test('receipt memory is bounded and corrupt import identities cannot reopen as an empty store', async t => {
  const { root, store } = await fixture(t), { item } = await create(store);
  for (let revision = 1; revision <= 68; revision++) await store.patch(item.uid, { title: `edit ${revision}` }, mutation(revision), 'device', guard);
  const snapshot = JSON.parse(await fs.readFile(store.file, 'utf8'));
  assert.equal(snapshot.entries[0].receipts.length, limits.receipts);
  snapshot.entries[0].item.source = { kind: 'legacy-handoff', legacyId: randomUUID(), importFingerprint: 'a'.repeat(64) };
  await fs.writeFile(store.file, JSON.stringify(snapshot));
  assert.throws(() => store.get('missing'), /not_found/);
  const reopened = await WorkItemStore.open(root);
  assert.throws(() => reopened.info(), /store_unavailable/);
  assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).entries.length, 1);
});
