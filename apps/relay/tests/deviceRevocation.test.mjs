import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { DeviceRegistry } from '../dist/server/devices.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function within(promise, ms = 1000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`deadline ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(t, { cleanup, watch } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'device-revoke-'));
  const turns = new EventEmitter(), desktop = new EventEmitter(), agent = new EventEmitter();
  const turn = { turnId: 'turn', threadId: 'thread', status: 'inProgress', messages: [] };
  Object.assign(turns, { stop: async () => {}, getTurn: () => turn });
  const snapshot = { threadId: 'thread', messages: [], connected: true };
  const agentSnapshot = { agentId: 'fixture', session: { id: 'session', directory: root }, messages: [], connected: true };
  const adapter = { validSessionId: () => true, watchSession: async (_id, publish) => {
    agent.on('snapshot', publish); publish(agentSnapshot);
    await watch?.();
    return () => agent.off('snapshot', publish);
  } };
  const app = await createRelayServer({ logger: false,
    config: { host: '127.0.0.1', port: 0, token: 'admin-fixture', codexHome: path.join(root, 'empty'), defaultCwd: root },
    services: { store: { close() {}, readThreadDelta: async (_id, cursor) => ({ messages: [], cursor: cursor + 1, generation: 'fixture' }) }, liveTurns: turns, desktopControl: { stop: async () => {}, status: async () => ({}),
      messageQueue: { stop: async () => {}, revoke: cleanup ?? (async () => {}) },
      getStreamSnapshot: () => snapshot,
      onStreamSnapshot: listener => { desktop.on('snapshot', listener); return () => desktop.off('snapshot', listener); },
    }, agentGateway: { sessions: () => adapter, stop: async () => {} } },
  });
  const controllers = [];
  t.after(async () => { controllers.forEach(c => c.abort()); app.server.closeAllConnections(); await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const auth = token => ({ authorization: `Bearer ${token}` });
  const pair = async () => {
    const code = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth('admin-fixture') })).json().code;
    return (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code, name: 'fixture' } })).json();
  };
  const routes = ['/api/live/turns/turn', '/api/desktop/threads/thread', '/api/agents/fixture/sessions/session', '/api/work-items'];
  async function ticket(route, token) {
    const result = await app.inject({ method: 'POST', url: `${route}/stream-token`, headers: auth(token), payload: {} });
    assert.equal(result.statusCode, 200, result.body);
    return `${route}/events?streamToken=${result.json().streamToken}${route.includes("/desktop/") ? "&cursor=0" : ""}`;
  }
  async function open(base, route, token) {
    const url = await ticket(route, token), controller = new AbortController(); controllers.push(controller);
    const response = await fetch(base + url, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const first = await reader.read(); assert.equal(first.done, false);
    const stream = { url, frames: 1, closed: false };
    stream.done = (async () => { try { while (!(await reader.read()).done) stream.frames++; } catch { /* destroyed HTTP streams may reject */ } finally { stream.closed = true; } })();
    return stream;
  }
  return { app, pair, auth, routes, ticket, open, turns, desktop, agent, publish: async () => {
    turns.emit('snapshot', { ...turn, status: 'completed' }); desktop.emit('snapshot', snapshot); agent.emit('snapshot', agentSnapshot);
    const changed = await app.inject({ method: 'POST', url: '/api/work-items', headers: auth('admin-fixture'), payload: {
      uid: randomUUID(), mutationId: randomUUID(), expectedRevision: 0, kind: 'task', title: '隔离测试事项', detail: '', assets: [], codeRefs: [],
    } });
    assert.equal(changed.statusCode, 200, changed.body);
  } };
}

