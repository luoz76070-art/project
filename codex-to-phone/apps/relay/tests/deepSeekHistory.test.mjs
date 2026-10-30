import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDeepSeekBridge } from '../../../plugins/mobile-deepseek/bridge.mjs';
import { DeepSeekClient } from '../dist/agents/deepSeekClient.js';
import { DeepSeekAdapter } from '../dist/agents/deepSeekAdapter.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = '/synthetic/deepseek', token = 'h'.repeat(48);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) assert.fail('synthetic history timeout'); await sleep(10); } }
async function fixture(t, options = {}) {
  const agents = new Map(), listeners = new Map(), calls = [], rows = [], logs = new Map();
  let observations = 0, disposed = 0, listReads = 0;
  const emit = (name, ...args) => { for (const callback of listeners.get(name) ?? []) callback(...args); };
  function append(id, type, data) {
    const log = logs.get(id), event = { seq: log.length, time: 2000 + log.length, type, data }; log.push(event);
    emit('session/event', { id }, event); return event;
  }
  function add(id, cwd = directory, count = 0, extra = {}) {
    rows.push({ sessionId: id, cwd, updatedAt: Date.now() + rows.length, agentAvailable: false, running: false, blank: count === 0, projections: { values: { title: `标题 ${id}` } }, ...extra });
    logs.set(id, []);
    for (let i = 0; i < count; i++) append(id, i % 2 ? 'assistant/message' : 'user/message', i % 2 ? { turn: 1, step: i, message: { id: `${id}-m${i}`, role: 'assistant', content: [{ type: 'text', text: options.longText ?? `消息 ${i}` }, { type: 'reasoning', text: 'private reasoning' }] } } : { id: `${id}-m${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: options.longText ?? `消息 ${i}` }] });
    emit('session/created', { id });
  }
  function attach(id) {
    const row = rows.find(row => row.sessionId === id), agent = { id, status: 'idle', session: { id, header: { id, cwd: row.cwd, createdAt: 1000 } }, inbox: { nextTurn: [], nextStep: [] },
      followup(message) { calls.push({ kind: 'followup', id, message }); }, steer(message) { calls.push({ kind: 'steer', id, message }); }, cancel() { calls.push({ kind: 'cancel', id }); } };
    agents.set(id, agent); return agent;
  }
  add('cold/original', '/synthetic/other-workspace', options.messages ?? 75);
  if (options.many) for (let i = 0; i < 145; i++) add(`older-${i}`, i % 2 ? directory : '/synthetic/third', 0);
  add('child', directory, 0, { origin: 'subagent' });
  const ctx = {
    agents: { list: () => [...agents.values()], get: id => agents.get(id) },
    on(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); return () => set.delete(callback); },
    sessionQuery: { async observeSession(id, options) {
      options.signal?.throwIfAborted(); observations++;
      const row = rows.find(row => row.sessionId === id); assert.ok(row);
      const captured = logs.get(id).slice();
      return { source: agents.has(id) ? 'live' : 'prepared', header: { id, cwd: row.cwd, createdAt: 1000 }, cursor: captured.length - 1,
        get events() { assert.fail('use official page, not full events'); }, [Symbol.dispose]() { disposed++; } };
    } },
    sessionController: {
      async list(_request, signal) { signal?.throwIfAborted(); listReads++; return { items: rows.map(row => ({ ...row, agentAvailable: agents.has(row.sessionId), running: agents.get(row.sessionId)?.status === 'running' })) }; },
      async page(request, signal) {
        signal.throwIfAborted(); assert.equal(request.address.kind, 'session');
        const log = logs.get(request.address.sessionId).filter(event => event.seq <= request.throughSeq && (request.beforeSeq === undefined || event.seq < request.beforeSeq));
        const events = log.slice(-request.maxMessages); return { records: events.map(event => ({ type: 'event', event })), hasMore: events.length < log.length };
      },
      async prompt(request, signal) {
        signal.throwIfAborted(); calls.push({ kind: 'prompt', request });
        if (options.unknown) throw new Error('synthetic lost result');
        if (options.deferred) return { accepted: true };
        const agent = agents.get(request.sessionId) ?? attach(request.sessionId);
        const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: request.requestId }, content: request.content };
        append(agent.id, 'user/message', message);
        if (options.badAck) return { accepted: false };
        return { accepted: true };
      },
      follow() { assert.fail('desktop follow must not activate cold sessions during viewing'); },
    },
  };
  const bridge = createDeepSeekBridge(ctx, { port: 0, token, directory, scope: 'all' }, value => ({ ...value, id: randomUUID(), role: 'user' }), '0.2.1-rc.2');
  const address = await bridge.ready, config = { url: `http://127.0.0.1:${address.port}/`, token, directory, scope: 'all' };
  const client = new DeepSeekClient(config, { timeoutMs: 2000 }), adapter = new DeepSeekAdapter(client);
  t.after(async () => { await adapter.stop(); await bridge.stop(); });
  const values = [], watch = id => adapter.watchSession(id, snapshot => values.push(snapshot), () => {});
  return { ctx, rows, logs, add, attach, append, emit, calls, agents, adapter, client, bridge, config, values, watch, listReads: () => listReads, stats: () => ({ observations, disposed }) };
}

test('all-scope lists every ordinary live/persisted session across workspaces with cached titles and pagination', async t => {
  const f = await fixture(t, { many: true });
  const seen = new Map(); let cursor;
  do { const page = await f.adapter.listSessions(undefined, cursor); for (const row of page.sessions) { assert.ok(!seen.has(row.id)); seen.set(row.id, row); } cursor = page.cursor; } while (cursor);
  assert.equal(seen.size, 146); assert.ok([...seen.values()].some(row => row.directory === '/synthetic/other-workspace'));
  assert.ok([...seen.values()].every(row => row.title.startsWith('标题 ')));
  assert.deepEqual(f.stats(), { observations: 0, disposed: 0 }); assert.deepEqual(f.calls, []); assert.equal(f.agents.size, 0);
  const found = await f.adapter.listSessions('cold/original'); assert.equal(found.sessions.length, 1);
  assert.ok(seen.has(found.sessions[0].id), 'one durable session keeps one public identity');
  assert.equal((await f.adapter.probe()).loadedSessions.hasMore, true);
});

test('opening and paging cold history reads original messages without activation and isolates cursors', async t => {
  const f = await fixture(t), row = (await f.adapter.listSessions()).sessions[0];
  const close = await f.watch(row.id), current = f.values.at(-1);
  assert.equal(current.connected, true); assert.equal(current.status, 'idle'); assert.equal(current.control.canSend, true); assert.equal(current.control.canInterrupt, false);
  assert.equal(current.messages.at(-1).text, '消息 74'); assert.ok(current.historyCursor);
  const all = new Map(current.messages.map(message => [message.id, message])); let cursor = current.historyCursor;
  while (cursor) { const page = await f.adapter.readHistory(row.id, cursor); for (const message of page.messages) { assert.ok(!all.has(message.id)); all.set(message.id, message); } cursor = page.cursor; }
  assert.equal(all.size, 75); assert.ok([...all.values()].every(message => !message.text.includes('private reasoning')));
  assert.equal(f.agents.size, 0); assert.deepEqual(f.calls, []); assert.equal(f.stats().observations, f.stats().disposed);
  f.add('other-history', directory, 50); const other = (await f.adapter.listSessions('other-history')).sessions[0];
  await assert.rejects(f.adapter.readHistory(other.id, current.historyCursor), { code: 'DEEPSEEK_REQUEST_REJECTED' });
  close();
});

test('cold history shows terminal model failure once and keeps it separate from a later successful result', async t => {
  const f = await fixture(t, { messages: 0 }), id = 'cold/original';
  f.append(id, 'turn/start', { turn: 8 });
  f.append(id, 'user/message', { id: 'failed-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic failed input' }] });
  f.append(id, 'turn/end', { turn: 8, reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'private transport endpoint' } } });
  f.append(id, 'turn/start', { turn: 9 });
  f.append(id, 'assistant/message', { turn: 9, step: 1, message: { id: 'recovered-output', role: 'assistant', content: [{ type: 'text', text: '恢复完成' }] } });
  f.append(id, 'turn/end', { turn: 9, reason: { kind: 'completed' } });
  const row = (await f.adapter.listSessions()).sessions[0]; let close = await f.watch(row.id);
  const messages = f.values.at(-1).messages;
  assert.equal(messages.length, 3, 'original input, runtime failure notice and later result');
  assert.match(messages[1].text, /连接失败/); assert.doesNotMatch(messages[1].text, /private/);
  assert.equal(messages[1].turnId, '8'); assert.equal(messages[1].phase, undefined);
  assert.equal(messages[2].phase, 'final_answer');
  close(); close = await f.watch(row.id);
  assert.deepEqual(f.values.at(-1).messages, messages);
  assert.equal(f.agents.size, 0); assert.deepEqual(f.calls, []);
  close();
});

