import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const secret = 'isolated-test-secret-at-least-24-characters';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await predicate()) return; await sleep(20); }
  assert.fail(message);
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function processFor(t, entry, env) {
  const child = spawn(process.execPath, [path.join(root, 'apps/relay/dist', entry)], {
    cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { logs = (logs + data).slice(-6000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  });
  return { child, logs: () => logs };
}
async function broker(t, extra = {}) {
  const listenPort = extra.MOBILE_CODEX_BROKER_PORT ? Number(extra.MOBILE_CODEX_BROKER_PORT) : await port();
  const base = `http://127.0.0.1:${listenPort}`;
  const process = await processFor(t, 'brokerServer.js', {
    MOBILE_CODEX_BROKER_HOST: '127.0.0.1', MOBILE_CODEX_BROKER_PORT: String(listenPort),
    MOBILE_CODEX_BROKER_RELAYS: JSON.stringify({ test: secret, other: secret }),
    MOBILE_CODEX_BROKER_REQUEST_TIMEOUT_MS: '1500', ...extra,
  });
  await until(async () => { try { return (await fetch(base + '/health')).ok; } catch { return false; } }, 'broker did not start: ' + process.logs());
  return { base, process };
}
async function fakeRelay(t, base, id = 'test') {
  const ws = new WebSocket(base.replace('http:', 'ws:') + `/relay/connect?relayId=${id}`, { headers: { authorization: `Bearer ${secret}` } });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  return ws;
}
async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function fullPath(t, handler, extra = {}) {
  const local = await localServer(t, handler);
  const b = await broker(t, extra);
  const tunnel = await processFor(t, 'remoteTunnelClient.js', {
    MOBILE_CODEX_BROKER_URL: b.base, MOBILE_CODEX_RELAY_ID: 'test', MOBILE_CODEX_RELAY_SECRET: secret,
    MOBILE_CODEX_LOCAL_RELAY: local, MOBILE_CODEX_TUNNEL_REQUEST_TIMEOUT_MS: '1500', MOBILE_CODEX_TUNNEL_RECONNECT_MS: '25',
  });
  await until(async () => (await (await fetch(b.base + '/health')).json()).connectedRelayCount === 1, 'tunnel did not connect: ' + tunnel.logs());
  return { ...b, tunnel };
}
function send(ws, value) { ws.send(JSON.stringify(value)); }
function legacy(id, body) { return { type: 'response', id, status: 200, headers: { 'content-type': 'text/plain' }, body }; }

test('public path delivers SSE before EOF and keeps the stream open', { timeout: 8000 }, async (t) => {
  let closed = false;
  const f = await fullPath(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: test\ndata: 第一块\n\n');
    const ping = setInterval(() => response.write(': ping\n\n'), 200);
    response.on('close', () => { closed = true; clearInterval(ping); });
  });
  const controller = new AbortController(); t.after(() => controller.abort());
  const start = Date.now();
  const response = await fetch(f.base + '/r/test/events', { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /第一块/);
  assert.ok(Date.now() - start < 1000, 'first chunk waited for the complete response');
  await sleep(1700);
  assert.equal(closed, false, 'an active stream must not use a fixed total request deadline');
  await reader.cancel(); controller.abort();
  await until(() => closed, 'stream cancellation did not reach the local HTTP request');
});

test('JSON, status and binary bytes survive the tunnel', { timeout: 8000 }, async (t) => {
  const bytes = Buffer.from([0, 255, 128, 239, 187, 191, 0, 1]);
  const f = await fullPath(t, (request, response) => {
    if (request.url === '/bytes') { response.writeHead(206, { 'content-type': 'application/octet-stream' }); response.end(bytes); }
    else { response.writeHead(201, { 'content-type': 'application/json' }); response.end(JSON.stringify({ text: '中文✓' })); }
  });
  const json = await fetch(f.base + '/r/test/json');
  assert.equal(json.status, 201); assert.deepEqual(await json.json(), { text: '中文✓' });
  const binary = await fetch(f.base + '/r/test/bytes');
  assert.equal(binary.status, 206); assert.deepEqual(Buffer.from(await binary.arrayBuffer()), bytes);
});

test('mobile cancellation aborts local fetch even before response headers', { timeout: 8000 }, async (t) => {
  let started = false, closed = false;
  const f = await fullPath(t, (_request, response) => { started = true; response.on('close', () => { closed = true; }); });
  const controller = new AbortController();
  const request = fetch(f.base + '/r/test/slow', { signal: controller.signal }).catch(() => undefined);
  await until(() => started, 'local request did not start');
  controller.abort(); await request;
  await until(() => closed, 'cancel did not abort the local fetch', 700);
});

test('relay disconnect fails pending requests immediately', { timeout: 8000 }, async (t) => {
  const b = await broker(t);
  const ws = await fakeRelay(t, b.base);
  const incoming = once(ws, 'message');
  const response = fetch(b.base + '/r/test/slow');
  await incoming; const start = Date.now(); ws.terminate();
  const result = await response;
  assert.equal(result.status, 503); assert.ok(Date.now() - start < 700);
  assert.equal((await result.json()).error, 'relay_disconnected');
});

test('a different relay cannot complete another relay request', { timeout: 8000 }, async (t) => {
  const b = await broker(t);
  const owner = await fakeRelay(t, b.base);
  const other = await fakeRelay(t, b.base, 'other');
  const incoming = once(owner, 'message');
  let settled = false;
  const response = fetch(b.base + '/r/test/private').then((value) => { settled = true; return value; });
  const request = JSON.parse((await incoming)[0].toString());
  send(other, legacy(request.id, 'forged')); await sleep(100);
  assert.equal(settled, false);
  send(owner, legacy(request.id, 'owned'));
  assert.equal(await (await response).text(), 'owned');
});

test('replaced connections fail old requests and preserve the new relay', { timeout: 8000 }, async (t) => {
  const b = await broker(t);
  const old = await fakeRelay(t, b.base);
  const incoming = once(old, 'message');
  const waiting = fetch(b.base + '/r/test/old'); await incoming;
  const fresh = await fakeRelay(t, b.base);
  assert.equal((await waiting).status, 503);
  fresh.on('message', (data) => { const message = JSON.parse(data.toString()); if (message.type === 'request') send(fresh, legacy(message.id, 'fresh')); });
  assert.equal(await (await fetch(b.base + '/r/test/new')).text(), 'fresh');
});

test('SSE routes retain CORS, authorization and listener cleanup', { timeout: 8000 }, async (t) => {
  const listeners = new Set();
  const turns = new EventEmitter();
  const snapshot = { threadId: 'test-thread', turnId: 'test-turn', status: 'inProgress', messages: [], approvals: [], eventCount: 1, messageCount: 0, thread: null, updatedAt: new Date().toISOString(), error: null };
  turns.getTurn = () => snapshot; turns.stop = async () => {};
  const desktop = {
    status: async () => ({ ok: true }), getStreamSnapshot: () => snapshot, stop: async () => {},
    onStreamSnapshot(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: secret, codexHome: '/does-not-exist-isolated-test', defaultCwd: root }, services: { desktopControl: desktop, liveTurns: turns } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  for (const [tokenPath, eventPath, kind] of [
    ['/api/desktop/threads/test-thread/stream-token', '/api/desktop/threads/test-thread/events', 'desktop'],
    ['/api/live/turns/test-turn/stream-token', '/api/live/turns/test-turn/events', 'turn'],
  ]) {
    const denied = await fetch(base + eventPath + '?streamToken=invalid'); assert.equal(denied.status, 401); await denied.text();
    const token = await (await fetch(base + tokenPath, { method: 'POST', headers: { authorization: `Bearer ${secret}` } })).json();
    const controller = new AbortController();
    const response = await fetch(base + eventPath + '?streamToken=' + token.streamToken, { signal: controller.signal, headers: { origin: 'https://localhost' } });
    t.after(() => controller.abort());
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost');
    const reader = response.body.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, new RegExp(`event: ${kind}`));
    await reader.cancel(); controller.abort();
  }
  await until(() => listeners.size === 0 && turns.listenerCount('snapshot') === 0, 'SSE listener leaked');
});

test('broker heartbeat removes a non-responsive websocket', { timeout: 8000 }, async (t) => {
  const b = await broker(t, { MOBILE_CODEX_HEARTBEAT_MS: '60' });
  const ws = new WebSocket(b.base.replace('http:', 'ws:') + '/relay/connect?relayId=test', { autoPong: false, headers: { authorization: `Bearer ${secret}` } });
  t.after(() => ws.terminate());
  await once(ws, 'open'); const closed = once(ws, 'close');
  await closed;
  await until(async () => (await (await fetch(b.base + '/health')).json()).connectedRelayCount === 0, 'dead relay remained online', 700);
});

test('request timeout sends cancellation and bounds local work', { timeout: 8000 }, async (t) => {
  let closed = false;
  const f = await fullPath(t, (_request, response) => response.on('close', () => { closed = true; }), { MOBILE_CODEX_BROKER_REQUEST_TIMEOUT_MS: '200' });
  const response = await fetch(f.base + '/r/test/timeout');
  assert.equal(response.status, 504); assert.equal((await response.json()).error, 'relay_timeout');
  await until(() => closed, 'deadline did not cancel local work', 700);
});

test('tunnel reconnects after broker restart without replaying requests', { timeout: 10000 }, async (t) => {
  let requests = 0;
  const f = await fullPath(t, (_request, response) => { requests++; response.end('ok'); });
  assert.equal(await (await fetch(f.base + '/r/test/once', { method: 'POST' })).text(), 'ok');
  const exited = once(f.process.child, 'exit'); f.process.child.kill('SIGTERM'); await exited;
  const replacement = await broker(t, { MOBILE_CODEX_BROKER_PORT: new URL(f.base).port });
  await until(async () => (await (await fetch(replacement.base + '/health')).json()).connectedRelayCount === 1, 'tunnel failed to reconnect');
  assert.equal(requests, 1, 'a non-idempotent request was replayed');
  assert.equal(await (await fetch(f.base + '/r/test/new')).text(), 'ok'); assert.equal(requests, 2);
});

test('slow consumers are bounded and do not block another request', { timeout: 8000 }, async (t) => {
  let produced = 0, closed = false;
  const f = await fullPath(t, (request, response) => {
    if (request.url !== '/big') { response.end('independent'); return; }
    const chunk = Buffer.alloc(32 * 1024, 65);
    const produce = () => {
      while (!response.destroyed && produced < 512 * 1024 * 1024) {
        produced += chunk.length; if (!response.write(chunk)) { response.once('drain', produce); return; }
      }
    };
    response.on('close', () => { closed = true; }); produce();
  });
  const controller = new AbortController(); t.after(() => controller.abort());
  const large = await fetch(f.base + '/r/test/big', { signal: controller.signal });
  await sleep(250); const start = Date.now();
  assert.equal(await (await fetch(f.base + '/r/test/small')).text(), 'independent');
  assert.ok(Date.now() - start < 1000);
  assert.ok(produced < 32 * 1024 * 1024, `slow reader buffered too much: ${produced}`);
  await large.body.cancel(); controller.abort(); await until(() => closed, 'slow consumer cancellation leaked local work');
});

test('new tunnel answers a legacy broker with the old response shape', { timeout: 8000 }, async (t) => {
  const local = await localServer(t, (_request, response) => { response.setHeader('content-type', 'application/json'); response.end('{"legacy":true}'); });
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  t.after(() => { for (const socket of wss.clients) socket.terminate(); wss.close(); server.close(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const incoming = once(wss, 'connection');
  await processFor(t, 'remoteTunnelClient.js', { MOBILE_CODEX_BROKER_URL: `http://127.0.0.1:${server.address().port}`, MOBILE_CODEX_RELAY_ID: 'test', MOBILE_CODEX_RELAY_SECRET: secret, MOBILE_CODEX_LOCAL_RELAY: local });
  const [socket] = await incoming;
  const response = once(socket, 'message');
  send(socket, { type: 'request', id: 'old-request', method: 'GET', path: '/json', headers: {}, body: null });
  const frame = JSON.parse((await response)[0].toString());
  assert.equal(frame.type, 'response'); assert.equal(frame.status, 200); assert.deepEqual(JSON.parse(frame.body), { legacy: true });
});

test('per-relay admission limit rejects excess work promptly', { timeout: 8000 }, async (t) => {
  const b = await broker(t);
  const ws = await fakeRelay(t, b.base);
  let requests = 0;
  ws.on('message', (data) => { if (JSON.parse(data.toString()).type === 'request') requests++; });
  const admitted = Array.from({ length: 32 }, (_, i) => fetch(b.base + '/r/test/pending-' + i));
  await until(() => requests === 32, 'requests did not reach the relay');
  const rejected = await fetch(b.base + '/r/test/excess');
  assert.equal(rejected.status, 503); assert.equal((await rejected.json()).error, 'relay_busy');
  ws.terminate();
  for (const response of await Promise.all(admitted)) { assert.equal(response.status, 503); await response.text(); }
});

test('tunnel heartbeat reconnects when the broker stops responding to pings', { timeout: 8000 }, async (t) => {
  const server = http.createServer();
  const wss = new WebSocketServer({ server, autoPong: false });
  t.after(() => { for (const socket of wss.clients) socket.terminate(); wss.close(); server.close(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let connections = 0;
  wss.on('connection', () => { connections++; });
  await processFor(t, 'remoteTunnelClient.js', { MOBILE_CODEX_BROKER_URL: `http://127.0.0.1:${server.address().port}`, MOBILE_CODEX_RELAY_ID: 'test', MOBILE_CODEX_RELAY_SECRET: secret, MOBILE_CODEX_LOCAL_RELAY: 'http://127.0.0.1:1', MOBILE_CODEX_HEARTBEAT_MS: '60', MOBILE_CODEX_TUNNEL_RECONNECT_MS: '10' });
  await until(() => connections >= 2, 'tunnel retained a dead OPEN websocket', 1000);
});
