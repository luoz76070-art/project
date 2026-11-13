import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { initializeGateway, readManagedConfig, parseManagedConfig, pairingEndpoint } from '../dist/gateway/config.js';
import { startManagedGateway } from '../dist/gateway/managedGateway.js';
import { inspectGateway, gatewayErrorMessage } from '../dist/gateway/cli.js';

const execute = promisify(execFile);
test('manual gateway diagnostics require authentication and expose only bounded runtime metadata', async t => {
  const f = await fixture(t); await f.start();
  assert.equal((await f.call('/api/diagnostics', { token: 'wrong' })).status, 401);
  const response = await f.call('/api/diagnostics'); assert.equal(response.status, 200);
  const report = await response.json();
  assert.match(report.buildId, /^gateway-[a-f0-9-]{36}$/);
  assert.deepEqual(Object.keys(report).sort(), ['buildId', 'schema', 'tunnel']);
  assert.deepEqual(report.tunnel, { enabled: false, omitted: 0, events: [] });
  for (const value of [f.config.token, f.config.managerKey, f.config.workspace, f.config.codexHome]) assert.equal(JSON.stringify(report).includes(value), false);
});
async function port() {
  const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
async function until(check, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Synthetic gateway condition timed out'); await new Promise(resolve => setTimeout(resolve, 15)); }
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-gateway-'));
  const workspace = path.join(root, 'workspace'), codexHome = path.join(root, 'codex');
  await fs.mkdir(workspace); await fs.mkdir(codexHome);
  const file = path.join(root, 'private/gateway.json');
  await initializeGateway(file, { workspace, codexHome, port: await port() });
  const config = await readManagedConfig(file);
  const stops = [];
  t.after(async () => { for (const stop of stops.reverse()) await stop(); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (route, { token = config.token, ...init } = {}) => fetch(`http://127.0.0.1:${config.port}${route}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  const start = async input => { const service = await startManagedGateway(input ?? config); stops.push(service.stop); return service; };
  return { root, file, config, stops, call, start, save: async data => fs.writeFile(file, JSON.stringify(data), { mode: 0o600 }) };
}
async function broker(t) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let connections = 0;
  server.on('connection', socket => { connections++; socket.on('error', () => {}); });
  await once(server, 'listening');
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  return { server, config: { brokerUrl: `http://127.0.0.1:${server.address().port}`, relayId: 'synthetic-mac', relaySecret: 'synthetic-broker-secret-12345678901234567890' }, connections: () => connections };
}

async function deepSeekBridge(t, directory, phase) {
  const id = randomUUID(), pending = new Set(), requests = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === '/info' && phase !== 'info') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ protocol: 1, harnessVersion: '0.2.1-rc.2', interactions: false })); return;
    }
    if (request.url !== '/info' && request.url !== `/sessions/${id}/events`) { response.writeHead(404); response.end(); return; }
    pending.add(response); response.once('close', () => pending.delete(response));
    if (request.url === '/info') return; // Model a bridge stalled before response headers.
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': waiting\n\n');
    if (phase === 'active') response.write(`data: ${JSON.stringify({
      agentId: 'deepseek', session: { id, directory, title: 'synthetic', updatedAt: new Date().toISOString() },
      connected: true, updatedAt: new Date().toISOString(), status: 'running', activity: 'working',
      messages: [], questions: [], permissions: [], partialText: true, historyCursor: null,
      control: { token: randomUUID(), canSend: true, canSteer: true, canInterrupt: true }, submission: null, operationError: null,
    })}\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const release = () => { for (const response of pending) response.destroy(); };
  t.after(async () => { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { id, pending, requests, release, server, config: { url: `http://127.0.0.1:${server.address().port}/`, token: 'd'.repeat(48), directory } };
}

