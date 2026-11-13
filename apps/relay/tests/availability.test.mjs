import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DeviceRegistry } from '../dist/server/devices.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { MacosUiInjector } from '../dist/desktop/macosUiInjector.js';
import { LiveCodex } from '../dist/codex/liveCodex.js';

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-availability-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('pairing is one-time, expiring and stores only revocable device hashes', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'devices.json');
  const registry = await DeviceRegistry.open(file);
  const pairing = registry.createPairing();
  const device = await registry.pair(pairing.code, 'synthetic phone');
  await assert.rejects(registry.pair(pairing.code, 'replay'), { statusCode: 401 });
  assert.equal(registry.authenticate(device.token), device.device.id);
  const stored = await fs.readFile(file, 'utf8');
  assert.ok(!stored.includes(device.token));
  assert.ok(!stored.includes(pairing.code));
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const loaded = await DeviceRegistry.open(file);
  assert.equal(loaded.authenticate(device.token), device.device.id);
  await loaded.revoke(device.device.id);
  assert.equal((await DeviceRegistry.open(file)).authenticate(device.token), null);
  const expired = registry.createPairing();
  t.mock.method(Date, 'now', () => Date.parse(expired.expiresAt) + 1);
  await assert.rejects(registry.pair(expired.code, 'expired'), { statusCode: 401 });
});

test('concurrent pairing consumes a code once and preserves other devices', async t => {
  const registry = await DeviceRegistry.open(path.join(await temporary(t), 'devices.json'));
  const a = registry.createPairing(), b = registry.createPairing();
  const results = await Promise.allSettled([registry.pair(a.code, 'a'), registry.pair(a.code, 'duplicate'), registry.pair(b.code, 'b')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(registry.list().length, 2);
});

test('device revocation closes existing SSE; authentication precedes JSON parsing; stream count is bounded', { timeout: 10000 }, async t => {
  const root = await temporary(t);
  const turns = new EventEmitter();
  turns.stop = async () => {};
  turns.getTurn = () => ({ turnId: 'synthetic-turn', threadId: 'synthetic', status: 'inProgress', messages: [] });
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'no-sessions'), defaultCwd: root }, services: { liveTurns: turns, desktopControl: { stop: async () => {} } } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  assert.equal((await app.inject({ method: 'POST', url: '/api/uploads', headers: { 'content-type': 'application/json' }, payload: '{bad' })).statusCode, 401);
  const auth = { authorization: 'Bearer synthetic-admin' };
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth })).json();
  const paired = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code, name: 'fixture' } })).json();
  const deviceAuth = { authorization: `Bearer ${paired.token}` };
  assert.equal((await app.inject({ method: 'POST', url: '/api/pairing', headers: deviceAuth })).statusCode, 403);
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const streamToken = (await app.inject({ method: 'POST', url: '/api/live/turns/synthetic-turn/stream-token', headers: deviceAuth })).json().streamToken;
  const readers = [];
  for (let i = 0; i < 4; i++) {
    const response = await fetch(`${base}/api/live/turns/synthetic-turn/events?streamToken=${streamToken}`);
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); readers.push(reader); await reader.read();
  }
  assert.equal((await fetch(`${base}/api/live/turns/synthetic-turn/events?streamToken=${streamToken}`)).status, 429);
  const pending = readers[0].read().catch(() => ({ done: true }));
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${paired.device.id}`, headers: auth })).statusCode, 200);
  assert.equal((await pending).done, true);
  assert.equal((await app.inject({ url: '/api/connection', headers: deviceAuth })).statusCode, 401);
  assert.equal((await fetch(`${base}/api/live/turns/synthetic-turn/events?streamToken=${streamToken}`)).status, 401);
  await Promise.all(readers.map(reader => reader.cancel().catch(() => {})));
  assert.equal(turns.listenerCount('snapshot'), 0);
});

test('uploads reserve capacity before parsing and release it after completion', async t => {
  const root = await temporary(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let saves = 0;
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: root, defaultCwd: root }, services: { uploads: { saveUpload: async () => { saves++; await gate; return { ok: true }; } }, desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  t.after(() => app.close());
  const input = { method: 'POST', url: '/api/uploads', headers: { authorization: 'Bearer synthetic-admin' }, payload: { fileName: 'fixture', dataBase64: 'eA==' } };
  const first = app.inject(input), second = app.inject(input);
  while (saves < 2) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await app.inject(input)).statusCode, 429);
  release();
  assert.equal((await first).statusCode, 200);
  assert.equal((await second).statusCode, 200);
  assert.equal((await app.inject(input)).statusCode, 200);
});

test('Mac input transactions are serialized across injector instances and use isolated files', async t => {
  const root = await temporary(t);
  const helper = path.join(root, 'synthetic-helper'); await fs.writeFile(helper, 'fixture');
  const order = [], files = [];
  const run = async (command, args) => {
    if (command === 'open') { order.push(`focus:${args[0].split('/').at(-1)}`); }
    else {
      assert.equal(command, helper);
      const request = JSON.parse(await fs.readFile(args[1], 'utf8'));
      files.push(args[1]);
      order.push(await fs.readFile(request.inputFile, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(request.resultFile, JSON.stringify({ id: request.id, ok: true }));
    }
    return { stdout: '', stderr: '' };
  };
  const options = { run, helperExec: helper, platform: 'darwin', focusDelayMs: 0 };
  await Promise.all([new MacosUiInjector(options).sendMessage({ threadId: 'a', message: 'a' }), new MacosUiInjector(options).sendMessage({ threadId: 'b', message: 'b' })]);
  assert.deepEqual(order, ['focus:a', 'a', 'focus:b', 'b']);
  assert.notEqual(files[0], files[1]);
  assert.equal(await fs.stat(path.dirname(files[0])).catch(() => null), null);
});

test('unknown helper result never invokes another input method', async t => {
  const helper = path.join(await temporary(t), 'synthetic-helper'); await fs.writeFile(helper, 'fixture');
  const commands = [];
  const injector = new MacosUiInjector({ platform: 'darwin', helperExec: helper, focusDelayMs: 0, run: async command => {
    commands.push(command);
    if (command === helper) throw new Error('unknown result');
    return { stdout: '', stderr: '' };
  } });
  await assert.rejects(injector.sendMessage({ threadId: 'synthetic', message: 'never sent' }), /was not replayed/);
  assert.deepEqual(commands, ['open', helper]);
});

test('read-only app-server calls share initialization, reconnect, and stop their own client', async t => {
  let starts = 0, stops = 0;
  const clients = [];
  const live = new LiveCodex('/synthetic', () => {
    const client = new EventEmitter(); let connected = false;
    client.start = async () => { starts++; await new Promise(resolve => setTimeout(resolve, 5)); connected = true; };
    client.stop = async () => { stops++; connected = false; };
    client.isConnected = () => connected;
    client.request = async () => ({ data: [] });
    clients.push(client); return client;
  });
  t.after(() => live.stop());
  await Promise.all([live.status(), live.listThreads(), live.status()]);
  assert.equal(starts, 1);
  clients[0].emit('disconnect');
  await live.listThreads();
  assert.equal(starts, 2);
  assert.equal(stops, 1);
});
