import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OpenCodeClient } from '../dist/agents/openCodeClient.js';
import { OpenCodeAdapter } from '../dist/agents/openCodeAdapter.js';
import { messagesSchema, sessionsSchema } from '../dist/agents/openCodeProtocol.js';
import { AgentGateway } from '../dist/agents/agentGateway.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { parseManagedConfig } from '../dist/gateway/config.js';

const sessionID = 'ses_synthetic', directory = '/synthetic/project';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 3000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() > end) assert.fail('Synthetic OpenCode state timed out'); await sleep(5); } }
const user = (id, text) => ({ id, type: 'user', text, time: { created: 1000 } });
const assistant = text => ({ id: 'msg_assistant', type: 'assistant', time: { created: 2000 }, content: [
  { type: 'reasoning', text: 'synthetic hidden reasoning' },
  { type: 'text', text }, { type: 'tool', state: { status: 'running' } },
] });

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-code-test-'));
  const streams = new Set(), sockets = new Set(), requests = [];
  const state = {
    session: { id: sessionID, title: 'Synthetic OpenCode', location: { directory }, time: { updated: 3000 } },
    messages: [user('msg_user', 'synthetic initial input'), assistant('synthetic output')], active: true,
    questions: [{ id: 'frm_synthetic', sessionID, title: 'Questions', metadata: { kind: 'question' }, fields: [
      { key: 'q0', title: 'Multiple', description: 'Which improvements?', type: 'multiselect', custom: false, options: [{ value: 'first-value', label: 'A', description: 'First' }, { value: 'second-value', label: 'B', description: 'Second' }] },
      { key: 'q1', title: 'Details', description: 'Anything else?', type: 'string', options: [], custom: true },
    ] }],
    permissions: [{ id: 'per_synthetic', sessionID, action: 'edit', resources: ['/synthetic/project/file.txt'], save: ['/synthetic/project/**'], metadata: { diff: '-before\n+after' } }],
    mode: 'normal', eventMode: 'normal', connections: 0,
  };
  const json = (response, value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://local');
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body: body ? JSON.parse(body) : undefined, auth: request.headers.authorization });
    if (options.password && request.headers.authorization !== `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`) return json(response, { error: 'synthetic-private-password' }, 401);
    if (url.pathname === '/api/event') {
      state.connections++;
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders();
      streams.add(response); response.once('close', () => streams.delete(response));
      if (state.eventMode === 'silent') return;
      const frame = `data: ${JSON.stringify({ id: 'evt_connected', type: 'server.connected', data: { label: '合成 📱' } })}\r\n\r\n`;
      if (state.eventMode === 'bad') return response.write('data: {bad-json}\n\n');
      if (state.eventMode === 'split') { const bytes = Buffer.from(frame), index = bytes.indexOf(Buffer.from('📱')) + 1; response.write(bytes.subarray(0, index)); setTimeout(() => response.write(bytes.subarray(index)), 5); }
      else response.write(frame);
      return;
    }
    if (state.mode === 'redirect') { response.writeHead(302, { location: '/unwanted' }); response.end(); return; }
    if (state.mode === 'bad-json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{bad'); return; }
    if (state.mode === 'too-large') { json(response, 'x'.repeat(4 * 1024 * 1024 + 1)); return; }
    if (state.mode === 'wrong-type') { response.end('<html>wrong service</html>'); return; }
    if (state.mode === 'silent') return;
    if (url.pathname === '/api/info') return json(response, { version: options.version ?? '2.0.16', pid: 1, urls: [], paths: { tmp: '/synthetic/tmp' } });
    if (url.pathname === '/api/session') return json(response, { data: [state.session, { ...state.session, id: 'ses_other', location: { directory: '/synthetic/other' } }], cursor: options.cursor ?? {} });
    if (url.pathname === '/api/session/active') return json(response, { data: state.active ? { [sessionID]: { type: 'running' } } : {} });
    if (url.pathname === `/api/session/${sessionID}`) return json(response, { data: state.session });
    if (url.pathname === `/api/session/${sessionID}/message`) return json(response, { data: state.messages, cursor: options.cursor ?? (url.searchParams.has('cursor') ? {} : { next: 'synthetic-history-cursor' }) });
    if (url.pathname === `/api/session/${sessionID}/form`) return json(response, { data: state.questions });
    if (url.pathname === `/api/session/${sessionID}/permission`) return json(response, { data: state.permissions });
    if (request.method === 'POST' && url.pathname.endsWith('/prompt')) {
      if (state.mode === 'unknown-message') return response.destroy();
      const input = JSON.parse(body);
      if (typeof input.text !== 'string' || input.prompt) return json(response, {}, 400);
      state.messages.push(user(input.id, input.text));
      return json(response, { data: { id: input.id, sessionID, type: 'user', time: { created: 1000 }, payload: { text: input.text }, delivery: input.delivery } });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/interrupt')) { state.active = false; return json(response, { interrupted: state.mode !== 'idle-interrupt' }); }
    if (request.method === 'POST' && url.pathname.endsWith('/reply')) {
      if (state.mode === 'unknown-reply') return response.destroy();
      response.writeHead(204); response.end(); return;
    }
    json(response, { error: 'synthetic-private-server-error' }, 404);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = { url: `http://127.0.0.1:${server.address().port}`, directory, ...(options.password ? { password: options.password } : {}) };
  const client = new OpenCodeClient(config, { timeoutMs: options.timeoutMs ?? 500, idleMs: options.idleMs ?? 3000 }), adapter = new OpenCodeAdapter(client);
  t.after(async () => { await adapter.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const emit = (type = 'session.renamed', data = { sessionID }, id = `evt_${randomUUID()}`) => { for (const stream of streams) stream.write(`: heartbeat\n\ndata: ${JSON.stringify({ id, type, data, created: 2100 })}\n\n`); };
  const snapshots = [];
  const follow = async () => adapter.watchSession(sessionID, value => snapshots.push(value), () => {});
  const latest = () => snapshots.at(-1);
  const operation = () => ({ controlToken: latest().control.token, clientMessageId: randomUUID() });
  const posts = suffix => requests.filter(request => request.method === 'POST' && request.path.endsWith(suffix));
  return { root, config, client, adapter, state, streams, requests, emit, snapshots, follow, latest, operation, posts };
}

test('configuration is explicit, loopback-only and strict; construction has no connection side effects', async t => {
  const f = await fixture(t);
  assert.equal(f.requests.length, 0);
  for (const input of [{ url: 'https://example.com' }, { url: 'http://localhost:4096' }, { url: 'http://u:p@127.0.0.1' }, { url: 'http://127.0.0.1/path' }, { directory: 'relative' }, { extra: true }]) {
    assert.throws(() => new OpenCodeClient({ ...f.config, ...input }), { code: 'OPENCODE_CONFIG_INVALID' });
  }
  const base = { version: 1, port: 8787, token: 't'.repeat(32), managerKey: 'm'.repeat(32), workspace: f.root, codexHome: f.root, desktopTransport: 'native' };
  assert.equal(parseManagedConfig({ ...base, opencode: f.config }).opencode.directory, directory);
  assert.throws(() => parseManagedConfig({ ...base, opencode: { ...f.config, url: 'http://example.com' } }), { code: 'GATEWAY_CONFIG_INVALID' });
});

test('probe checks 2.0.16 server info and list, authenticates Basic Auth and filters directory scope', async t => {
  const f = await fixture(t, { password: 'synthetic-private-credential' });
  assert.equal(f.adapter.snapshot().state, 'unprobed');
  assert.equal((await f.adapter.probe()).state, 'connected');
  const result = await f.adapter.listSessions('Synthetic');
  assert.equal(result.sessions.length, 1); assert.equal(result.sessions[0].id, sessionID);
  assert.ok(f.requests.every(request => request.auth?.startsWith('Basic ')));
  assert.equal(f.requests.at(-1).query.get('directory'), directory);
  assert.equal(f.requests.at(-1).query.get('search'), 'Synthetic');
  assert.equal(f.state.connections, 0);
  assert.ok(!JSON.stringify(f.adapter.snapshot()).includes('synthetic-private'));
  assert.equal(f.requests[0].path, '/api/info');
  assert.equal(f.requests.some(request => request.path === '/api/health'), false);
});

for (const version of ['1.19.3', '2.0.17', 'unknown']) test(`unreviewed server ${version} cannot publish sessions or controls`, async t => {
  const f = await fixture(t, { version });
  assert.equal((await f.adapter.probe()).errorCode, 'OPENCODE_VERSION_UNSUPPORTED');
  await assert.rejects(f.follow(), { code: 'OPENCODE_VERSION_UNSUPPORTED' });
  assert.equal(f.snapshots.length, 0); assert.equal(f.state.connections, 0);
  assert.ok(f.requests.every(request => request.path === '/api/info'));
});

test('an untitled 2.0.16 session remains selectable', async t => {
  const f = await fixture(t); delete f.state.session.title;
  assert.equal((await f.adapter.listSessions()).sessions[0].title, '未命名会话');
});

test('official null cursors keep session list, subscription and history usable', async t => {
  const f = await fixture(t, { cursor: { previous: null, next: null } });
  const page = await f.adapter.listSessions();
  assert.equal(page.sessions.length, 1);
  assert.equal(page.cursor, null);
  await f.follow();
  assert.equal(f.latest().connected, true);
  assert.equal(f.latest().historyCursor, null);
  assert.equal(f.latest().messages.length, 2);
  const history = await f.adapter.readHistory(sessionID, 'synthetic-cursor');
  assert.equal(history.cursor, null);
  assert.equal(history.messages.length, 2);
});

test('cursor decoders accept absent, null and string fields while rejecting invalid or oversized values', () => {
  for (const schema of [sessionsSchema, messagesSchema]) {
    for (const cursor of [{}, { previous: null, next: null }, { previous: null, next: 'page' }, { previous: 'page', next: null }]) {
      assert.deepEqual(schema.parse({ data: [], cursor }).cursor, cursor);
    }
    for (const cursor of [null, { next: 1 }, { previous: false }, { next: {} }, { previous: 'x'.repeat(8193) }]) {
      assert.equal(schema.safeParse({ data: [], cursor }).success, false);
    }
  }
});

test('one upstream SSE serves concurrent observers; canonical refresh streams text while the task remains active', async t => {
  const f = await fixture(t); f.state.eventMode = 'split';
  const [stop, stopOther] = await Promise.all([f.follow(), f.follow()]);
  assert.equal(f.state.connections, 1); assert.equal(f.latest().status, 'running');
  assert.equal(f.latest().activity, 'working');
  assert.ok(!JSON.stringify(f.latest()).includes('hidden reasoning'));
  const text = { sessionID, assistantMessageID: 'msg_assistant', ordinal: 1 };
  f.emit('session.text.started', text);
  f.emit('session.text.delta', { ...text, delta: ' with another token' });
  await until(() => f.latest().messages.some(message => message.text.includes('another token')));
  assert.equal(f.latest().status, 'running');
  assert.equal(f.latest().activity, 'outputting');
  assert.equal(f.state.messages[1].content.some(part => part.text?.includes('another token')), false);
  stop(); assert.equal(f.streams.size, 1); stopOther(); await until(() => !f.streams.size);
});

test('prompt sends steer or queue to the selected existing session and validates the admitted ID', async t => {
  const f = await fixture(t); await f.follow();
  for (const delivery of ['steer', 'queue']) {
    const operation = f.operation();
    assert.equal((await f.adapter.sendMessage(sessionID, { ...operation, text: 'synthetic next input', delivery })).delivery, 'confirmed');
    const post = f.posts('/prompt').at(-1);
    assert.equal(post.path, `/api/session/${sessionID}/prompt`);
    assert.deepEqual(post.body, { id: `msg_${operation.clientMessageId.replaceAll('-', '')}`, text: 'synthetic next input', delivery });
  }
  assert.equal(f.requests.some(request => request.method === 'POST' && request.path === '/api/session'), false);
});

test('text deltas render before REST catches up; duplicate event IDs do not duplicate text and text.ended corrects a mid-run join', async t => {
  const f = await fixture(t); await f.follow();
  const text = { sessionID, assistantMessageID: 'msg_assistant', ordinal: 1 };
  const reads = f.requests.filter(request => request.path.endsWith('/message')).length;
  f.emit('session.text.delta', { ...text, delta: 'received suffix' }, 'evt_same-delta');
  f.emit('session.text.delta', { ...text, delta: 'received suffix' }, 'evt_same-delta');
  await until(() => f.latest().messages.some(message => message.text.includes('received suffix')));
  assert.equal(f.latest().partialText, true);
  assert.equal(f.latest().messages.find(message => message.id === 'msg_assistant').text.match(/received suffix/g).length, 1);
  assert.equal(f.requests.filter(request => request.path.endsWith('/message')).length, reads);
  f.emit('session.text.ended', { ...text, text: 'full prefix and received suffix' });
  await until(() => f.latest().partialText === false && f.latest().messages.some(message => message.text.includes('full prefix')));
  f.state.messages[1].content.push({ type: 'text', text: 'full prefix and received suffix' }); f.emit();
  await sleep(160);
  assert.equal(f.latest().messages.find(message => message.id === 'msg_assistant').text.match(/full prefix/g).length, 1);
});

test('content ordinals preserve interleaved parts and late earlier text without exposing private parts', async t => {
  const f = await fixture(t); await f.follow();
  const text = { sessionID, assistantMessageID: 'msg_assistant' };
  f.emit('session.text.delta', { ...text, ordinal: 3, delta: 'later visible text' });
  f.emit('session.text.delta', { ...text, ordinal: 1, delta: 'earlier visible text' });
  await until(() => f.latest().messages.some(message => message.text.includes('earlier visible text')));
  const result = f.latest().messages.find(message => message.id === 'msg_assistant');
  assert.equal(result.text, 'synthetic output\n\nearlier visible text\n\nlater visible text');
  assert.equal(f.latest().partialText, true);
  assert.ok(!JSON.stringify(f.latest()).includes('hidden reasoning'));
  f.emit('session.text.delta', { ...text, ordinal: -1, delta: 'invalid' });
  await until(() => !f.latest().connected);
  assert.equal(f.latest().control, null);
});

test('admission event confirms a queued prompt with unknown HTTP outcome before promotion into messages', async t => {
  const f = await fixture(t); await f.follow(); f.state.mode = 'unknown-message';
  const operation = f.operation();
  await f.adapter.sendMessage(sessionID, { ...operation, text: 'queued synthetic input', delivery: 'queue' });
  f.emit('session.inbox.enqueued', { sessionID, inboxID: `msg_${operation.clientMessageId.replaceAll('-', '')}`, item: { type: 'user', delivery: 'queue', payload: { text: 'queued synthetic input' } } });
  await until(() => f.latest().submission?.delivery === 'confirmed');
  assert.equal(f.posts('/prompt').length, 1); assert.equal(f.latest().control.canSend, true);
});

test('private reasoning and tool input deltas update activity without polling REST or exposing payloads', async t => {
  const f = await fixture(t); await f.follow();
  const reads = f.requests.length;
  for (const [type, activity] of [['session.reasoning.delta', 'thinking'], ['session.tool.input.delta', 'working']]) {
    for (let i = 0; i < 30; i++) f.emit(type, { sessionID, delta: 'synthetic-private-token' });
    await until(() => f.latest().activity === activity);
  }
  await sleep(160);
  assert.equal(f.requests.length, reads);
  assert.ok(!JSON.stringify(f.latest()).includes('synthetic-private-token'));
});

test('unknown prompt is locked across reconnect and canonical receipt unlocks it without replay', async t => {
  const f = await fixture(t); let stop = await f.follow(); f.state.mode = 'unknown-message';
  const operation = f.operation(), result = await f.adapter.sendMessage(sessionID, { ...operation, text: 'one synthetic input', delivery: 'steer' });
  assert.equal(result.delivery, 'uncertain'); assert.equal(f.latest().control.canSend, false);
  await assert.rejects(f.adapter.sendMessage(sessionID, { ...f.operation(), text: 'duplicate', delivery: 'queue' }), { code: 'OPENCODE_PREVIOUS_RESULT_UNKNOWN' });
  stop(); stop = await f.follow(); assert.equal(f.latest().submission.delivery, 'uncertain');
  assert.equal(f.posts('/prompt').length, 1);
  f.state.messages.push(user(`msg_${operation.clientMessageId.replaceAll('-', '')}`, 'one synthetic input')); f.emit();
  await until(() => f.latest().submission?.delivery === 'confirmed'); assert.equal(f.latest().control.canSend, true); stop();
});

test('interrupt is bodyless, awaits idle evidence and allows interruption of a later running task', async t => {
  const f = await fixture(t); await f.follow();
  assert.equal((await f.adapter.interruptSession(sessionID, f.operation())).delivery, 'submitted');
  assert.equal(f.posts('/interrupt')[0].body, undefined);
  await until(() => f.latest().status === 'idle'); assert.equal(f.latest().submission.delivery, 'confirmed');
  f.state.active = true; f.emit(); await until(() => f.latest().control.canInterrupt);
  await f.adapter.interruptSession(sessionID, f.operation()); assert.equal(f.posts('/interrupt').length, 2);
});

test('an authoritative interrupted=false is an idle no-op and does not leave an unknown write lock', async t => {
  const f = await fixture(t); await f.follow(); f.state.mode = 'idle-interrupt';
  await assert.rejects(f.adapter.interruptSession(sessionID, f.operation()), { code: 'OPENCODE_SESSION_IDLE' });
  await until(() => f.latest().status === 'idle');
  assert.equal(f.latest().submission, null); assert.equal(f.latest().control.canSend, true);
  assert.equal(f.posts('/interrupt').length, 1); assert.equal(f.posts('/interrupt')[0].body, undefined);
});

test('question answers preserve order, multi-select and custom input and submit only once', async t => {
  const f = await fixture(t); await f.follow(); const question = f.latest().questions[0];
  assert.notEqual(question.id, 'frm_synthetic');
  await assert.rejects(f.adapter.respondQuestion(sessionID, question.id, { ...f.operation(), answers: [['not-allowed'], ['details']] }), { code: 'OPENCODE_INVALID_ANSWER' });
  assert.equal(f.posts('/reply').length, 0);
  const response = await f.adapter.respondQuestion(sessionID, question.id, { ...f.operation(), answers: [['A', 'B'], ['custom details']] });
  assert.equal(response.delivery, 'submitted');
  assert.deepEqual(f.posts('/reply')[0].body, { answer: { q0: ['first-value', 'second-value'], q1: 'custom details' } });
  assert.equal(f.posts('/reply')[0].path, `/api/session/${sessionID}/form/frm_synthetic/reply`);
  await assert.rejects(f.adapter.respondQuestion(sessionID, question.id, { ...f.operation(), answers: [['A'], ['again']] }), { code: 'OPENCODE_REQUEST_EXPIRED' });
  assert.equal(f.posts('/reply').length, 1);
});

test('unsupported forms stay visible with a reason, cannot post answers and leave ordinary controls available', async t => {
  const f = await fixture(t); await f.follow();
  const base = structuredClone(f.state.questions[0]);
  const variants = [
    { ...base, metadata: { kind: 'mcp-elicitation' } },
    { ...base, fields: [{ key: 'count', type: 'integer', title: 'Count' }] },
    { ...base, fields: [{ ...base.fields[0], hidden: true }] },
    { ...base, fields: [{ ...base.fields[0], when: [{ key: 'q1', op: 'eq', value: 'x' }] }] },
    { ...base, fields: [{ ...base.fields[1], pattern: '.*' }] },
    { ...base, fields: [{ key: 'login', type: 'external', url: 'https://example.invalid/private-auth' }] },
    { ...base, fields: [{ ...base.fields[0], options: [{ value: 'a', label: 'Same' }, { value: 'b', label: 'Same' }] }] },
    { ...base, fields: [{ ...base.fields[0], options: [{ value: 'a', label: 'A', privateConstraint: true }] }] },
  ];
  for (const form of variants) {
    const previous = f.latest().questions[0].id;
    f.state.questions = [form]; f.emit('form.created', { form });
    await until(() => f.latest().questions[0]?.id !== previous);
    assert.ok(f.latest().questions[0].unavailableReason.includes('电脑处理'));
    assert.equal(f.latest().control.canSend, true);
    await assert.rejects(f.adapter.respondQuestion(sessionID, f.latest().questions[0].id, { ...f.operation(), answers: [['anything']] }), { code: 'OPENCODE_FORM_UNSUPPORTED' });
  }
  assert.equal(f.posts('/reply').length, 0);
  assert.ok(!JSON.stringify(f.latest()).includes('privateConstraint'));
});

test('changed question signature and changed session location reject stale answers before sending', async t => {
  const f = await fixture(t); await f.follow(); let question = f.latest().questions[0];
  f.state.questions[0].fields[0].description = 'changed prompt';
  await assert.rejects(f.adapter.respondQuestion(sessionID, question.id, { ...f.operation(), answers: [['A'], ['details']] }), { code: 'OPENCODE_REQUEST_EXPIRED' });
  f.emit(); await until(() => f.latest().questions[0].id !== question.id); question = f.latest().questions[0];
  f.state.session.location.directory = '/synthetic/other';
  await assert.rejects(f.adapter.respondQuestion(sessionID, question.id, { ...f.operation(), answers: [['A'], ['details']] }), { code: 'OPENCODE_SESSION_OUT_OF_SCOPE' });
  assert.equal(f.posts('/reply').length, 0);
});

test('unknown reply stays locked after reconnect; authoritative removal does not restore the form', async t => {
  const f = await fixture(t); let stop = await f.follow(); f.state.mode = 'unknown-reply';
  const question = f.latest().questions[0];
  assert.equal((await f.adapter.respondQuestion(sessionID, question.id, { ...f.operation(), answers: [['A'], ['details']] })).delivery, 'uncertain');
  stop(); stop = await f.follow();
  assert.equal(f.latest().questions[0].status, 'uncertain'); assert.equal(f.posts('/reply').length, 1);
  f.state.questions = []; f.emit(); await until(() => !f.latest().questions.length); stop();
});

test('request signatures include hidden origin and nested context without publishing them to mobile', async t => {
  const f = await fixture(t);
  f.state.questions[0].metadata.tool = { callID: 'synthetic-private-origin' };
  f.state.questions[0].metadata.context = { prompt: 'synthetic-private-question' };
  f.state.questions[0].fields[0].options[0].value = 'synthetic-private-option';
  f.state.permissions[0].source = { callID: 'synthetic-private-origin' };
  await f.follow();
  for (const change of [
    () => { f.state.questions[0].metadata.tool.callID = 'another-origin'; },
    () => { f.state.questions[0].metadata.context.prompt = 'another-question'; },
    () => { f.state.questions[0].fields[0].options[0].value = 'another-option'; },
  ]) {
    const previous = f.latest().questions[0]; change();
    await assert.rejects(f.adapter.respondQuestion(sessionID, previous.id, { ...f.operation(), answers: [['A'], ['details']] }), { code: 'OPENCODE_REQUEST_EXPIRED' });
    f.emit(); await until(() => f.latest().questions[0].id !== previous.id);
  }
  const previous = f.latest().permissions[0];
  f.state.permissions[0].source.callID = 'another-origin';
  await assert.rejects(f.adapter.respondPermission(sessionID, previous.id, { ...f.operation(), decision: 'once' }), { code: 'OPENCODE_REQUEST_EXPIRED' });
  f.emit(); await until(() => f.latest().permissions[0].id !== previous.id);
  assert.ok(!JSON.stringify(f.latest()).includes('synthetic-private'));
  assert.equal(f.posts('/reply').length, 0);
});

test('permission displays exact requested and saved scopes and cannot invent a saved rule', async t => {
  const f = await fixture(t); await f.follow(); let permission = f.latest().permissions[0];
  assert.deepEqual(permission.resources, ['/synthetic/project/file.txt']); assert.deepEqual(permission.save, ['/synthetic/project/**']);
  assert.ok(permission.detail.includes('-before')); assert.deepEqual(permission.decisions, ['once', 'always', 'reject']);
  await f.adapter.respondPermission(sessionID, permission.id, { ...f.operation(), decision: 'always' });
  assert.deepEqual(f.posts('/reply')[0].body, { decision: 'always' });
  f.state.permissions[0].save = []; f.emit(); await until(() => f.latest().permissions[0].id !== permission.id); permission = f.latest().permissions[0];
  await assert.rejects(f.adapter.respondPermission(sessionID, permission.id, { ...f.operation(), decision: 'always' }), { code: 'OPENCODE_DECISION_UNAVAILABLE' });
  assert.equal(f.posts('/reply').length, 1);
});

test('upstream loss clears live cards and capabilities and invalidates old control and request tokens', async t => {
  const f = await fixture(t); await f.follow(); const operation = f.operation(), question = f.latest().questions[0];
  for (const stream of f.streams) stream.destroy();
  await until(() => f.latest()?.connected === false);
  assert.equal(f.latest().control, null); assert.deepEqual(f.latest().questions, []); assert.deepEqual(f.latest().permissions, []);
  await f.follow(); assert.notEqual(f.latest().control.token, operation.controlToken); assert.notEqual(f.latest().questions[0].id, question.id);
  await assert.rejects(f.adapter.sendMessage(sessionID, { ...operation, text: 'stale', delivery: 'steer' }), { code: 'OPENCODE_CONTROL_EXPIRED' });
  assert.equal(f.posts('/prompt').length, 0);
});

test('foreign-session question payload cannot grant writable state', async t => {
  const f = await fixture(t); f.state.questions[0].sessionID = 'ses_other';
  await assert.rejects(f.follow(), { code: 'OPENCODE_PROTOCOL_ERROR' });
  assert.equal(f.posts('/reply').length, 0);
});

for (const mode of ['bad-json', 'wrong-type', 'too-large', 'redirect', 'silent']) test(`HTTP ${mode} fails with a bounded sanitized error`, async t => {
  const f = await fixture(t, { timeoutMs: 100 }); f.state.mode = mode;
  await assert.rejects(f.client.json('/api/info', z.object({ version: z.string() })), error => error.code.startsWith('OPENCODE_') && !error.message.includes('private'));
  assert.equal(f.requests.some(request => request.path === '/unwanted'), false);
});

for (const eventMode of ['bad', 'silent']) test(`SSE ${eventMode} is rejected before any writable snapshot`, async t => {
  const f = await fixture(t, { timeoutMs: 100 }); f.state.eventMode = eventMode;
  await assert.rejects(f.follow()); assert.equal(f.snapshots.length, 0);
});

test('stop cancels initialization and never stops or creates a session in the upstream server', async t => {
  const f = await fixture(t); f.state.eventMode = 'silent';
  const pending = f.follow(); await until(() => f.state.connections > 0); await f.adapter.stop();
  await assert.rejects(pending); assert.equal(f.posts('/interrupt').length, 0); assert.equal(f.posts('/prompt').length, 0);
  await assert.rejects(f.adapter.listSessions(), { code: 'OPENCODE_STOPPED' });
});

test('Relay routes authenticate devices, bind SSE token to agent/session, deduplicate writes and revoke live streams', async t => {
  const f = await fixture(t);
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(f.root, 'empty-codex'), defaultCwd: f.root },
    services: { agentGateway: new AgentGateway([f.adapter]), desktopControl: { stop: async () => {} } } });
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`, route = `/api/agents/opencode/sessions/${sessionID}`;
  const auth = { authorization: 'Bearer synthetic-admin' };
  assert.equal((await app.inject({ url: '/api/agents', headers: auth })).statusCode, 200); assert.equal(f.requests.length, 0);
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code } })).json(); assert.ok(device.token);
  const deviceAuth = { authorization: `Bearer ${device.token}` };
  assert.equal((await app.inject({ url: '/api/agents/opencode/sessions' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/agents/opencode/sessions', headers: deviceAuth })).statusCode, 200);
  const streamToken = (await app.inject({ method: 'POST', url: `${route}/stream-token`, headers: deviceAuth })).json().streamToken;
  assert.equal((await fetch(`${base}/api/agents/opencode/sessions/ses_other/events?streamToken=${streamToken}`)).status, 401);
  const response = await fetch(`${base}${route}/events?streamToken=${streamToken}`), reader = response.body.getReader(); let text = '';
  await until(async () => { const { value } = await reader.read(); text += new TextDecoder().decode(value); return text.includes('agent-session'); });
  assert.equal(response.status, 200);
  const snapshot = JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5));
  const payload = { controlToken: snapshot.control.token, clientMessageId: randomUUID(), text: 'one authorized input', delivery: 'steer' };
  const inputs = { method: 'POST', url: `${route}/messages`, headers: deviceAuth, payload };
  const [first, second] = await Promise.all([app.inject(inputs), app.inject(inputs)]);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200); assert.equal(first.json().delivery, 'confirmed'); assert.equal(f.posts('/prompt').length, 1);
  assert.equal((await app.inject({ ...inputs, payload: { ...payload, text: 'changed body' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `${route}/permissions/${randomUUID()}/respond`, headers: deviceAuth, payload: { ...payload, decision: 'always' } })).statusCode, 400);
  const devices = (await app.inject({ url: '/api/devices', headers: deviceAuth })).json();
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${devices.devices[0].id}`, headers: auth })).statusCode, 200);
  assert.equal((await fetch(`${base}${route}/events?streamToken=${streamToken}`)).status, 401);
  await reader.cancel().catch(error => assert.equal(error.message, 'terminated'));
  await until(() => !f.streams.size);
});
