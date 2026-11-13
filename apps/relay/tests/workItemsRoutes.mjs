import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { WorkItemStore } from '../dist/workItems/store.js';

const mutation = expectedRevision => ({ mutationId: randomUUID(), expectedRevision });
const creation = () => ({ uid: randomUUID(), ...mutation(0), kind: 'task', title: '测试事项', detail: '私密正文不得进入SSE', assets: [], codeRefs: [] });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function within(promise, ms = 1000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`deadline ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'work-item-route-'));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'admin-fixture', codexHome: path.join(root, 'empty'), defaultCwd: root },
    services: { store: { close() {} }, live: { stop: async () => {} }, liveTurns: { stop: async () => {} },
      desktopControl: { stop: async () => {}, messageQueue: { stop: async () => {}, revoke: async () => {} } }, agentGateway: { stop: async () => {} } } });
  const controllers = [];
  t.after(async () => { controllers.forEach(c => c.abort()); app.server.closeAllConnections(); await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = (method, url, payload, token = 'admin-fixture') => app.inject({ method, url, ...(payload !== undefined ? { payload } : {}), headers: { authorization: `Bearer ${token}` } });
  const pair = async () => {
    const { code } = (await request('POST', '/api/pairing')).json();
    return (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code, name: 'fixture' } })).json();
  };
  const stream = async (base, token) => {
    const ticket = (await request('POST', '/api/work-items/stream-token', {}, token)).json().streamToken;
    const url = `/api/work-items/events?streamToken=${ticket}`, controller = new AbortController(); controllers.push(controller);
    const response = await fetch(base + url, { signal: controller.signal }); assert.equal(response.status, 200);
    const reader = response.body.getReader(), first = await reader.read();
    const stream = { text: Buffer.from(first.value).toString(), closed: false, url };
    stream.done = (async () => {
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; stream.text += Buffer.from(chunk.value).toString(); } }
      catch { /* revoked or closed HTTP stream */ } finally { stream.closed = true; }
    })();
    return stream;
  };
  return { root, app, request, pair, stream };
}

test('work-item API is lazy and authenticated; only verify can complete, all paired devices share items', async t => {
  const f = await fixture(t), a = await f.pair(), b = await f.pair();
  await assert.rejects(fs.stat(path.join(f.root, '.mobile-codex/work-items.json')), { code: 'ENOENT' });
  assert.equal((await f.app.inject('/api/work-items')).statusCode, 401);
  const body = creation();
  let response = await f.request('POST', '/api/work-items', body, a.token);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().item.createdByDeviceId, a.device.id);
  assert.equal((await f.request('GET', '/api/work-items', undefined, b.token)).json().items[0].uid, body.uid);
  assert.equal((await f.request('POST', '/api/work-items', { ...creation(), state: 'done' })).statusCode, 400);
  for (const extra of [{ state: 'done' }, { currentAttempt: {} }, { actor: 'system' }, { source: {} }]) {
    assert.equal((await f.request('PATCH', `/api/work-items/${body.uid}`, { ...mutation(1), ...extra })).statusCode, 400);
  }
  assert.equal((await f.request('POST', `/api/work-items/${body.uid}/actions`, { ...mutation(1), action: 'complete' })).statusCode, 400);
  assert.equal((await f.request('POST', `/api/work-items/${body.uid}/verify`, { ...mutation(1), decision: 'accept' })).statusCode, 409);
  for (const method of ['apply-turn-result', 'record-delivery', 'agent-result']) assert.equal((await f.request('POST', `/api/work-items/${body.uid}/${method}`, {})).statusCode, 404);
  response = await f.request('POST', `/api/work-items/${body.uid}/actions`, { ...mutation(1), action: 'start' }, b.token); assert.equal(response.json().item.state, 'in_progress');
  assert.equal((await f.request('POST', `/api/work-items/${body.uid}/actions`, { ...mutation(2), action: 'return' })).statusCode, 400);
  response = await f.request('POST', `/api/work-items/${body.uid}/actions`, { ...mutation(2), action: 'review' }, a.token); assert.equal(response.json().item.state, 'to_verify');
  response = await f.request('POST', `/api/work-items/${body.uid}/verify`, { ...mutation(3), decision: 'accept' }, b.token); assert.equal(response.json().item.state, 'done');
  const attemptId = response.json().item.currentAttempt.attemptId;
  response = await f.request('POST', `/api/work-items/${body.uid}/actions`, { ...mutation(4), action: 'reopen' }, a.token);
  assert.equal(response.json().item.state, 'todo'); assert.notEqual(response.json().item.currentAttempt.attemptId, attemptId);
  assert.equal((await f.request('GET', '/api/work-items?state=done')).json().items.length, 0);
});

test('SSE reset/change has no body; revoke closes every item stream within 1s and other owners continue', { timeout: 10000 }, async t => {
  const f = await fixture(t), a = await f.pair(), b = await f.pair(), base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const revoked = [await f.stream(base, a.token), await f.stream(base, a.token)];
  const other = [await f.stream(base, b.token), await f.stream(base, 'admin-fixture')];
  assert.match(revoked[0].text, /event: work-items.reset/);
  const body = creation(); await f.request('POST', '/api/work-items', body, b.token);
  await within((async () => { while ([...revoked, ...other].some(s => !s.text.includes(body.uid))) await new Promise(r => setTimeout(r, 5)); })());
  assert.equal(revoked[0].text.includes(body.detail), false);
  assert.match(revoked[0].text, /event: work-item.changed\ndata: \{"uid":/);
  assert.equal((await f.request('DELETE', `/api/devices/${a.device.id}`)).statusCode, 200);
  await within(Promise.all(revoked.map(s => s.done)));
  for (const url of ['/api/work-items', `/api/work-items/${body.uid}`, ...revoked.map(s => s.url)]) assert.equal((await f.request('GET', url, undefined, a.token)).statusCode, 401);
  for (const [url, payload] of [['/api/work-items', creation()], ['/api/work-items/stream-token', {}], ['/api/work-items/import-handoff', {}],
    [`/api/work-items/${body.uid}/actions`, { ...mutation(1), action: 'start' }], [`/api/work-items/${body.uid}/verify`, { ...mutation(1), decision: 'accept' }]]) {
    assert.equal((await f.request('POST', url, payload, a.token)).statusCode, 401);
  }
  const next = creation(); await f.request('POST', '/api/work-items', next);
  await within((async () => { while (other.some(s => !s.text.includes(next.uid))) await new Promise(r => setTimeout(r, 5)); })());
  assert.ok(other.every(s => !s.closed)); assert.ok(revoked.every(s => !s.text.includes(next.uid)));
});

test('revoked in-flight write returns 401 and cannot commit after its disk wait', { timeout: 5000 }, async t => {
  const f = await fixture(t), a = await f.pair(), gate = defer(), entered = defer();
  t.after(() => gate.resolve());
  await f.request('GET', '/api/work-items');
  const original = WorkItemStore.prototype.atomic;
  t.mock.method(WorkItemStore.prototype, 'atomic', async function(file, content, guard) {
    if (file === this.file) { entered.resolve(); await gate.promise; }
    return original.call(this, file, content, guard);
  });
  const body = creation(), pending = f.request('POST', '/api/work-items', body, a.token).then(r => r);
  await entered.promise;
  await f.request('DELETE', `/api/devices/${a.device.id}`);
  gate.resolve(); const response = await pending;
  assert.equal(response.statusCode, 401); assert.deepEqual(response.json(), { error: 'unauthorized' });
  assert.equal((await f.request('GET', '/api/work-items')).json().items.length, 0);
  assert.equal((await f.request('GET', `/api/work-items/${body.uid}`)).statusCode, 404);
});

test('corrupt item store returns scoped 503 while device auth and public health stay available', async t => {
  const f = await fixture(t); await f.pair();
  const file = path.join(f.root, '.mobile-codex/work-items.json'); await fs.writeFile(file, '{corrupted');
  const response = await f.request('GET', '/api/work-items');
  assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { error: 'work_item_store_unavailable' });
  assert.equal((await f.app.inject('/health')).statusCode, 200);
  assert.equal(await fs.readFile(file, 'utf8'), '{corrupted');
});

test('import REST uses store identity, strict schema and stable receipts; oversized payloads are 413', async t => {
  const f = await fixture(t), info = (await f.request('GET', '/api/work-items')).json();
  const packet = { storeId: info.storeId, scope: 'fixture', handoff: { revision: 1, id: randomUUID(), status: 'draft', text: '迁移', createdAt: 1 }, draft: null };
  const response = await f.request('POST', '/api/work-items/import-handoff', packet);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual((await f.request('POST', '/api/work-items/import-handoff', packet)).json(), response.json());
  const item = (await f.request('GET', `/api/work-items/${response.json().imports[0].uid}`)).json().item;
  assert.equal(item.state, 'todo'); assert.equal(item.source.legacyId, packet.handoff.id);
  assert.equal((await f.request('POST', '/api/work-items/import-handoff', { ...packet, handoff: { ...packet.handoff, state: 'done' } })).statusCode, 400);
  assert.equal((await f.request('POST', '/api/work-items/import-handoff', { ...packet, storeId: randomUUID() })).statusCode, 409);
  assert.equal((await f.request('POST', '/api/work-items', { ...creation(), detail: 'x'.repeat(256 * 1024) })).statusCode, 413);
  assert.equal((await f.request('GET', '/api/work-items?cursor=invalid')).statusCode, 400);
});
