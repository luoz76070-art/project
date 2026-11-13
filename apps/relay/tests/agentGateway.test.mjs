import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { LocalAppServerClient } from '../dist/codex/localAppServerClient.js';
import { AgentGateway, CodexExistingServerAdapter } from '../dist/agents/agentGateway.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

async function fixture(t, mode = 'normal', timeoutMs = 1500) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-'));
  const socketPath = path.join(root, 's.sock');
  const modes = Array.isArray(mode) ? [...mode] : [mode];
  const requests = [], connections = [], timers = new Set(), rawSockets = new Set();
  const server = http.createServer((request, response) => { response.writeHead(426); response.end(); });
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, autoPong: mode !== 'no-pong' });
  let attempts = 0;
  server.on('connection', socket => {
    rawSockets.add(socket);
    socket.on('close', () => rawSockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    attempts++;
    const currentMode = modes.length > 1 ? modes.shift() : modes[0];
    if (currentMode === 'hang-handshake') return;
    if (currentMode === 'reject-handshake') {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      connections.push(ws);
      ws.on('error', () => {});
      const reply = (id, result) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, result })); };
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString());
        requests.push(message);
        if (message.method === 'initialize') {
          if (currentMode === 'silent') return;
          if (currentMode === 'malformed') return ws.send('not JSON');
          if (currentMode === 'binary') return ws.send(Buffer.from('{}'));
          if (currentMode === 'invalid-utf8') return ws.send(Buffer.from([0xff]), { binary: false });
          if (currentMode === 'oversize') {
            ws.send('x'.repeat(2 * 1024 * 1024), { fin: false });
            ws.send('x'.repeat(2 * 1024 * 1024 + 1), { fin: true });
            return;
          }
          if (currentMode === 'late') {
            const timer = setTimeout(() => { timers.delete(timer); reply(message.id, { userAgent: 'synthetic' }); }, 200);
            timers.add(timer);
            return;
          }
          if (currentMode === 'split') {
            const frame = Buffer.from(JSON.stringify({ id: message.id, result: { userAgent: 'synthetic 📱 中文' } }));
            const cut = frame.indexOf(Buffer.from('📱')) + 1;
            ws.send(frame.subarray(0, cut), { binary: false, fin: false });
            ws.send(frame.subarray(cut), { binary: false, fin: true });
            return;
          }
          reply(message.id, currentMode === 'bad-initialize' ? {} : { userAgent: 'synthetic' });
        }
        if (message.method === 'thread/loaded/list') {
          if (currentMode === 'hang-loaded') return;
          if (currentMode === 'disconnect') return ws.terminate();
          if (currentMode === 'reject') return ws.send(JSON.stringify({ id: message.id, error: { code: -32601, message: 'synthetic private server error' } }));
          if (currentMode === 'bad-loaded') return reply(message.id, { data: [{}], nextCursor: null });
          ws.send(JSON.stringify({ method: 'item/commandExecution/requestApproval', id: 'not-our-request', params: { command: 'synthetic private command' } }));
          reply('unrelated-response', {});
          reply(message.id, { data: ['synthetic-private-thread-id'], nextCursor: currentMode === 'paged' ? 'synthetic-cursor' : null });
        }
      });
    });
  });
  const client = new LocalAppServerClient({ socketPath, timeoutMs, heartbeatMs: 50 });
  t.after(async () => {
    await client.stop();
    for (const timer of timers) clearTimeout(timer);
    for (const ws of connections) ws.terminate();
    for (const socket of rawSockets) socket.destroy();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => wss.close(resolve))]);
    await fs.rm(root, { recursive: true, force: true });
  });
  server.listen(socketPath);
  await once(server, 'listening');
  return { client, root, socketPath, connections, requests, attempts: () => attempts };
}

