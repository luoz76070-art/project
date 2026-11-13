import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url)), temp = await mkdtemp(path.join(tmpdir(), 'handoff-migration-'));
await build({ entryPoints: [path.join(root, 'apps/mobile/src/features/product/handoffMigration.ts')], bundle: true, platform: 'node', format: 'esm',
  outfile: path.join(temp, 'migration.mjs'), define: { 'import.meta.env': '{}' } });
const { migrateHandoff, migrationKey } = await import(pathToFileURL(path.join(temp, 'migration.mjs')));
test.after(() => rm(temp, { recursive: true, force: true }));
const draftKey = 'mobileCodexProductHandoffV1';
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ native = true, web = true, status = 'draft', sameId = true } = {}) {
  const id = randomUUID(), storeId = randomUUID(), values = new Map(), calls = [], records = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const handoff = { revision: 1, id, status, text: '旧交接说明', createdAt: 1 };
  if (status !== 'draft') Object.assign(handoff, { clientMessageId: id, message: '冻结正文',
    target: { scope: 'fixture', threadId: randomUUID(), title: '原会话', cwd: '/fixture' }, ...(status === 'confirmed' ? { acceptance: 'queue' } : {}) });
  const draft = { id: sameId ? id : randomUUID(), scope: 'fixture', text: '网页编辑', targetId: '', attachments: [] };
  if (web) storage.setItem(draftKey, JSON.stringify(draft));
  const f = { storage, values, calls, records, draft, handoff, storeId, current: native ? structuredClone(handoff) : null, digest: 'a'.repeat(64), acked: false };
  const host = { getState: async () => ({ handoff: f.current, handoffMigration: f.oldHost ? undefined : { version: 1, id: f.current?.id, digest: f.digest } }),
    async handoff(input) {
      calls.push({ method: input.action, input }); assert.equal(input.action, 'ackMigration', 'migration must never send, confirm or close a message');
      await f.onAck?.(input);
      if (f.ackResponse !== undefined) return f.ackResponse;
      if (!f.acked) { assert.equal(input.id, f.current.id); assert.equal(input.expectedDigest, f.digest); f.acked = true; f.current = null; }
      return { handoff: f.current };
    } };
  f.options = { endpoint: 'http://relay.invalid', token: 'secret-token', scope: 'fixture', storage, ...(native ? { host } : {}),
    async get(url) {
      calls.push({ method: 'GET', url });
      if (url.includes('?limit=1')) return { storeId: f.storeId };
      await f.onRead?.();
      const uid = url.split('/').at(-1), record = [...records.values()].find(record => record.uid === uid);
      return { storeId: f.badRead ? randomUUID() : f.storeId, item: { uid, source: { kind: 'legacy-handoff', legacyId: record.legacyId, importFingerprint: record.fingerprint } } };
    },
    async post(url, token, packet) {
      calls.push({ method: 'POST', url, packet: structuredClone(packet) });
      assert.equal(url.endsWith('/api/work-items/import-handoff'), true); assert.equal(token, 'secret-token');
      assert.equal(JSON.stringify(packet).includes('secret-token'), false);
      for (const legacyId of [packet.handoff?.id, packet.draft?.id].filter(Boolean)) if (!records.has(legacyId)) records.set(legacyId, { legacyId, uid: randomUUID(), fingerprint: 'b'.repeat(64) });
      await f.onPost?.();
      return f.importResponse ?? { storeId: f.storeId, storeRevision: 1, imports: [...records.values()] };
    } };
  return f;
}

test('explicit migration imports, reads back every source, then acknowledges native and clears matching Web draft', async () => {
  for (const status of ['draft', 'uncertain', 'confirmed']) {
    const f = fixture({ status });
    const outcome = await migrateHandoff(f.options);
    assert.deepEqual(outcome, { count: 1, handoff: null, draftChanged: false });
    assert.deepEqual(f.calls.map(c => c.method), ['GET', 'POST', 'GET', 'ackMigration']);
    assert.equal(f.calls[1].packet.handoff.status, status);
    assert.equal(f.storage.getItem(draftKey), null); assert.equal(f.storage.getItem(migrationKey), null);
    assert.equal(f.calls.at(-1).input.workItemUid, [...f.records.values()][0].uid);
  }
});