for (const phase of ['info', 'first-frame', 'active']) test(`stop drains DeepSeek ${phase} subscription before waiting for HTTP close`, async t => {
  const f = await fixture(t), bridge = await deepSeekBridge(t, f.config.workspace, phase);
  const service = await f.start({ ...f.config, deepseek: bridge.config });
  const route = `/api/agents/deepseek/sessions/${bridge.id}`;
  const token = await (await f.call(route + '/stream-token', { method: 'POST' })).json();
  const downstream = http.get(`http://127.0.0.1:${f.config.port}${route}/events?streamToken=${token.streamToken}`, response => response.resume());
  downstream.on('error', () => {});
  let timeout;
  try {
    await until(() => bridge.pending.size === 1);
    if (phase === 'active') await until(() => downstream.res?.statusCode === 200);
    const stopping = service.stop();
    assert.equal(service.stop(), stopping, 'concurrent stops share one shutdown');
    const closed = await Promise.race([stopping.then(() => true), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 1200); })]);
    assert.equal(closed, true, 'shutdown must not wait for the bridge header/first-frame timeout');
    await service.done;
    await until(() => bridge.pending.size === 0);
    assert.equal(await inspectGateway(f.config), null);
    assert.equal(bridge.server.listening, true, 'stopping the gateway must leave its upstream host running');
    assert.deepEqual(bridge.requests, phase === 'info' ? ['GET /info'] : ['GET /info', `GET /sessions/${bridge.id}/events`]);
    const next = await f.start(); assert.notEqual(next.snapshot().instanceId, service.snapshot().instanceId);
  } finally {
    clearTimeout(timeout); downstream.destroy(); bridge.release(); await service.stop();
  }
});

test('independent daemon with a pending DeepSeek first frame exits naturally and releases its port', async t => {
  const f = await fixture(t), bridge = await deepSeekBridge(t, f.config.workspace, 'first-frame');
  const config = { ...f.config, deepseek: bridge.config }; await f.save(config);
  const plugin = path.join(f.root, 'installed/mobile-codex');
  await fs.cp(new URL('../../../dist-plugin/mobile-codex/', import.meta.url), plugin, { recursive: true });
  const child = spawn(process.execPath, [path.join(plugin, 'scripts/mobile-codex.mjs'), 'daemon', '--config', f.file], {
    cwd: f.config.workspace, env: { ...process.env, HOME: f.root, USERPROFILE: f.root }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume(); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  let downstream, timeout;
  try {
    await until(() => inspectGateway(config).catch(() => null));
    const before = await inspectGateway(config), route = `/api/agents/deepseek/sessions/${bridge.id}`;
    const token = await (await f.call(route + '/stream-token', { method: 'POST' })).json();
    downstream = http.get(`http://127.0.0.1:${config.port}${route}/events?streamToken=${token.streamToken}`, response => response.resume());
    downstream.on('error', () => {});
    await until(() => bridge.pending.size === 1);
    const stopped = await f.call('/api/gateway/stop', { method: 'POST', headers: { 'x-mobile-codex-manager-key': config.managerKey }, body: JSON.stringify({ instanceId: before.instanceId }) });
    assert.equal(stopped.status, 202); await stopped.arrayBuffer();
    const outcome = await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(() => resolve(null), 3000); })]);
    assert.deepEqual(outcome, { code: 0, signal: null }, 'port closure alone is not proof that the daemon exited');
    assert.equal(stderr, '');
    await until(() => bridge.pending.size === 0);
    assert.equal(bridge.server.listening, true);
    const next = await f.start(config); assert.notEqual(next.snapshot().instanceId, before.instanceId);
  } finally {
    clearTimeout(timeout); downstream?.destroy(); bridge.release();
    // Only this test-owned child may be terminated if an assertion fails.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
});

