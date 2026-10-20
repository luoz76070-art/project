import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { CodexStore } from '../dist/store/codexStore.js';
import { DesktopIpcClient } from '../dist/desktop/desktopIpcClient.js';
import { snapshotSender } from '../dist/server/snapshotPatch.js';

test('10,000-session warm list and summary avoid directory scans and full history reads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-index-'));
  const store = new CodexStore(root);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'sessions'));
  const rows = [];
  for (let start = 0; start < 10000; start += 100) {
    await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const number = start + index;
      const id = `11111111-1111-1111-1111-${String(number).padStart(12, '0')}`;
      rows.push({ id, thread_name: `session ${number}`, updated_at: new Date(1792400000000 + number * 1000).toISOString() });
      await fs.writeFile(path.join(root, 'sessions', `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id, source: 'vscode', cwd: '/synthetic' } }) + '\n');
    }));
  }
  await fs.writeFile(path.join(root, 'session_index.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const cold = performance.now();
  assert.equal((await store.listThreads(24)).length, 24);
  const coldMs = performance.now() - cold;
  let scans = 0, fullHistoryReads = 0, headOpens = 0;
  const readdir = fs.readdir, readFile = fs.readFile, open = fs.open;
  t.mock.method(fs, "open", (...args) => { headOpens++; return open(...args); });
  t.mock.method(fs, 'readdir', (...args) => { scans++; return readdir(...args); });
  t.mock.method(fs, 'readFile', (...args) => { if (String(args[0]).includes('rollout-')) fullHistoryReads++; return readFile(...args); });
  const durations = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const threads = await store.listThreads(24);
    await store.getThreadSummary(threads[0].id);
    durations.push(performance.now() - start);
  }
  assert.equal(scans, 0);
  assert.equal(fullHistoryReads, 0);
  assert.equal(headOpens, 0, "warm summary must reuse unchanged head cache");
  const last = await store.listThreads(24, 9980);
  assert.equal(last.length, 20);
  const found = await store.listThreads(24, 0, 'session 1234');
  assert.equal(found.length, 1);
  console.log(JSON.stringify({ sessions: 10000, coldMs: Math.round(coldMs), warmP95Ms: Math.round(durations.sort((a,b) => a-b)[18]), warmDirectoryScans: scans, fullHistoryReads }));
});

test('history pages share byte boundaries and stable IDs without missing messages', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-history-'));
  const store = new CodexStore(root);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'sessions'));
  const id = '11111111-1111-1111-1111-111111111111';
  const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ timestamp: String(i), type: 'event_msg', payload: { type: 'user_message', message: `中文历史-${i}` } }));
  await fs.writeFile(path.join(root, 'sessions', `rollout-${id}.jsonl`), lines.join('\n') + '\n');
  const collected = [];
  let before;
  do {
    const page = await store.readThreadLatest(id, 500, 7, before);
    collected.unshift(...page.messages);
    assert.ok(before === undefined || page.windowStart < before);
    before = page.windowStart;
  } while (before > 0);
  assert.equal(collected.length, 100);
  assert.equal(new Set(collected.map(m => m.id)).size, 100);
  assert.deepEqual(collected.map(m => m.text), Array.from({ length: 100 }, (_, i) => `中文历史-${i}`));
});

function frame(value) {
  const data = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(data.length); return Buffer.concat([header, data]);
}
async function ipcFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-ipc-'));
  const pipePath = path.join(root, 'fixture.sock');
  let connected;
  let connections = 0;
  const server = net.createServer(socket => {
    connected = socket; connections++;
    let data = Buffer.alloc(0);
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      while (data.length >= 4 && data.length >= 4 + data.readUInt32LE(0)) {
        const length = data.readUInt32LE(0);
        const message = JSON.parse(data.subarray(4, 4 + length));
        data = data.subarray(4 + length);
        if (message.method === 'initialize') socket.write(frame({ type: 'response', method: 'initialize', requestId: message.requestId, resultType: 'success', result: { clientId: 'fixture' } }));
      }
    });
  });
  server.listen(pipePath); await once(server, 'listening');
  const client = new DesktopIpcClient({ clientType: 'fixture', pipePath, requestTimeoutMs: 1000 });
  t.after(async () => { await client.disconnect(); connected?.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return { client, socket: () => connected, connections: () => connections };
}

test('IPC shares initialization and invalid JSON rejects pending work without escaping', async t => {
  const fixture = await ipcFixture(t);
  await Promise.all([fixture.client.connect(), fixture.client.connect()]);
  assert.equal(fixture.connections(), 1);
  const pending = fixture.client.sendRequest('wait', {});
  const rejected = assert.rejects(pending, /desktop-ipc-invalid-json/);
  fixture.socket().write(frame('{broken json'));
  await rejected;
  assert.equal(fixture.client.getStatus().lastError, 'desktop-ipc-invalid-json');
});

test('IPC rejects an oversized frame before allocating its payload', async t => {
  const fixture = await ipcFixture(t);
  await fixture.client.connect();
  const header = Buffer.alloc(4); header.writeUInt32LE(100 * 1024 * 1024);
  fixture.socket().write(header);
  await once(fixture.socket(), 'close');
  assert.equal(fixture.client.getStatus().lastError, 'desktop-ipc-frame-limit');
});

test('incremental snapshots send only appended text and retain old-client compatibility', () => {
  const output = [];
  const send = snapshotSender((event, data) => output.push({ event, data }), 'turn', true);
  send({ status: 'inProgress', messages: [{ id: 'one', text: 'x'.repeat(10000) }] });
  send({ status: 'inProgress', messages: [{ id: 'one', text: 'x'.repeat(10000) + 'new' }] });
  assert.equal(output[1].data.baseSeq, 1);
  assert.deepEqual(output[1].data.textDeltas, [{ id: 'one', append: 'new' }]);
  assert.ok(JSON.stringify(output[1]).length < 250);
  send({ status: 'completed', messages: [] });
  assert.deepEqual(output[2].data.removedIds, ['one']);
  const legacy = [];
  snapshotSender((event, data) => legacy.push(data), 'turn', false)({ messages: [{ id: 'one', text: 'full' }] });
  assert.equal(legacy[0].messages[0].text, 'full');
  assert.equal(legacy[0].partial, undefined);
});


test('index follows a replaced sessions directory immediately', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-index-rotation-'));
  const store = new CodexStore(root);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const sessions = path.join(root, 'sessions');
  await fs.mkdir(sessions);
  const a = '11111111-1111-1111-1111-111111111111';
  const b = '22222222-2222-2222-2222-222222222222';
  await fs.writeFile(path.join(sessions, `rollout-${a}.jsonl`), '{}\n');
  assert.equal((await store.listThreads())[0].id, a);
  await fs.rename(sessions, path.join(root, 'old-sessions'));
  await fs.mkdir(sessions);
  await fs.writeFile(path.join(sessions, `rollout-${b}.jsonl`), '{}\n');
  assert.deepEqual((await store.listThreads()).map(thread => thread.id), [b]);
});