async function until(check) {
  const deadline = Date.now() + 2000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Synthetic socket did not reach the expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('concurrent initialization uses one Unix WebSocket and reassembles split UTF-8 frames', async t => {
  const f = await fixture(t, 'split');
  assert.equal(f.connections.length, 0);
  await Promise.all(Array.from({ length: 12 }, () => f.client.connect()));
  assert.equal(f.connections.length, 1);
  assert.deepEqual(await f.client.loadedThreadSummary(), { count: 1, hasMore: false });
  await f.client.stop();
  assert.deepEqual(f.requests.map(request => request.method), ['initialize', 'initialized', 'thread/loaded/list']);
  assert.equal(f.requests[0].params.capabilities.experimentalApi, false);
  assert.deepEqual(f.requests[2].params, { limit: 100 });
  await until(() => f.connections.every(ws => ws.readyState === WebSocket.CLOSED));
  // Closing the probe must not shut down the daemon it connected to.
  await f.client.connect();
  assert.equal(f.connections.length, 2);
});

test('metadata reports a bounded page rather than claiming a total session count', async t => {
  const { client } = await fixture(t, 'paged');
  await client.connect();
  assert.deepEqual(await client.loadedThreadSummary(), { count: 1, hasMore: true });
});

for (const [mode, code] of [
  ['malformed', 'CODEX_SOCKET_PROTOCOL_ERROR'], ['bad-initialize', 'CODEX_SOCKET_PROTOCOL_ERROR'],
  ['binary', 'CODEX_SOCKET_PROTOCOL_ERROR'], ['invalid-utf8', 'CODEX_SOCKET_PROTOCOL_ERROR'],
  ['oversize', 'CODEX_SOCKET_FRAME_TOO_LARGE'],
  ['silent', 'CODEX_SOCKET_TIMEOUT'], ['hang-handshake', 'CODEX_SOCKET_TIMEOUT'],
  ['reject-handshake', 'CODEX_SOCKET_CONNECTION_FAILED'],
]) {
  test(`${mode} initialization rejects and closes only its connection`, async t => {
    const f = await fixture(t, mode, ['silent', 'hang-handshake'].includes(mode) ? 100 : 1500);
    await assert.rejects(f.client.connect(), { code });
    assert.equal(f.client.isConnected(), false);
    await f.client.stop();
    await until(() => f.connections.every(ws => ws.readyState === WebSocket.CLOSED));
  });
}

test('an absent socket fails without starting a replacement service', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const socketPath = path.join(root, 'absent.sock');
  const client = new LocalAppServerClient({ socketPath, timeoutMs: 1000 });
  t.after(() => client.stop());
  await assert.rejects(client.connect(), { code: 'CODEX_SOCKET_CONNECTION_FAILED' });
  await assert.rejects(fs.stat(socketPath), { code: 'ENOENT' });
});

for (const mode of ['late', 'hang-handshake']) {
  test(`stop during ${mode} initialization cannot publish a connected client`, async t => {
    const f = await fixture(t, mode);
    const connecting = f.client.connect();
    const rejected = assert.rejects(connecting, { code: 'CODEX_SOCKET_STOPPED' });
    await until(() => mode === 'late' ? f.requests.length > 0 : f.attempts() > 0);
    await f.client.stop();
    await rejected;
    assert.equal(f.client.isConnected(), false);
    assert.equal(f.requests.some(request => request.method === 'initialized'), false);
  });
}

test('disconnect rejects in-flight reads; an explicit reconnect opens one new socket', async t => {
  const f = await fixture(t, ['disconnect', 'normal']);
  await f.client.connect();
  await assert.rejects(f.client.loadedThreadSummary(), { code: 'CODEX_SOCKET_DISCONNECTED' });
  assert.equal(f.client.isConnected(), false);
  await f.client.connect();
  assert.deepEqual(await f.client.loadedThreadSummary(), { count: 1, hasMore: false });
  assert.equal(f.connections.length, 2);
});

test('a new connection can start while the stopped initialization is still unwinding', async t => {
  const f = await fixture(t, ['late', 'normal']);
  const rejected = assert.rejects(f.client.connect(), { code: 'CODEX_SOCKET_STOPPED' });
  await until(() => f.requests.length > 0);
  const stopping = f.client.stop();
  await f.client.connect();
  await Promise.all([stopping, rejected]);
  assert.equal(f.client.isConnected(), true);
  assert.deepEqual(await f.client.loadedThreadSummary(), { count: 1, hasMore: false });
  assert.equal(f.connections.length, 2);
});

test('an unresponsive socket invalidates the adapter without polling sessions or reconnecting', async t => {
  const f = await fixture(t, 'no-pong');
  const gateway = new AgentGateway([new CodexExistingServerAdapter(f.client)]);
  t.after(() => gateway.stop());
  assert.equal((await gateway.probe('codex')).state, 'connected');
  await until(() => gateway.snapshot()[0].state === 'failed');
  assert.equal(gateway.snapshot()[0].errorCode, 'CODEX_SOCKET_UNRESPONSIVE');
  assert.equal(f.connections.length, 1);
  assert.equal(f.requests.filter(request => request.method === 'thread/loaded/list').length, 1);
});