test('explicit cold send uses official original-session prompt once and confirms by original rpcId', async t => {
  const f = await fixture(t), row = (await f.adapter.listSessions()).sessions[0]; await f.watch(row.id);
  const input = { clientMessageId: randomUUID(), controlToken: f.values.at(-1).control.token, text: '继续原线程', delivery: 'queue' };
  await f.adapter.sendMessage(row.id, input); await until(() => f.values.at(-1).submission?.delivery === 'confirmed');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'prompt');
  assert.equal(f.calls[0].request.sessionId, 'cold/original'); assert.equal(f.calls[0].request.requestId, input.clientMessageId);
  assert.deepEqual(f.calls[0].request.content, [{ type: 'text', text: '继续原线程' }]);
  assert.equal(f.values.at(-1).session.id, row.id); assert.equal(f.agents.size, 1);
  const message = f.values.at(-1).messages.find(message => message.text === '继续原线程'); assert.ok(message);
  await assert.rejects(f.adapter.sendMessage(row.id, input)); assert.equal(f.calls.length, 1);
});

test('uncertain cold admission stays locked after reconnection and is never replayed', async t => {
  const f = await fixture(t, { unknown: true }), row = (await f.adapter.listSessions()).sessions[0]; const close = await f.watch(row.id);
  const result = await f.adapter.sendMessage(row.id, { clientMessageId: randomUUID(), controlToken: f.values.at(-1).control.token, text: '一次消息', delivery: 'queue' });
  assert.equal(result.delivery, 'uncertain'); close(); await f.watch(row.id);
  assert.equal(f.values.at(-1).control.canSend, false); assert.equal(f.values.at(-1).submission.delivery, 'uncertain'); assert.equal(f.calls.length, 1);
});