test('orphan Web draft migrates without native; different native and Web IDs produce two read-backs', async () => {
  const orphan = fixture({ native: false });
  assert.equal((await migrateHandoff(orphan.options)).count, 1);
  assert.equal(orphan.calls.some(c => c.method === 'ackMigration'), false);
  const two = fixture({ sameId: false });
  assert.equal((await migrateHandoff(two.options)).count, 2);
  assert.deepEqual(two.calls.map(c => c.method), ['GET', 'POST', 'GET', 'GET', 'ackMigration']);
});

test('old native, invalid sources and scope mismatch keep sources and perform no import', async () => {
  const cases = [f => { f.oldHost = true; }, f => { f.options.scope = 'other'; }, f => { f.values.set(draftKey, '{broken'); },
    f => { f.current = { ...f.current, id: 'bad' }; }, f => { f.current = { ...f.current, status: 'uncertain' }; }];
  for (const change of cases) {
    const f = fixture(); change(f); const raw = f.storage.getItem(draftKey);
    await assert.rejects(migrateHandoff(f.options));
    assert.equal(f.calls.some(c => c.method === 'POST'), false); assert.equal(f.storage.getItem(draftKey), raw);
    assert.equal(f.acked, false);
  }
});

test('journal persistence failure stops import and credential/control fields are whitelisted away', async () => {
  const f = fixture();
  f.storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(migrateHandoff(f.options), /quota/);
  assert.equal(f.calls.some(c => c.method === 'POST'), false); assert.equal(f.acked, false);
  const clean = fixture(); clean.current.token = 'must-not-send'; clean.draft.controlToken = 'must-not-send';
  clean.storage.setItem(draftKey, JSON.stringify(clean.draft));
  await migrateHandoff(clean.options);
  assert.equal(JSON.stringify(clean.calls.find(c => c.method === 'POST').packet).includes('must-not-send'), false);
});

test('lost import response retries the immutable packet and preserves newly edited local draft', async () => {
  const f = fixture(), oldRaw = f.storage.getItem(draftKey);
  f.onPost = () => { throw new Error('lost response'); };
  await assert.rejects(migrateHandoff(f.options), /lost response/);
  assert.equal(f.storage.getItem(draftKey), oldRaw); assert.ok(f.storage.getItem(migrationKey)); assert.equal(f.acked, false);
  f.storage.setItem(draftKey, JSON.stringify({ ...f.draft, text: '迁移期间的新编辑' }));
  f.onPost = undefined;
  const result = await migrateHandoff(f.options);
  assert.equal(result.draftChanged, true); assert.equal(f.records.size, 1);
  assert.deepEqual(...f.calls.filter(c => c.method === 'POST').map(c => c.packet));
  assert.match(f.storage.getItem(draftKey), /新编辑/); assert.equal(f.storage.getItem(migrationKey), null);
});

test('wrong import receipts or read-back never clear source or acknowledge native', async () => {
  for (const change of [f => { f.badRead = true; }, f => { f.importResponse = { storeId: f.storeId, imports: [] }; },
    f => { f.importResponse = { storeId: randomUUID(), imports: [] }; }]) {
    const f = fixture(); change(f); const before = f.storage.getItem(draftKey);
    await assert.rejects(migrateHandoff(f.options), /核验/);
    assert.equal(f.storage.getItem(draftKey), before); assert.ok(f.storage.getItem(migrationKey)); assert.equal(f.acked, false);
  }
});