test('RPC rejection and invalid metadata expose stable codes without private server text', async t => {
  for (const [mode, code] of [['reject', 'CODEX_SOCKET_RPC_REJECTED'], ['bad-loaded', 'CODEX_SOCKET_PROTOCOL_ERROR']]) {
    const f = await fixture(t, mode);
    await f.client.connect();
    await assert.rejects(f.client.loadedThreadSummary(), error => error.code === code && !error.message.includes('private'));
  }
});

test('in-flight request admission is bounded and stop rejects all remaining reads', async t => {
  const f = await fixture(t, 'hang-loaded');
  await f.client.connect();
  const reads = Array.from({ length: 16 }, () => f.client.loadedThreadSummary());
  const settled = Promise.allSettled(reads);
  await assert.rejects(f.client.loadedThreadSummary(), { code: 'CODEX_SOCKET_BUSY' });
  await f.client.stop();
  assert.equal((await settled).filter(result => result.status === 'rejected').length, 16);
});

test('adapter snapshots are passive; probes share work and do not imply send capability', async t => {
  const f = await fixture(t);
  const gateway = new AgentGateway([new CodexExistingServerAdapter(f.client)]);
  t.after(() => gateway.stop());
  assert.equal(gateway.snapshot()[0].state, 'unprobed');
  assert.equal(f.connections.length, 0);
  const probes = await Promise.all(Array.from({ length: 8 }, () => gateway.probe('codex')));
  assert.ok(probes.every(probe => probe.state === 'connected'));
  assert.equal(f.requests.filter(request => request.method === 'thread/loaded/list').length, 1);
  const status = gateway.snapshot()[0];
  assert.equal(status.capabilities.sendMessage, false);
  assert.equal(status.sameDesktopThreadVerified, false);
  assert.equal(status.usesAccessibility, false);
  assert.ok(!JSON.stringify(status).includes('synthetic-private-thread-id'));
  assert.ok(!JSON.stringify(status).includes(f.root));
  status.capabilities.inspectLoadedSessions = false;
  assert.equal(gateway.snapshot()[0].capabilities.inspectLoadedSessions, true);
  f.connections[0].terminate();
  await until(() => gateway.snapshot()[0].state === 'failed');
  assert.equal(gateway.snapshot()[0].capabilities.inspectLoadedSessions, false);
  await gateway.stop();
  assert.throws(() => gateway.probe('codex'), { statusCode: 503 });
});

test('stopping a gateway during its probe cannot revive its state', async t => {
  const f = await fixture(t, 'late');
  const gateway = new AgentGateway([new CodexExistingServerAdapter(f.client)]);
  const probing = gateway.probe('codex');
  await until(() => f.requests.length > 0);
  await gateway.stop();
  assert.equal((await probing).state, 'unprobed');
  assert.equal(gateway.snapshot()[0].capabilities.inspectLoadedSessions, false);
});

test('HTTP status is passive and authenticated; only an administrator may probe', async t => {
  const f = await fixture(t);
  const gateway = new AgentGateway([new CodexExistingServerAdapter(f.client)]);
  const app = await createRelayServer({ logger: false, config: {
    host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(f.root, 'no-sessions'), defaultCwd: f.root,
  }, services: { agentGateway: gateway, desktopControl: { stop: async () => {} } } });
  t.after(() => app.close());
  const auth = { authorization: 'Bearer synthetic-admin' };
  assert.equal((await app.inject({ url: '/api/agents' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/agents/codex/probe' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/agents', headers: auth })).json().agents[0].state, 'unprobed');
  assert.equal(f.connections.length, 0);
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code } })).json();
  const deviceAuth = { authorization: `Bearer ${device.token}` };
  assert.equal((await app.inject({ url: '/api/agents', headers: deviceAuth })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/agents/codex/probe', headers: deviceAuth })).statusCode, 403);
  assert.equal(f.connections.length, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/agents/unknown/probe', headers: auth })).statusCode, 404);
  const response = await app.inject({ method: 'POST', url: '/api/agents/codex/probe', headers: auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().agent.state, 'connected');
  assert.equal(response.json().agent.capabilities.sendMessage, false);
  assert.ok(!response.body.includes('private'));
  await app.close();
  assert.equal(f.client.isConnected(), false);
});