test('all SSE families close within 1s before slow revoke cleanup; other device and admin keep streaming', { timeout: 10000 }, async t => {
  const cleanup = deferred(); t.after(() => cleanup.resolve());
  const f = await fixture(t, { cleanup: () => cleanup.promise });
  const a = await f.pair(), b = await f.pair();
  const base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const revoked = [], unaffected = [];
  for (const route of f.routes) {
    revoked.push(await f.open(base, route, a.token));
    unaffected.push(await f.open(base, route, b.token), await f.open(base, route, 'admin-fixture'));
  }
  let completed = false;
  const deletion = fetch(`${base}/api/devices/${a.device.id}`, { method: 'DELETE', headers: f.auth('admin-fixture') }).then(r => { completed = true; return r; });
  await within(Promise.all(revoked.map(s => s.done)));
  assert.equal(completed, false, 'queue cleanup remains pending');
  for (const url of ['/health', '/api/connection', ...revoked.map(s => s.url)]) {
    assert.equal((await fetch(base + url, { headers: f.auth(a.token) })).status, 401);
  }
  for (const route of f.routes) assert.equal((await f.app.inject({ method: 'POST', url: `${route}/stream-token`, headers: f.auth(a.token), payload: {} })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/pairing/consume', headers: f.auth(a.token), payload: {} })).statusCode, 401);
  assert.equal((await fetch(base + '/health')).status, 200, 'anonymous health stays public');
  const frames = unaffected.map(s => s.frames);
  await f.publish();
  await within((async () => { while (unaffected.some((s, i) => s.frames <= frames[i])) await new Promise(r => setTimeout(r, 5)); })());
  assert.ok(unaffected.every(s => !s.closed));
  assert.equal(f.turns.listenerCount('snapshot'), 2);
  assert.equal(f.desktop.listenerCount('snapshot'), 2);
  assert.equal(f.agent.listenerCount('snapshot'), 2);
  cleanup.resolve(); assert.equal((await deletion).status, 200);
  for (const token of [b.token, 'admin-fixture']) assert.equal((await fetch(base + '/api/connection', { headers: f.auth(token) })).status, 200);
});

test('revoke while Agent first frame subscription is pending returns 401 and releases late unsubscribe', { timeout: 5000 }, async t => {
  const gate = deferred(), entered = deferred(); t.after(() => gate.resolve());
  const f = await fixture(t, { watch: () => { entered.resolve(); return gate.promise; } });
  const a = await f.pair();
  const base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const url = await f.ticket(f.routes[2], a.token);
  const opening = fetch(base + url);
  await entered.promise;
  await f.app.inject({ method: 'DELETE', url: `/api/devices/${a.device.id}`, headers: f.auth('admin-fixture') });
  const result = await within(opening);
  assert.equal(result.status, 401); assert.deepEqual(await result.json(), { error: 'unauthorized' });
  gate.resolve();
  await within((async () => { while (f.agent.listenerCount('snapshot')) await new Promise(r => setTimeout(r, 5)); })());
});

for (const kind of ['json', 'binary', 'error']) test(`late ${kind} response becomes 401, without leaking payload`, { timeout: 5000 }, async t => {
  const gate = deferred(), entered = deferred(); t.after(() => gate.resolve());
  const f = await fixture(t);
  f.app.get('/api/slow', async (_request, reply) => {
    entered.resolve(); await gate.promise;
    if (kind === 'error') throw new Error('private-result');
    if (kind === 'binary') return reply.type('image/png').header('content-length', 14).send(Buffer.from('private-result'));
    return { secret: 'private-result' };
  });
  const a = await f.pair();
  const pending = f.app.inject({ url: '/api/slow', headers: f.auth(a.token) }).then(r => r);
  await entered.promise;
  await f.app.inject({ method: 'DELETE', url: `/api/devices/${a.device.id}`, headers: f.auth('admin-fixture') });
  gate.resolve();
  const response = await pending;
  assert.equal(response.statusCode, 401); assert.deepEqual(response.json(), { error: 'unauthorized' });
  assert.match(response.headers['content-type'], /application\/json/);
  assert.equal(response.headers['content-length'], String(Buffer.byteLength(response.body)));
});

test('registry blocks revoked credentials immediately and stays closed if persistence fails', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'device-revoke-registry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = await DeviceRegistry.open(path.join(root, 'devices.json'));
  const a = await registry.pair(registry.createPairing().code, 'fixture');
  const gate = deferred();
  t.mock.method(registry, 'persist', async () => { await gate.promise; throw new Error('disk unavailable'); });
  const revoked = registry.revoke(a.device.id);
  assert.equal(registry.authenticate(a.token), null); assert.equal(registry.has(a.device.id), false); assert.equal(registry.has('admin'), true);
  gate.resolve(); await assert.rejects(revoked, /disk unavailable/);
  assert.equal(registry.authenticate(a.token), null);
});

test('request authenticated before revoke cannot enter its handler after parsing completes', { timeout: 5000 }, async t => {
  const gate = deferred(), entered = deferred(); t.after(() => gate.resolve());
  const f = await fixture(t);
  let calls = 0;
  f.app.addHook('preValidation', async request => { if (request.url === '/api/slow-post') { entered.resolve(); await gate.promise; } });
  f.app.post('/api/slow-post', async () => { calls++; return { ok: true }; });
  const a = await f.pair();
  const pending = f.app.inject({ method: 'POST', url: '/api/slow-post', headers: f.auth(a.token), payload: {} }).then(r => r);
  await entered.promise;
  await f.app.inject({ method: 'DELETE', url: `/api/devices/${a.device.id}`, headers: f.auth('admin-fixture') });
  gate.resolve();
  assert.equal((await pending).statusCode, 401); assert.equal(calls, 0);
});