test('init creates private config once, generates independent secrets and never overwrites concurrent init', async t => {
  const f = await fixture(t), before = await fs.readFile(f.file, 'utf8');
  assert.notEqual(f.config.token, f.config.managerKey);
  assert.ok(f.config.token.length >= 32);
  await assert.rejects(initializeGateway(f.file, { workspace: f.config.workspace, codexHome: f.config.codexHome }), { code: 'GATEWAY_ALREADY_INITIALIZED' });
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  const file = path.join(f.root, 'concurrent/gateway.json');
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => initializeGateway(file, { workspace: f.config.workspace, codexHome: f.config.codexHome })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await readManagedConfig(file)).version, 1);
  assert.deepEqual((await fs.readdir(path.dirname(file))), ['gateway.json']);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(f.file))).mode & 0o777, 0o700);
    await fs.chmod(f.file, 0o644);
    await assert.rejects(readManagedConfig(f.file), { code: 'GATEWAY_CONFIG_PERMISSIONS' });
  }
});

test('explicit legacy import preserves credentials, port and the original workspace device registry', async t => {
  const f = await fixture(t), b = await broker(t);
  const old = path.join(f.root, 'old.json'), next = path.join(f.root, 'imported/gateway.json');
  const legacy = { port: f.config.port, token: f.config.token, ...b.config };
  await fs.writeFile(old, JSON.stringify(legacy));
  const before = await fs.readFile(old, 'utf8');
  await initializeGateway(next, { workspace: f.config.workspace, codexHome: f.config.codexHome, importLegacy: old });
  const imported = await readManagedConfig(next);
  assert.equal(imported.token, f.config.token); assert.equal(imported.port, f.config.port);
  assert.deepEqual(imported.tunnel, b.config); assert.equal(imported.workspace, f.config.workspace);
  assert.equal(await fs.readFile(old, 'utf8'), before);
  const first = await f.start();
  const code = await (await f.call('/api/pairing', { method: 'POST' })).json();
  const device = await (await f.call('/api/pairing/consume', { method: 'POST', token: '', body: JSON.stringify({ code: code.code, name: 'synthetic phone' }) })).json();
  assert.equal(typeof device.token, 'string'); assert.ok(device.device.id);
  await first.stop();
  await f.start(imported);
  assert.equal((await f.call('/api/connection', { token: device.token })).status, 200);
});

test('configuration rejects insecure/credential-bearing URLs, malformed imports and invalid native mode without leaking input', async t => {
  const f = await fixture(t);
  for (const raw of ['http://public.example', 'https://user:private@broker.example', 'https://broker.example?secret=private', 'file:///private']) {
    assert.throws(() => parseManagedConfig({ ...f.config, publicEndpoint: raw }), { code: 'GATEWAY_URL_INVALID' });
  }
  assert.throws(() => parseManagedConfig({ ...f.config, desktopTransport: 'legacy' }), { code: 'GATEWAY_CONFIG_INVALID' });
  assert.throws(() => parseManagedConfig({ ...f.config, token: 'dev-local-token' }), { code: 'GATEWAY_CONFIG_INVALID' });
  const bad = path.join(f.root, 'malformed.json'); await fs.writeFile(bad, '{"token":"private"}');
  await assert.rejects(initializeGateway(path.join(f.root, 'new.json'), { workspace: f.config.workspace, codexHome: f.config.codexHome, importLegacy: bad }), { code: 'GATEWAY_IMPORT_INVALID' });
  assert.deepEqual(gatewayErrorMessage(new Error('private sensitive payload')), { error: 'GATEWAY_FAILED', message: '操作失败，请检查本地配置和运行状态。' });
});

test('pairing endpoint preserves proxy prefix, maps websocket scheme and never contains broker credentials', async t => {
  const { config } = await fixture(t);
  const tunnel = { brokerUrl: 'wss://broker.example/proxy/relay/connect', relayId: 'my-mac', relaySecret: 's'.repeat(40) };
  assert.equal(pairingEndpoint(parseManagedConfig({ ...config, tunnel })), 'https://broker.example/proxy/r/my-mac');
  assert.equal(pairingEndpoint(parseManagedConfig({ ...config, tunnel, publicEndpoint: 'https://public.example/mobile/' })), 'https://public.example/mobile');
});