test('large UTF-8 history pages preserve every message across the byte budget cut', async t => {
  const f = await fixture(t, { messages: 101, longText: '界'.repeat(30000) }), row = (await f.adapter.listSessions()).sessions[0]; await f.watch(row.id);
  const ids = new Set(f.values.at(-1).messages.map(message => message.id)); let cursor = f.values.at(-1).historyCursor, pages = 0;
  while (cursor) {
    assert.ok(++pages < 102); const result = await f.adapter.readHistory(row.id, cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(result.messages)) <= 256 * 1024);
    for (const message of result.messages) { assert.ok(!ids.has(message.id)); ids.add(message.id); }
    cursor = result.cursor;
  }
  assert.equal(ids.size, 101); assert.ok(pages > 3); assert.equal(f.agents.size, 0); assert.deepEqual(f.calls, []);
});

test('cold admission ACK waits for durable rpcId confirmation and rejects stale controls', async t => {
  const f = await fixture(t, { deferred: true }), row = (await f.adapter.listSessions()).sessions[0]; await f.watch(row.id);
  const input = { clientMessageId: randomUUID(), controlToken: f.values.at(-1).control.token, text: '延迟确认', delivery: 'queue' };
  assert.equal((await f.adapter.sendMessage(row.id, input)).delivery, 'submitted');
  await assert.rejects(f.adapter.sendMessage(row.id, input)); assert.equal(f.calls.length, 1);
  f.attach('cold/original');
  f.append('cold/original', 'user/message', { id: 'unrelated', role: 'user', source: { kind: 'user', rpcId: randomUUID() }, content: [{ type: 'text', text: '另一条' }] });
  await until(() => f.values.at(-1).messages.some(message => message.text === '另一条'));
  assert.notEqual(f.values.at(-1).submission.delivery, 'confirmed');
  f.append('cold/original', 'user/message', { id: 'matching', role: 'user', source: { kind: 'user', rpcId: input.clientMessageId }, content: [{ type: 'text', text: input.text }] });
  await until(() => f.values.at(-1).submission.delivery === 'confirmed'); assert.equal(f.calls.length, 1);
});

test('authoritative cold message confirmation wins over a malformed late ACK', async t => {
  const f = await fixture(t, { badAck: true }), row = (await f.adapter.listSessions()).sessions[0]; await f.watch(row.id);
  const result = await f.adapter.sendMessage(row.id, { clientMessageId: randomUUID(), controlToken: f.values.at(-1).control.token, text: '权威消息', delivery: 'queue' });
  assert.equal(result.delivery, 'confirmed'); assert.equal(f.calls.length, 1);
});

