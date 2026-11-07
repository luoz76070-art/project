import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentGateway } from '../dist/agents/agentGateway.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { createProjectImageReader } from '../dist/server/threadImageRoutes.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(10); } assert.fail('synthetic subscription cleanup timeout'); }

test('all registered SessionAdapters bind authenticated image reads to the current owner and authoritative subscription', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-images-'));
  const project = path.join(root, 'project'); await fs.mkdir(project); await fs.writeFile(path.join(project, 'test.png'), png);
  await fs.writeFile(path.join(root, 'outside.png'), png); await fs.symlink(path.join(root, 'outside.png'), path.join(project, 'link.png'));
  const listeners = new Set(); let connected = true, directory = project, snapshotId = 'original';
  const snapshot = id => ({ agentId: id, session: { id: snapshotId, directory, title: 'Synthetic', updatedAt: new Date().toISOString() },
    connected, updatedAt: new Date().toISOString(), status: 'idle', activity: 'thinking', messages: [], questions: [], permissions: [],
    partialText: false, historyCursor: null, control: null, submission: null });
  const adapters = ['deepseek', 'claude', 'opencode', 'future-agent'].map(id => {
    const adapter = { sessionApi: { validSessionId: value => value === 'original', async watchSession(_key, publish) {
      const callback = () => publish(snapshot(id)); listeners.add(callback); callback(); return () => listeners.delete(callback);
    } }, snapshot: () => ({ id, label: id, transport: 'synthetic-only', capabilities: {} }), async stop() {} };
    return adapter;
  });
  const gateway = new AgentGateway(adapters);
  assert.ok(gateway.snapshot().every(row => row.sessionApi === 1));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root },
    services: { agentGateway: gateway, store: { close() {} }, desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const controllers = [];
  t.after(async () => { controllers.forEach(controller => controller.abort()); await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const admin = { authorization: 'Bearer synthetic-admin' };
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: admin })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code, name: 'synthetic device' } })).json();
  const auth = { authorization: `Bearer ${device.token}` };
  const image = (id, headers = auth, source = 'test.png', extra = {}) => app.inject({ method: 'POST', url: `/api/agents/${id}/sessions/original/images`, headers, payload: { path: source, ...extra } });
  async function subscribe(id) {
    const route = `/api/agents/${id}/sessions/original`;
    const token = (await app.inject({ method: 'POST', url: `${route}/stream-token`, headers: auth, payload: {} })).json().streamToken;
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}${route}/events?streamToken=${token}`, { signal: controller.signal });
    assert.equal(response.status, 200); await response.body.getReader().read(); return controller;
  }
  assert.equal((await image('deepseek', {}, 'test.png')).statusCode, 401);
  assert.equal((await image('deepseek')).statusCode, 409);
  for (const id of adapters.map(adapter => adapter.snapshot().id)) {
    const controller = await subscribe(id);
    const response = await image(id); assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().dataUrl, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal((await image(id, admin)).statusCode, 409, 'another owner cannot borrow a device subscription');
    assert.equal((await image(id, auth, 'test.png', { directory: root })).statusCode, 400);
    for (const source of ['../outside.png', 'link.png']) assert.equal((await image(id, auth, source)).statusCode, 403);
    snapshotId = 'other'; for (const notify of listeners) notify(); assert.equal((await image(id)).statusCode, 409);
    snapshotId = 'original'; connected = false; for (const notify of listeners) notify(); assert.equal((await image(id)).statusCode, 409);
    connected = true; directory = 'relative'; for (const notify of listeners) notify(); assert.equal((await image(id)).statusCode, 409);
    directory = project; for (const notify of listeners) notify(); assert.equal((await image(id)).statusCode, 200);
    controller.abort(); await until(() => listeners.size === 0); assert.equal((await image(id)).statusCode, 409);
  }
  await subscribe('future-agent');
  await app.inject({ method: 'DELETE', url: `/api/devices/${device.device.id}`, headers: admin });
  await until(() => listeners.size === 0); assert.equal((await image('future-agent')).statusCode, 401);
});

test('one image reader shares Codex/Agent concurrency budgets and releases on success or failure', async () => {
  const pending = [];
  const read = createProjectImageReader(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const a = read('device-a', '/project', 'codex.png'), b = read('device-a', '/project', 'agent.png');
  await assert.rejects(read('device-a', '/project', 'third.png'), { statusCode: 429 });
  const c = read('device-b', '/project', 'claude.png'), d = read('device-c', '/project', 'future.png');
  await assert.rejects(read('device-d', '/project', 'fifth.png'), { statusCode: 429 });
  const rejected = assert.rejects(a, /synthetic/); pending[0].reject(new Error('synthetic')); await rejected;
  const e = read('device-a', '/project', 'retry.png');
  for (const task of pending.slice(1)) task.resolve({ dataUrl: 'synthetic' });
  await Promise.all([b, c, d, e]);
  const after = read('device-a', '/project', 'after.png'); pending.at(-1).resolve({ dataUrl: 'synthetic' }); await after;
});
