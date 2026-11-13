import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DesktopControl } from '../dist/desktop/desktopControl.js';
import { DesktopIpcClient } from '../dist/desktop/desktopIpcClient.js';
import { createDesktopThreadLoader } from '../dist/desktop/desktopThreadLoader.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const id = '11111111-1111-4111-8111-111111111111';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = value => { const body = Buffer.from(JSON.stringify(value)), head = Buffer.alloc(4); head.writeUInt32LE(body.length); return Buffer.concat([head, body]); };
async function until(predicate) { const end = Date.now() + 1800; while (!predicate()) { if (Date.now() >= end) assert.fail('recovery condition timed out'); await delay(5); } }

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcr-')), pipePath = path.join(root, 'ipc.sock');
  const sockets = new Set();
  const f = { root, loaded: false, loads: 0, discoveries: 0, writes: [], snapshots: true, discovery: 'missing', revision: 0 };
  const state = { id, hostId: 'local', cwd: '/synthetic/project', requests: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: {}, islands: [] } } };
  f.snapshot = () => f.socket?.write(frame({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner', params: { conversationId: id, hostId: 'local', change: { type: 'snapshot', revision: ++f.revision, conversationState: state } } }));
  const server = net.createServer(socket => {
    f.socket = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const size = buffer.readUInt32LE(0), m = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
        const reply = (result, extra = {}) => socket.write(frame({ type: 'response', requestId: m.requestId, method: m.method, resultType: 'success', handledByClientId: 'owner', result, ...extra }));
        if (m.type === 'request' && m.method === 'initialize') reply({ clientId: 'recovery-fixture' });
        else if (m.type === 'request' && m.method === 'thread-owner-discovery') {
          f.discoveries++;
          if (f.loaded) reply({});
          else if (f.discovery === 'missing') reply(null, { resultType: 'error', error: 'no-client-found' });
          else if (f.discovery === 'invalid') reply({}, { method: 'wrong-method' });
          else if (f.discovery === 'disconnect') socket.destroy();
        } else if (m.type === 'broadcast' && m.params.following && f.snapshots) f.snapshot();
        else if (m.type === 'request') { f.writes.push(m); reply(null, { resultType: 'error', error: 'fixture-does-not-run-models' }); }
      }
    });
  });
  server.listen(pipePath); await once(server, 'listening');
  const client = new DesktopIpcClient({ clientType: 'recovery-fixture', pipePath, requestTimeoutMs: 40 });
  const store = { getThreadSummary: async () => null, getActiveDesktopThread: async () => null };
  f.control = new DesktopControl(store, { client, transport: 'native', loadThread: async (...args) => { f.loads++; if (options.load) await options.load(f, ...args); else f.loaded = true; } });
  f.capability = () => f.control.getStreamSnapshot(id)?.control;
  t.after(async () => { await f.control.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { force: true, recursive: true }); });
  return f;
}

test('cold viewed thread loads once then gets a real owner and snapshot; concurrent views share recovery', async t => {
  const f = await fixture(t);
  const a = f.control.followThread(id, { allowLoad: true }), b = f.control.followThread(id, { allowLoad: true });
  await until(() => f.capability()?.canSend);
  assert.equal(f.loads, 1); assert.equal(f.discoveries, 2); assert.equal(f.writes.length, 0);
  assert.equal(f.control.getFollowStatus(id).state, 'ready');
  a(); assert.ok(f.capability().token); b(); assert.equal(f.capability().token, null);
});

test('owner discovery timeout can recover a cold viewed thread without sending a model request', async t => {
  const f = await fixture(t); f.discovery = 'timeout';
  f.control.followThread(id, { allowLoad: true });
  await until(() => f.capability()?.canSend);
  assert.equal(f.loads, 1); assert.equal(f.writes.length, 0);
});

test('already loaded threads and passive queue subscriptions never open a desktop view', async t => {
  const f = await fixture(t); f.loaded = true;
  f.control.followThread(id, { allowLoad: true }); await until(() => f.capability()?.canSend);
  assert.equal(f.loads, 0);
  const cold = await fixture(t); cold.control.followThread(id);
  await until(() => cold.discoveries > 0); await delay(80);
  assert.equal(cold.loads, 0); assert.equal(cold.capability()?.canSend ?? false, false);
});

test('opening success alone never grants a token or send capability', async t => {
  const f = await fixture(t); f.snapshots = false;
  f.control.followThread(id, { allowLoad: true });
  await until(() => f.discoveries === 2); await delay(30);
  assert.equal(f.loads, 1); assert.equal(f.capability()?.token ?? null, null);
  assert.equal(f.control.getFollowStatus(id).state, 'waiting-snapshot');
});

test('loader failure stays unavailable and does not repeatedly open during retries', async t => {
  const f = await fixture(t, { load: async () => { throw Error('sensitive path'); } });
  f.control.followThread(id, { allowLoad: true });
  await until(() => f.loads === 1); await until(() => f.discoveries >= 2);
  assert.equal(f.loads, 1); assert.equal(f.control.getFollowStatus(id).state, 'unavailable');
  assert.equal(f.control.getFollowStatus(id).errorCode, 'desktop_thread_load_failed');
  assert.equal(f.capability()?.canSend ?? false, false); assert.equal(f.writes.length, 0);
});