test('all-scope requires a compatible history bridge and aborts in-flight read-only pages on stop', async t => {
  const missing = new DeepSeekAdapter({ config: { scope: 'all' }, json: async () => ({ protocol: 1, harnessVersion: '0.2.1-rc.2' }), stop() {} });
  await assert.rejects(missing.listSessions(), { code: 'DEEPSEEK_SCOPE_UNAVAILABLE' }); await missing.stop();
  const f = await fixture(t), row = (await f.adapter.listSessions()).sessions[0]; let waiting = false, aborted = false;
  f.ctx.sessionController.page = (_request, signal) => new Promise((_resolve, reject) => {
    waiting = true; signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  });
  const watch = f.watch(row.id).then(() => assert.fail('pending page must not open'), () => {});
  await until(() => waiting); const start = Date.now(); await f.bridge.stop(); await watch;
  assert.equal(aborted, true); assert.ok(Date.now() - start < 2000); assert.equal(f.stats().observations, f.stats().disposed);
  assert.equal(f.agents.size, 0); assert.deepEqual(f.calls, []);
});

test('recent catalog uses cached metadata, retains running/viewed sessions and discovers desktop activity', async t => {
  const f = await fixture(t), old = Date.now() - 45 * 86400_000;
  f.rows[0].updatedAt = old;
  assert.equal((await f.adapter.listSessions()).sessions.length, 0);
  const all = await f.adapter.listSessions(undefined, undefined, 'all'); assert.equal(all.sessions.length, 1);
  assert.equal(f.listReads(), 1, 'recent/all reuse one short metadata cache');
  const row = all.sessions[0], close = await f.watch(row.id);
  assert.equal((await f.adapter.listSessions()).sessions[0].id, row.id, 'current viewing is retained'); close();
  const agent = f.attach('cold/original'); agent.status = 'running'; f.emit('agent/status', { agent });
  assert.equal((await f.adapter.listSessions()).sessions[0].id, row.id);
  agent.status = 'idle'; f.emit('agent/status', { agent });
  assert.equal((await f.adapter.listSessions()).sessions.length, 0);
  f.rows[0].updatedAt = Date.now(); f.append('cold/original', 'user/message', { id: 'desktop-new', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '电脑新对话' }] });
  assert.equal((await f.adapter.listSessions()).sessions[0].id, row.id);
  f.add('desktop-created', '/synthetic/new-workspace', 0);
  assert.equal((await f.adapter.listSessions()).sessions.length, 2);
  assert.deepEqual(f.calls, []);
});

test('production HTTP factory forwards recent/all range and enforces authentication', async t => {
  const f = await fixture(t), old = Date.now() - 45 * 86400_000; f.rows[0].updatedAt = old;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-dsh-history-http-'));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root, deepseek: f.config }, services: { desktopControl: { stop: async () => {} } } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const headers = { authorization: 'Bearer synthetic-admin' }, url = '/api/agents/deepseek/sessions';
  assert.equal((await app.inject({ url })).statusCode, 401);
  assert.equal((await app.inject({ url, headers })).json().sessions.length, 0);
  assert.equal((await app.inject({ url: url + '?range=all', headers })).json().sessions.length, 1);
  assert.equal((await app.inject({ url: url + '?range=invalid', headers })).statusCode, 400);
  assert.deepEqual(f.calls, []); assert.equal(f.agents.size, 0);
});

test('cold history projects successful turn phases before paging, without activating an Agent', async t => {
  const f = await fixture(t, { messages: 0 });
  const id = 'cold/original';
  const assistant = (name, turn, step, tools = false) => ({ turn, step, message: { id: name, role: 'assistant', content: [{ type: 'text', text: name }, ...(tools ? [{ type: 'tool-call', arguments: 'hidden' }] : [])] } });
  f.append(id, 'turn/start', { turn: 1 });
  f.append(id, 'assistant/message', assistant('old-progress', 1, 1, true));
  f.append(id, 'assistant/message', assistant('old-final', 1, 2));
  f.append(id, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  f.append(id, 'turn/start', { turn: 2 });
  f.append(id, 'assistant/message', assistant('aborted', 2, 1));
  f.append(id, 'turn/end', { turn: 2, reason: { kind: 'aborted' } });
  for (let i = 0; i < 45; i++) f.append(id, 'user/message', { id: `later-${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'later' }] });
  const publicId = (await f.adapter.listSessions()).sessions[0].id;
  await f.watch(publicId);
  let cursor = f.values.at(-1).historyCursor, all = [...f.values.at(-1).messages];
  while (cursor) { const page = await f.adapter.readHistory(publicId, cursor); all = [...page.messages, ...all]; cursor = page.cursor; }
  assert.deepEqual(all.filter(message => message.role === 'assistant').map(message => [message.text, message.phase, message.turnId]), [['old-progress', 'commentary', '1'], ['old-final', 'final_answer', '1'], ['aborted', 'commentary', '2']]);
  assert.equal(f.agents.size, 0); assert.deepEqual(f.calls, []);
});