test('managed status is authenticated and passive; querying it does not open Desktop sockets or read sessions', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.config.codexHome, 'ipc'));
  let connections = 0;
  const net = await import('node:net');
  const trap = net.createServer(socket => { connections++; socket.destroy(); });
  trap.listen(path.join(f.config.codexHome, 'ipc/ipc.sock')); await once(trap, 'listening');
  f.stops.push(() => new Promise(resolve => trap.close(resolve)));
  const service = await f.start();
  assert.equal((await f.call('/api/gateway', { token: '' })).status, 401);
  for (let i = 0; i < 4; i++) {
    const snapshot = await inspectGateway(f.config);
    assert.equal(snapshot.instanceId, service.snapshot().instanceId);
    assert.equal(snapshot.tunnel.enabled, false);
    assert.equal(snapshot.sameDesktopThreadVerified, false);
    const encoded = JSON.stringify(snapshot);
    for (const secret of [f.config.token, f.config.managerKey, f.config.codexHome, f.config.workspace]) assert.ok(!encoded.includes(secret));
  }
  assert.equal(connections, 0);
  assert.deepEqual(await fs.readdir(f.config.codexHome), ['ipc']);
  assert.equal((await (await f.call('/api/agents')).json()).agents[0].state, 'unprobed');
});

test('only a successful port owner starts Tunnel; duplicate/occupied startups never connect a second Tunnel', async t => {
  const f = await fixture(t), b = await broker(t);
  const config = { ...f.config, tunnel: b.config };
  const first = await f.start(config);
  await until(() => first.snapshot().tunnel.state === 'connected');
  await assert.rejects(startManagedGateway(config), { code: 'EADDRINUSE' });
  assert.equal(b.connections(), 1);
  const diagnostics = await (await f.call('/api/diagnostics')).json();
  assert.match(diagnostics.buildId, /^gateway-[a-f0-9-]{36}$/);
  assert.ok(diagnostics.tunnel.events.some(event => event.reason === 'open'));
  await first.stop();
  await until(() => b.server.clients.size === 0);
  const unknown = http.createServer((_, response) => { response.writeHead(401); response.end(); });
  unknown.listen(f.config.port, '127.0.0.1'); await once(unknown, 'listening');
  f.stops.push(() => new Promise(resolve => unknown.close(resolve)));
  await assert.rejects(inspectGateway(config), { code: 'GATEWAY_PORT_OCCUPIED' });
  await assert.rejects(startManagedGateway(config), { code: 'EADDRINUSE' });
  assert.equal(b.connections(), 1);
});

test('stop requires admin, private management key and exact instance; authenticated device cannot stop gateway', async t => {
  const f = await fixture(t), service = await f.start();
  const code = await (await f.call('/api/pairing', { method: 'POST' })).json();
  const device = await (await f.call('/api/pairing/consume', { method: 'POST', body: JSON.stringify({ code: code.code, name: 'synthetic phone' }) })).json();
  assert.equal(typeof device.token, 'string'); assert.ok(device.device.id);
  const body = JSON.stringify({ instanceId: service.snapshot().instanceId });
  assert.equal((await f.call('/api/gateway', { token: device.token })).status, 200);
  assert.equal((await f.call('/api/gateway/stop', { method: 'POST', body })).status, 403);
  assert.equal((await f.call('/api/gateway/stop', { method: 'POST', body, token: device.token, headers: { 'x-mobile-codex-manager-key': f.config.managerKey } })).status, 403);
  const headers = { 'x-mobile-codex-manager-key': f.config.managerKey };
  assert.equal((await f.call('/api/gateway/stop', { method: 'POST', headers, body: JSON.stringify({ instanceId: '00000000-0000-4000-8000-000000000000' }) })).status, 409);
  assert.equal((await f.call('/api/gateway/stop', { method: 'POST', headers, body })).status, 202);
  await service.done;
  assert.equal(await inspectGateway(f.config), null);
});