test('release while discovery is pending prevents a later desktop load', async t => {
  const f = await fixture(t); f.discovery = 'timeout';
  const release = f.control.followThread(id, { allowLoad: true });
  await until(() => f.discoveries > 0); release(); await delay(80);
  assert.equal(f.loads, 0); assert.equal(f.control.getFollowStatus(id), null);
});

test('release or stop during loading prevents stale discovery/follow from resurrecting control', async t => {
  let finish;
  const f = await fixture(t, { load: async (f, threadId, stillNeeded) => { assert.equal(threadId, id); await new Promise(resolve => { finish = resolve; }); assert.equal(stillNeeded(), false); f.loaded = true; } });
  const release = f.control.followThread(id, { allowLoad: true }); await until(() => f.loads === 1);
  release(); await f.control.stop(); finish(); await delay(30);
  assert.equal(f.discoveries, 1); assert.equal(f.capability()?.token ?? null, null);
});

test('invalid discovery response and lost IPC do not open a desktop view', async t => {
  for (const discovery of ['invalid', 'disconnect']) {
    const f = await fixture(t); f.discovery = discovery;
    f.control.followThread(id, { allowLoad: true }); await until(() => f.discoveries > 0); await delay(70);
    assert.equal(f.loads, 0); assert.equal(f.capability()?.token ?? null, null);
  }
});

test('HTTP connection checks stay passive; only an authenticated conversation stream enables recovery', async t => {
  const f = await fixture(t);
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-recovery-admin', codexHome: f.root, defaultCwd: f.root, desktopTransport: 'native' }, services: { desktopControl: f.control } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  const base = await app.listen({ host: '127.0.0.1', port: 0 }), headers = { authorization: 'Bearer synthetic-recovery-admin' };
  assert.equal((await app.inject({ url: '/api/connection', headers })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/desktop/control/health', headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/desktop/threads/${id}/events` })).statusCode, 401);
  assert.equal(f.loads, 0);
  const { streamToken } = (await app.inject({ method: 'POST', url: `/api/desktop/threads/${id}/stream-token`, headers })).json();
  const controller = new AbortController();
  const response = await fetch(`${base}/api/desktop/threads/${id}/events?streamToken=${streamToken}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  try { await until(() => f.capability()?.canSend); assert.equal(f.loads, 1); }
  finally { controller.abort(); await response.body.cancel().catch(() => {}); }
  await until(() => f.control.getFollowStatus(id) === null);
});

test('recovery never clears an unknown message submission or replays a write', async t => {
  const f = await fixture(t);
  let release = f.control.followThread(id, { allowLoad: true }); await until(() => f.capability()?.canSend);
  const oldToken = f.capability().token;
  const result = await f.control.sendMessage({ threadId: id, message: 'synthetic unknown input', clientMessageId: randomUUID(), controlToken: oldToken, expectedTurnId: null });
  assert.equal(result.delivery, 'uncertain'); release(); f.loaded = false;
  release = f.control.followThread(id, { allowLoad: true }); await until(() => f.capability()?.token && f.capability().token !== oldToken);
  assert.equal(f.capability().canSend, false); assert.equal(f.capability().submission.delivery, 'uncertain');
  assert.equal(f.writes.length, 1); release();
});

test('loader validates platform, UUID and an existing local thread before opening its exact URL', async () => {
  const opened = [], read = [];
  const store = { getThreadSummary: async value => { read.push(value); return value === id ? { id } : null; } };
  const load = createDesktopThreadLoader(store, { platform: 'darwin', open: async url => { opened.push(url); } });
  await assert.rejects(load('new?prompt=evil', () => true), /unavailable/);
  await assert.rejects(load('22222222-2222-4222-8222-222222222222', () => true), /unavailable/);
  await assert.rejects(createDesktopThreadLoader(store, { platform: 'linux' })(id, () => true), /unavailable/);
  assert.equal(read.length, 1); assert.deepEqual(opened, []);
  await load(id, () => true);
  assert.deepEqual(opened, [`codex://threads/${id}`]);
});

test('loader coalesces views, retains a new viewer when the original leaves, and throttles reopening', async () => {
  let finish, active = true, opens = 0, now = 0;
  const load = createDesktopThreadLoader({ getThreadSummary: async () => { await new Promise(resolve => { finish = resolve; }); return { id }; } }, { platform: 'darwin', open: async () => { opens++; }, now: () => now });
  const first = load(id, () => active); await until(() => finish); active = false;
  const second = load(id, () => true); finish(); await Promise.all([first, second]);
  assert.equal(opens, 1); await assert.rejects(load(id, () => true), /throttled/);
  now = 60000; finish = null;
  const later = load(id, () => true); await until(() => finish); finish(); await later;
  assert.equal(opens, 2);
});

test('loader cancels stale work before and after metadata reads and bounds failed-open retry', async () => {
  let active = true, finish, reads = 0, opens = 0;
  const load = createDesktopThreadLoader({ getThreadSummary: async () => { reads++; await new Promise(resolve => { finish = resolve; }); return { id }; } }, { platform: 'darwin', open: async () => { opens++; throw Error('private upstream details'); } });
  await load(id, () => false); assert.equal(reads, 0);
  const pending = load(id, () => active); await until(() => finish); active = false; finish(); await pending;
  assert.equal(opens, 0);
  finish = null; const failure = load(id, () => true); const rejected = assert.rejects(failure); await until(() => finish); finish(); await rejected;
  await assert.rejects(load(id, () => true), /throttled/); assert.equal(opens, 1);
});