test('ACK failure is resumable; lost successful ACK preserves a newer native handoff on retry', async () => {
  const f = fixture();
  f.onAck = () => { throw new Error('commit failed'); };
  await assert.rejects(migrateHandoff(f.options), /commit failed/);
  assert.ok(f.storage.getItem(draftKey)); assert.ok(f.storage.getItem(migrationKey));
  f.onAck = () => { f.acked = true; f.current = null; throw new Error('ACK response lost'); };
  await assert.rejects(migrateHandoff(f.options), /ACK response lost/);
  const newer = { ...f.handoff, id: randomUUID(), text: '新交接' }; f.current = newer; f.onAck = undefined;
  assert.deepEqual((await migrateHandoff(f.options)).handoff, newer);
  assert.equal(f.records.size, 1); assert.equal(f.storage.getItem(draftKey), null);
});

test('incomplete or unchanged native ACK response is not mistaken for migration success', async () => {
  for (const response of [{}, 'old']) {
    const f = fixture(); f.ackResponse = response === 'old' ? { handoff: f.handoff } : response;
    await assert.rejects(migrateHandoff(f.options), /原生迁移确认失败/);
    assert.ok(f.storage.getItem(draftKey)); assert.ok(f.storage.getItem(migrationKey));
  }
});

test('overlapping migration, changed endpoint, changed store and corrupt journal do not delete records', async () => {
  const f = fixture(), gate = defer(), entered = defer(); f.onPost = () => { entered.resolve(); return gate.promise; };
  const first = migrateHandoff(f.options); await entered.promise;
  await assert.rejects(migrateHandoff(f.options), /正在迁移/); gate.resolve(); await first;
  const pending = fixture(); pending.onPost = () => { throw new Error('lost'); };
  await assert.rejects(migrateHandoff(pending.options)); pending.onPost = undefined;
  await assert.rejects(migrateHandoff({ ...pending.options, endpoint: 'http://other.invalid' }), /切回/);
  pending.storeId = randomUUID(); await assert.rejects(migrateHandoff(pending.options), /核验/);
  pending.storage.setItem(migrationKey, 'null'); await assert.rejects(migrateHandoff(pending.options), /切回/);
  assert.ok(pending.storage.getItem(draftKey));
});

test('abort or 401 stops migration without retry and preserves the journal for explicit recovery', async () => {
  const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
  f.onRead = () => controller.abort();
  await assert.rejects(migrateHandoff(f.options), { name: 'AbortError' });
  assert.equal(f.acked, false); assert.ok(f.storage.getItem(draftKey));
  const revoked = fixture(); revoked.onPost = () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); };
  await assert.rejects(migrateHandoff(revoked.options), /unauthorized/);
  assert.equal(revoked.calls.filter(c => c.method === 'POST').length, 1); assert.equal(revoked.acked, false);
});

test('a native card created during orphan Web migration remains visible without being acknowledged', async () => {
  const f = fixture(); f.current = null;
  const newer = { ...f.handoff, id: randomUUID(), text: '另一个新任务' };
  f.onPost = () => { f.current = newer; };
  assert.deepEqual((await migrateHandoff(f.options)).handoff, newer);
  assert.equal(f.calls.some(call => call.method === 'ackMigration'), false);
});

test('failed Web cleanup resumes after native ACK and removes only the unchanged draft', async () => {
  const f = fixture(), remove = f.storage.removeItem;
  f.storage.removeItem = () => { throw new Error('storage failure'); };
  await assert.rejects(migrateHandoff(f.options), /storage failure/);
  assert.equal(f.acked, true); assert.ok(f.storage.getItem(draftKey)); assert.ok(f.storage.getItem(migrationKey));
  f.storage.removeItem = remove;
  assert.equal((await migrateHandoff(f.options)).count, 1);
  assert.equal(f.storage.getItem(draftKey), null); assert.equal(f.storage.getItem(migrationKey), null); assert.equal(f.records.size, 1);
});