test('passive management refuses unknown, redirected or oversized status responses without treating the port as free', async t => {
  const f = await fixture(t);
  let mode = 'unknown';
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    if (mode === 'redirect') { response.writeHead(302, { location: '/must-not-follow' }); response.end(); }
    else { response.writeHead(200, { 'content-type': 'application/json' }); response.end(mode === 'oversized' ? 'x'.repeat(70000) : '{"gateway":{"kind":"another-service"}}'); }
  });
  server.listen(f.config.port, '127.0.0.1'); await once(server, 'listening');
  f.stops.push(() => new Promise(resolve => server.close(resolve)));
  for (mode of ['unknown', 'redirect', 'oversized']) {
    await assert.rejects(inspectGateway(f.config), { code: mode === 'oversized' ? 'GATEWAY_PORT_UNVERIFIED' : 'GATEWAY_PORT_OCCUPIED' });
  }
  assert.deepEqual(paths, Array(3).fill('/api/gateway'));
});

test('Tunnel state recovers after disconnection and stop cancels reconnection without replaying requests', async t => {
  const f = await fixture(t), b = await broker(t);
  const service = await f.start({ ...f.config, tunnel: b.config });
  await until(() => service.snapshot().tunnel.state === 'connected');
  for (const socket of b.server.clients) socket.terminate();
  await until(() => service.snapshot().tunnel.state === 'reconnecting' || b.connections() > 1);
  await until(() => b.connections() > 1 && service.snapshot().tunnel.state === 'connected');
  await service.stop();
  assert.equal(service.snapshot().tunnel.state, 'stopped');
  await until(() => b.server.clients.size === 0);
});

test('independent plugin bundle runs outside repo: concurrent CLI start, status, pairing, device revoke and instance stop', async t => {
  const f = await fixture(t), b = await broker(t);
  const config = { ...f.config, tunnel: b.config }; await f.save(config);
  const plugin = path.join(f.root, 'installed/mobile-codex');
  await fs.cp(new URL('../../../dist-plugin/mobile-codex/', import.meta.url), plugin, { recursive: true });
  const entry = path.join(plugin, 'scripts/mobile-codex.mjs');
  const cli = async (...args) => {
    const result = await execute(process.execPath, [entry, ...args, '--config', f.file], { cwd: f.config.workspace, timeout: 20000, env: { ...process.env, HOME: f.root, USERPROFILE: f.root } });
    return JSON.parse(result.stdout.trim());
  };
  // Even assertion failures must stop the synthetic daemon, never production.
  f.stops.push(async () => { if (await inspectGateway(config).catch(() => null)) await cli('stop'); });
  const manifest = JSON.parse(await fs.readFile(path.join(plugin, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'mobile-codex');
  await fs.access(path.join(plugin, manifest.extensions['com.openai'].onboardingSkill));
  assert.equal((await cli('status')).running, false);
  const starts = await Promise.all(Array.from({ length: 4 }, () => cli('start')));
  assert.equal(new Set(starts.map(result => result.gateway.instanceId)).size, 1);
  await until(async () => (await cli('status')).gateway.tunnel.state === 'connected');
  assert.equal(b.connections(), 1);
  const paired = await cli('pair');
  assert.equal(paired.endpoint, `${b.config.brokerUrl}/r/synthetic-mac`);
  assert.ok(paired.code); assert.ok(!JSON.stringify(paired).includes(config.token));
  const device = await (await f.call('/api/pairing/consume', { method: 'POST', token: '', body: JSON.stringify({ code: paired.code, name: 'synthetic phone' }) })).json();
  assert.equal((await cli('devices')).devices[0].id, device.device.id);
  await cli('revoke', '--device', device.device.id);
  assert.equal((await f.call('/api/connection', { token: device.token })).status, 401);
  assert.equal((await cli('stop')).stopped, true);
  assert.equal((await cli('status')).running, false);
  const log = await fs.readFile(path.join(path.dirname(f.file), 'gateway.log'), 'utf8');
  for (const value of [config.token, config.managerKey, config.tunnel.relaySecret, paired.code]) assert.ok(!log.includes(value));
  assert.deepEqual(await fs.readdir(config.codexHome), []);
});
