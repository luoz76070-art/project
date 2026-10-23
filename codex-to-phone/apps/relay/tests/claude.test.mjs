import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ClaudeAdapter } from '../dist/agents/claudeAdapter.js';
import { AgentGateway } from '../dist/agents/agentGateway.js';
import { claudeRegisterSchema, claudeConfigSchema, claudeInteractionWaitSchema } from '../dist/agents/claudeProtocol.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { parseManagedConfig } from '../dist/gateway/config.js';
import { register } from '../../../plugins/mobile-claude/hooks/register.mjs';

const registration = () => ({ sessionId: randomUUID(), activationId: randomUUID(), version: '2.1.287', directory: '/synthetic/claude-project', turnId: null });
const history = [{ role: 'user', text: 'Synthetic question' }, { role: 'assistant', text: 'Synthetic answer' }];
async function until(predicate) { const end = Date.now() + 4000; while (!await predicate()) { if (Date.now() > end) throw new Error('synthetic fixture timeout'); await sleep(8); } }
function fixture(t, limits = { leaseMs: 1000, pollMs: 15, operationMs: 500 }, interactions = false) {
  const adapter = new ClaudeAdapter(limits), input = { ...registration(), ...(interactions ? { interactions: 1 } : {}) }, host = adapter.register(input);
  const views = []; let sequence = 0, disconnected = 0;
  t.after(() => adapter.stop());
  const emit = events => adapter.ingest(input.sessionId, host.generation, ++sequence, events);
  const watch = () => adapter.watchSession(input.sessionId, value => views.push(value), () => ++disconnected);
  const poll = () => adapter.poll(input.sessionId, host.generation);
  const latest = () => views.at(-1);
  const op = () => ({ controlToken: host.generation, clientMessageId: randomUUID() });
  async function ready() { const unwatch = await watch(); await poll(); emit([{ type: 'messages', messages: history, partial: false }]); return unwatch; }
  return { adapter, input, host, emit, watch, poll, latest, op, ready, disconnected: () => disconnected };
}

test('configuration, registration and passive status expose no credentials or startup side effects', async t => {
  const adapter = new ClaudeAdapter(); t.after(() => adapter.stop());
  assert.deepEqual((await adapter.listSessions()).sessions, []);
  assert.equal(adapter.snapshot().capabilities.approve, false);
  assert.equal(adapter.snapshot().capabilities.steer, false);
  for (const version of ['2.1.220', '2.1.276', '2.1.277', '2.1.286', '2.2.0', '3.0.0', 'malformed']) assert.equal(claudeRegisterSchema.safeParse({ ...registration(), version }).success, false);
  assert.equal(claudeRegisterSchema.safeParse({ ...registration(), directory: 'relative' }).success, false);
  assert.equal(claudeConfigSchema.safeParse({ bridgeToken: 'short' }).success, false);
  const config = { version: 1, port: 8787, token: 't'.repeat(32), managerKey: 'm'.repeat(32), workspace: '/synthetic', codexHome: '/synthetic/empty', desktopTransport: 'native' };
  assert.equal(parseManagedConfig({ ...config, claude: { bridgeToken: 'c'.repeat(32) } }).claude.bridgeToken.length, 32);
  assert.throws(() => parseManagedConfig({ ...config, claude: { bridgeToken: 'bad' } }), { code: 'GATEWAY_CONFIG_INVALID' });
  for (const bridgeToken of [config.token, config.managerKey]) assert.throws(() => parseManagedConfig({ ...config, claude: { bridgeToken } }), { code: 'GATEWAY_CONFIG_INVALID' });
});

test('original session registration is idempotent but a different live owner cannot replace it', async t => {
  const f = fixture(t);
  assert.equal(f.adapter.register(f.input).generation, f.host.generation);
  assert.throws(() => f.adapter.register({ ...f.input, activationId: randomUUID() }), { code: 'CLAUDE_SESSION_ALREADY_ATTACHED' });
  assert.throws(() => f.adapter.register({ ...f.input, directory: '/other' }), { code: 'CLAUDE_REGISTRATION_CHANGED' });
  assert.equal((await f.adapter.listSessions('synthetic')).sessions[0].id, f.input.sessionId);
  assert.equal(f.adapter.validSessionId('ses_wrong_agent'), false);
  assert.equal(f.adapter.snapshot().capabilities.sendMessage, true);
  assert.equal(f.adapter.snapshot().capabilities.approve, false);
});

test('subscribing asks the existing host for text, and losing the last subscriber discards messages', async t => {
  const f = fixture(t);
  const unwatch = await f.watch(); assert.equal(f.latest().control.canSend, false);
  assert.equal((await f.poll()).commands[0].type, 'snapshot');
  f.emit([{ type: 'messages', messages: history, partial: false }]);
  assert.equal(f.latest().messages.length, 2); assert.equal(f.latest().control.canSend, true);
  unwatch();
  await f.watch(); assert.equal(f.latest().messages.length, 0); assert.equal(f.latest().control.canSend, false);
});

test('only queue delivery is allowed and host admission confirms acceptance without claiming turn completion', async t => {
  const f = fixture(t); await f.ready(); const op = f.op();
  await assert.rejects(f.adapter.sendMessage(f.input.sessionId, { ...op, text: 'hello', delivery: 'steer' }), { code: 'CLAUDE_STEER_UNAVAILABLE' });
  assert.equal((await f.adapter.sendMessage(f.input.sessionId, { ...op, text: 'hello', delivery: 'queue' })).delivery, 'submitted');
  await assert.rejects(f.adapter.sendMessage(f.input.sessionId, { ...f.op(), text: 'double', delivery: 'queue' }), { code: 'CLAUDE_OPERATION_PENDING' });
  const sent = (await f.poll()).commands; assert.deepEqual(sent, [{ id: op.clientMessageId, type: 'message', text: 'hello' }]);
  assert.equal((await f.poll()).commands.length, 0);
  f.emit([{ type: 'state', turnId: 'turn-original', activity: 'thinking' }, { type: 'receipt', id: op.clientMessageId, delivery: 'confirmed' }]);
  assert.equal(f.latest().submission.delivery, 'confirmed'); assert.equal(f.latest().status, 'running');
});

test('lost delivery is never replayed and uncertainty remains locked across re-registration', async t => {
  const f = fixture(t, { leaseMs: 500, pollMs: 5, operationMs: 20 }); await f.ready();
  await f.adapter.sendMessage(f.input.sessionId, { ...f.op(), text: 'one input', delivery: 'queue' }); await f.poll();
  await sleep(25); f.adapter.snapshot();
  assert.equal(f.latest().submission.delivery, 'uncertain'); assert.equal((await f.poll()).commands.length, 0);
  await assert.rejects(f.adapter.sendMessage(f.input.sessionId, { ...f.op(), text: 'retry', delivery: 'queue' }), { code: 'CLAUDE_OPERATION_PENDING' });
  f.adapter.end(f.input.sessionId, f.host.generation);
  const next = f.adapter.register(f.input); assert.notEqual(next.generation, f.host.generation);
  const views = []; await f.adapter.watchSession(f.input.sessionId, v => views.push(v), () => {});
  f.adapter.ingest(f.input.sessionId, next.generation, 1, [{ type: 'messages', messages: history, partial: false }]);
  assert.equal(views.at(-1).submission.delivery, 'uncertain'); assert.equal(views.at(-1).control.canSend, false);
});

test('an operation expiring before host dequeue is safely rejected and does not discard the draft', async t => {
  const f = fixture(t, { leaseMs: 500, pollMs: 5, operationMs: 20 }); await f.ready();
  await f.adapter.sendMessage(f.input.sessionId, { ...f.op(), text: 'unsent', delivery: 'queue' });
  await sleep(25); f.adapter.snapshot();
  assert.equal(f.latest().submission, null); assert.equal(f.latest().operationError.code, 'expired'); assert.equal(f.latest().control.canSend, true);
  assert.equal((await f.poll()).commands.length, 0);
});

test('a late authoritative host receipt can resolve an uncertain operation without replaying it', async t => {
  const f = fixture(t, { leaseMs: 500, pollMs: 5, operationMs: 20 }); await f.ready(); const op = f.op();
  await f.adapter.sendMessage(f.input.sessionId, { ...op, text: 'one delayed receipt', delivery: 'queue' }); await f.poll();
  await sleep(25); f.adapter.snapshot(); assert.equal(f.latest().submission.delivery, 'uncertain');
  f.emit([{ type: 'receipt', id: randomUUID(), delivery: 'confirmed' }]); assert.equal(f.latest().submission.delivery, 'uncertain');
  f.emit([{ type: 'receipt', id: op.clientMessageId, delivery: 'confirmed' }]);
  assert.equal(f.latest().submission.delivery, 'confirmed'); assert.equal(f.latest().control.canSend, true); assert.equal((await f.poll()).commands.length, 0);
});

test('interrupt is bound to the running turn and only an aborted lifecycle confirms it', async t => {
  const f = fixture(t); await f.ready(); f.emit([{ type: 'state', turnId: 'turn-A', activity: 'working' }]);
  const op = f.op(); await f.adapter.interruptSession(f.input.sessionId, op);
  assert.deepEqual((await f.poll()).commands[0], { type: 'interrupt', id: op.clientMessageId, turnId: 'turn-A' });
  f.emit([{ type: 'receipt', id: op.clientMessageId, delivery: 'confirmed' }]); assert.equal(f.latest().submission.delivery, 'submitted');
  f.emit([{ type: 'state', turnId: null, activity: 'thinking', aborted: true }]); assert.equal(f.latest().submission.delivery, 'confirmed');
  f.emit([{ type: 'state', turnId: 'turn-B', activity: 'thinking' }]);
  await f.adapter.interruptSession(f.input.sessionId, f.op()); await f.poll();
  f.emit([{ type: 'state', turnId: null, activity: 'thinking', aborted: false }]); assert.equal(f.latest().submission.delivery, 'uncertain');
});

test('text deltas are deduplicated by sequence and cannot cross turns; final history replaces the overlay', async t => {
  const f = fixture(t); await f.ready();
  f.emit([{ type: 'state', turnId: 't', activity: 'thinking' }, { type: 'text', turnId: 't', id: 'part', text: '实时' }]);
  const response = f.emit([{ type: 'text', turnId: 't', id: 'part', text: '文本' }, { type: 'text', turnId: 'other-turn', id: 'bad', text: 'wrong' }]);
  assert.equal(response.ok, true);
  f.adapter.ingest(f.input.sessionId, f.host.generation, 3, [{ type: 'text', turnId: 't', id: 'part', text: 'DUPLICATE' }]);
  assert.equal(f.latest().messages.at(-1).text, '实时文本');
  f.emit([{ type: 'state', turnId: null, activity: 'thinking' }, { type: 'messages', messages: [...history, { role: 'assistant', text: '完整结果' }], partial: false }]);
  assert.equal(f.latest().messages.at(-1).text, '完整结果'); assert.equal(f.latest().messages.length, 3);
  assert.throws(() => f.adapter.ingest(f.input.sessionId, f.host.generation, 99, [{ type: 'partial' }]), { code: 'CLAUDE_EVENT_GAP' });
  assert.equal(f.disconnected(), 1);
});

test('lease expiry invalidates tokens, wakes a held poll and closes subscribers', async t => {
  const f = fixture(t, { leaseMs: 25, pollMs: 200, operationMs: 20 }); await f.ready();
  const pending = f.poll(); const rejected = assert.rejects(pending, { code: 'CLAUDE_SESSION_OFFLINE' });
  await sleep(35); f.adapter.snapshot(); await rejected;
  assert.equal(f.disconnected(), 1);
  await assert.rejects(f.adapter.interruptSession(f.input.sessionId, f.op()), { code: 'CLAUDE_SESSION_OFFLINE' });
  assert.equal((await f.adapter.listSessions()).sessions.length, 0);
});

async function serverFixture(t, adapter = new ClaudeAdapter({ leaseMs: 1000, pollMs: 50, operationMs: 500 })) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-claude-isolated-'));
  const config = { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty-codex'), defaultCwd: root, claude: { bridgeToken: 'synthetic-host-key-'.repeat(3) } };
  const app = await createRelayServer({ logger: false, config, services: { agentGateway: new AgentGateway([adapter]), desktopControl: { stop: async () => {} } } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { app, adapter, config, base: `http://127.0.0.1:${app.server.address().port}`, hostHeaders: { authorization: `Bearer ${config.claude.bridgeToken}` }, auth: { authorization: 'Bearer synthetic-admin' } };
}

test('HTTP bridge needs its separate host key and loopback, rejects browser Origin and preserves per-agent IDs', async t => {
  const f = await serverFixture(t), input = registration();
  const post = (headers, remoteAddress = '127.0.0.1') => f.app.inject({ method: 'POST', url: '/api/claude-bridge/register', headers, remoteAddress, payload: input });
  assert.equal((await post(f.auth)).statusCode, 401);
  assert.equal((await post(f.hostHeaders, '198.51.100.4')).statusCode, 401);
  assert.equal((await post({ ...f.hostHeaders, origin: 'https://synthetic.example' })).statusCode, 401);
  assert.equal((await post(f.hostHeaders)).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/api/agents/claude/sessions', headers: f.auth })).json().sessions.length, 1);
  const route = `/api/agents/claude/sessions/${input.sessionId}`;
  assert.equal((await f.app.inject({ method: 'POST', url: `${route}/stream-token`, headers: f.auth, payload: {} })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/agents/claude/sessions/ses_wrong/stream-token', headers: f.auth, payload: {} })).statusCode, 400);
  const unknown = await f.app.inject({ method: 'POST', url: `${route}/questions/${randomUUID()}/respond`, headers: f.auth, payload: { controlToken: randomUUID(), clientMessageId: randomUUID(), answers: [['a']] } });
  assert.equal(unknown.statusCode, 409); assert.equal(unknown.json().code ?? unknown.json().error, 'CLAUDE_CONTROL_EXPIRED');
  assert.ok(!JSON.stringify(f.adapter.snapshot()).includes(f.config.claude.bridgeToken));
});

function mockHost(t, server, options = {}) {
  const hooks = new Map(), timers = new Set(), calls = { prompts: [], aborts: [], reads: 0, requests: [], generations: [] };
  const id = randomUUID(), $ = {
    env: { get: async key => key.endsWith('_URL') ? (options.url ?? server.base) : key.endsWith('_TOKEN') ? server.config.claude.bridgeToken : undefined },
    session: { version: async () => ({ version: options.version ?? '2.1.287', base: options.version ?? '2.1.287' }), id: async () => id, cwd: async () => '/synthetic/host-project', messages: async () => { ++calls.reads; return options.messages ?? history; } },
    clock: { after: (ms, fn) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return { cancel: () => { clearTimeout(timer); timers.delete(timer); } }; } },
    http: { fetch: async (url, init) => { calls.requests.push({ url, body: JSON.parse(init.body) }); const response = await fetch(url, init); const text = await response.text(); return { status: response.status, ok: response.ok, headers: {}, text }; } },
    prompt: { submit: async input => { calls.prompts.push(input); return options.drop ? { drop: 'Synthetic refusal' } : { text: input.text }; } },
    turn: { abort: async input => { calls.aborts.push(input); } },
  };
  register((name, fn) => { hooks.set(name, fn); return { catch() {} }; });
  const fire = (name, e, downstream = async value => name.startsWith('classic.') ? {} : value, signal = new AbortController().signal) => {
    const next = Object.assign(value => downstream(value), { signal });
    return hooks.get(name)($, e, next);
  };
  t.after(async () => { await fire('session.end', {}); for (const timer of timers) clearTimeout(timer); });
  return { $, id, fire, hooks, calls };
}

test('real mod source + synthetic host + HTTP: no history read until subscribed; prompt is delivered once to that host', async t => {
  const f = await serverFixture(t), host = mockHost(t, f);
  await host.fire('session.start', { cwd: '/synthetic/host-project' });
  await until(async () => (await f.adapter.listSessions()).sessions.length === 1);
  assert.equal(host.calls.reads, 0);
  const views = []; const unwatch = await f.adapter.watchSession(host.id, view => views.push(view), () => {}); t.after(unwatch);
  await until(() => views.at(-1)?.control.canSend);
  assert.equal(host.calls.reads, 1);
  const op = { controlToken: views.at(-1).control.token, clientMessageId: randomUUID(), text: 'one synthetic prompt', delivery: 'queue' };
  await f.adapter.sendMessage(host.id, op);
  await until(() => views.at(-1)?.submission?.delivery === 'confirmed');
  assert.deepEqual(host.calls.prompts, [{ text: 'one synthetic prompt' }]);
  await sleep(80); assert.equal(host.calls.prompts.length, 1);
  await host.fire('turn.start', { text: op.text, turnId: 'original-turn' });
  async function* chunks() { yield { kind: 'text', index: 0, text: '流式' }; yield { kind: 'thinking', index: 1, text: 'PRIVATE_THINKING' }; yield { kind: 'text', index: 0, text: '输出' }; return { answer: '流式输出' }; }
  const stream = chunks(); stream.result = Promise.resolve({ answer: '流式输出' });
  const forwarded = []; for await (const chunk of host.hooks.get('turn.step')(host.$, { turnId: 'original-turn', index: 0 }, () => stream)) forwarded.push(chunk);
  assert.equal(forwarded.length, 3);
  await until(() => views.at(-1)?.messages.some(m => m.text === '流式输出'));
  assert.ok(!JSON.stringify(views).includes('PRIVATE_THINKING'));
  assert.ok(!JSON.stringify(host.calls.requests).includes('PRIVATE_THINKING'));
  await f.adapter.interruptSession(host.id, { controlToken: op.controlToken, clientMessageId: randomUUID() });
  await until(() => host.calls.aborts.length === 1);
  assert.deepEqual(host.calls.aborts[0], { turnId: 'original-turn' });
  assert.equal(views.at(-1).submission.delivery, 'submitted');
  await host.fire('turn.complete', { turnId: 'original-turn', isAborted: true, answer: '', reason: 'aborted' });
  await until(() => views.at(-1)?.submission?.delivery === 'confirmed');
});

test('mod refuses an unverified engine or non-loopback URL before any network or transcript access', async t => {
  const f = await serverFixture(t);
  for (const options of [{ version: '2.1.100' }, { version: '2.1.220' }, { version: '2.1.277' }, { version: '2.1.286' }, { url: 'http://localhost:8787' }, { url: 'https://remote.example' }]) {
    const host = mockHost(t, f, options); await host.fire('session.start', {}); await sleep(15);
    assert.equal(host.calls.requests.length, 0); assert.equal(host.calls.reads, 0);
  }
});

test('a host refusal unlocks control and explicitly leaves the input for correction', async t => {
  const f = await serverFixture(t), host = mockHost(t, f, { drop: true }); await host.fire('session.start', {});
  await until(async () => (await f.adapter.listSessions()).sessions.length === 1);
  const views = []; const off = await f.adapter.watchSession(host.id, v => views.push(v), () => {}); t.after(off);
  await until(() => views.at(-1)?.control.canSend);
  await f.adapter.sendMessage(host.id, { controlToken: views.at(-1).control.token, clientMessageId: randomUUID(), text: 'refused input', delivery: 'queue' });
  await until(() => views.at(-1)?.operationError?.code === 'rejected');
  assert.equal(views.at(-1).submission, null); assert.equal(views.at(-1).control.canSend, true); assert.equal(host.calls.prompts.length, 1);
});

test('large UTF-8 transcripts are bounded before POST and visibly marked partial', async t => {
  const f = await serverFixture(t), host = mockHost(t, f, { messages: [{ role: 'assistant', text: '合成文本'.repeat(100000) }] }); await host.fire('session.start', {});
  await until(async () => (await f.adapter.listSessions()).sessions.length === 1);
  const views = []; const off = await f.adapter.watchSession(host.id, v => views.push(v), () => {}); t.after(off);
  await until(() => views.at(-1)?.control.canSend);
  assert.equal(views.at(-1).partialText, true); assert.ok(views.at(-1).messages[0].text.length > 0);
  assert.ok(host.calls.requests.every(r => Buffer.byteLength(JSON.stringify(r.body)) < 262144));
});

test('shutdown wakes a twenty-second host poll without waiting for its timeout', async t => {
  const f = await serverFixture(t, new ClaudeAdapter()), input = registration();
  const registrationResponse = await f.app.inject({ method: 'POST', url: '/api/claude-bridge/register', headers: f.hostHeaders, payload: input });
  const generation = registrationResponse.json().generation;
  const poll = fetch(`${f.base}/api/claude-bridge/${input.sessionId}/poll`, { method: 'POST', headers: { ...f.hostHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ generation }) });
  await sleep(15); const start = Date.now(); await f.app.close(); await poll;
  assert.ok(Date.now() - start < 500, 'shutdown should cancel owned polls');
});

const questionInput = () => ({ tool: 'AskUserQuestion', tool_use_id: 'original-native-request', metadata: { source: 'synthetic-plan' }, questions: [
  { question: '先优化哪些部分？', header: '开发方向', multiSelect: true, options: [{ label: '实时连接', description: '保持任务同步', preview: '连接 → 重连 → 同步' }, { label: '手机界面', description: '改善布局' }] },
  { question: '使用什么主题？', header: '主题', multiSelect: false, options: [{ label: '深色', description: '深色界面' }, { label: '浅色', description: '浅色界面' }] },
] });
const questionDescriptor = () => ({ kind: 'question', questions: [{ question: '选择方案？', header: '方案', options: [{ label: 'A', description: '第一个方案' }, { label: 'B', description: '第二个方案' }], multiple: false, custom: true }] });
function interaction(f, serial = 1, request = questionDescriptor()) { return { generation: f.host.generation, id: randomUUID(), serial, turnId: 'interactive-turn', request }; }
async function interactiveFixture(t, limits) {
  const f = fixture(t, limits, true), unwatch = await f.ready(); f.emit([{ type: 'state', turnId: 'interactive-turn', activity: 'working' }]); return { ...f, unwatch };
}
async function interactiveHost(t) {
  const f = await serverFixture(t), host = mockHost(t, f); await host.fire('session.start', {});
  await until(async () => (await f.adapter.listSessions()).sessions.length === 1);
  const views = [], off = await f.adapter.watchSession(host.id, v => views.push(v), () => {}); t.after(off);
  await until(() => views.at(-1)?.control.canSend);
  await host.fire('turn.start', { turnId: 'interactive-turn' });
  return { ...f, host, views, off, latest: () => views.at(-1), op: () => ({ controlToken: views.at(-1).control.token, clientMessageId: randomUUID() }) };
}

test('question answers preserve original questions and metadata through PreToolUse without inventing tool output', async t => {
  const f = await interactiveHost(t), input = questionInput(); let nextCalls = 0;
  const waiting = f.host.fire('classic.PreToolUse', input, async e => { ++nextCalls; assert.equal(e, input); return { additionalContext: ['preserved note'] }; });
  await until(() => f.latest().questions.length === 1);
  const request = f.latest().questions[0]; assert.match(request.questions[0].options[0].description, /连接 → 重连/);
  assert.equal(request.questions[0].multiple, true); assert.equal(f.adapter.snapshot().capabilities.approve, true);
  await f.adapter.respondQuestion(f.host.id, request.id, { ...f.op(), answers: [['实时连接', '手机界面'], ['跟随系统']] });
  const result = await waiting;
  assert.equal(nextCalls, 1); assert.equal(result.allow, true); assert.equal('result' in result, false);
  assert.deepEqual(result.updatedInput, { questions: input.questions, metadata: input.metadata, answers: { '先优化哪些部分？': '实时连接, 手机界面', '使用什么主题？': '跟随系统' } });
  assert.deepEqual(result.additionalContext, ['preserved note']);
  assert.equal(f.host.calls.prompts.length, 0); assert.equal(f.host.calls.aborts.length, 0);
  await until(() => f.latest().questions.length === 0);
});

test('permission card shows the complete original input and only allows once or rejects without changing rules', async t => {
  const f = await interactiveHost(t), input = { tool_name: 'Bash', cwd: '/synthetic/host-project', tool_input: { command: 'synthetic-command', description: 'Synthetic only', dangerouslyDisableSandbox: true, timeout: 1000 }, permission_suggestions: [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }] };
  const waiting = f.host.fire('classic.PermissionRequest', input);
  await until(() => f.latest().permissions.length === 1);
  const request = f.latest().permissions[0];
  assert.deepEqual(JSON.parse(request.detail), input.tool_input); assert.deepEqual(request.resources, [input.cwd]);
  assert.deepEqual(request.decisions, ['once', 'reject']); assert.deepEqual(request.save, []);
  await assert.rejects(f.adapter.respondPermission(f.host.id, request.id, { ...f.op(), decision: 'always' }), { code: 'CLAUDE_DECISION_UNAVAILABLE' });
  await f.adapter.respondPermission(f.host.id, request.id, { ...f.op(), decision: 'once' });
  assert.deepEqual(await waiting, { decision: { behavior: 'allow' } });
  assert.equal(f.host.calls.prompts.length, 0); await until(() => !f.latest().permissions.length);
  const denied = f.host.fire('classic.PermissionRequest', { ...input, tool_input: { command: 'another-synthetic-command' } });
  await until(() => f.latest().permissions.length === 1);
  await f.adapter.respondPermission(f.host.id, f.latest().permissions[0].id, { ...f.op(), decision: 'reject' });
  const result = await denied; assert.equal(result.decision.behavior, 'deny'); assert.equal(result.decision.interrupt, undefined);
});

test('downstream hook decisions and rewrites, unknown questions and oversized inputs keep the host flow unchanged', async t => {
  const f = await interactiveHost(t);
  for (const result of [{ deny: 'Managed decision' }, { ask: 'Need local confirmation' }, { allow: true, updatedInput: { questions: [], answers: {} } }]) {
    assert.deepEqual(await f.host.fire('classic.PreToolUse', questionInput(), async () => result), result);
  }
  for (const result of [{ decision: { behavior: 'deny', message: 'Existing rule' } }, { preventContinuation: true }]) {
    assert.deepEqual(await f.host.fire('classic.PermissionRequest', { tool_name: 'Write', cwd: '/synthetic/host-project', tool_input: { file_path: '/synthetic/a', content: 'a' } }, async () => result), result);
  }
  const unknown = questionInput(); unknown.questions[0].unrecognized = 'Do not silently omit';
  assert.deepEqual(await f.host.fire('classic.PreToolUse', unknown), {});
  assert.deepEqual(await f.host.fire('classic.PermissionRequest', { tool_name: 'mcp__unknown__tool', cwd: '/synthetic', tool_input: {} }), {});
  assert.deepEqual(await f.host.fire('classic.PermissionRequest', { tool_name: 'Write', cwd: '/synthetic', tool_input: { content: 'x'.repeat(33000) } }), {});
  assert.equal(f.host.calls.requests.filter(r => r.url.endsWith('/interaction')).length, 0);
});

test('native cancellation closes the original request and a late phone answer is rejected', async t => {
  const f = await interactiveHost(t), controller = new AbortController();
  const waiting = f.host.fire('classic.PreToolUse', questionInput(), async () => ({}), controller.signal);
  await until(() => f.latest().questions.length === 1); const requestId = f.latest().questions[0].id;
  controller.abort(); assert.deepEqual(await waiting, {});
  await until(() => !f.latest().questions.length);
  await assert.rejects(f.adapter.respondQuestion(f.host.id, requestId, { ...f.op(), answers: [['实时连接'], ['深色']] }), { code: 'CLAUDE_REQUEST_EXPIRED' });
});

test('cancellation arriving before the initial interaction POST leaves a tombstone and never resurrects a card', async t => {
  const f = await interactiveHost(t), controller = new AbortController();
  const fetchOriginal = f.host.$.http.fetch; let release, delayed = false;
  const held = new Promise(resolve => { release = resolve; });
  f.host.$.http.fetch = async (url, init) => { if (url.endsWith('/interaction')) { delayed = true; await held; } return fetchOriginal(url, init); };
  const waiting = f.host.fire('classic.PreToolUse', questionInput(), async () => ({}), controller.signal);
  await until(() => delayed); controller.abort();
  await until(() => f.host.calls.requests.some(r => r.url.endsWith('/interaction/close')));
  await sleep(15); release(); assert.deepEqual(await waiting, {});
  assert.equal(f.latest().questions.length, 0);
});

test('question cardinality and duplicate answers are validated before locking; another operation ID cannot answer twice', async t => {
  const f = await interactiveFixture(t), input = interaction(f), pending = f.adapter.waitInteraction(f.input.sessionId, input);
  await assert.rejects(f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), answers: [['A', 'B']] }), { code: 'CLAUDE_INVALID_ANSWER' });
  assert.equal(f.latest().questions[0].status, 'pending');
  await f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), answers: [['自己的方案']] });
  await assert.rejects(f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), answers: [['A']] }), { code: 'CLAUDE_REQUEST_ALREADY_SUBMITTED' });
  assert.deepEqual(await pending, { status: 'answered', answer: { answers: [['自己的方案']] } });
  assert.equal(f.latest().questions[0].status, 'submitted');
});

test('immutable request identity, session, generation and turn guards reject mismatched responses', async t => {
  const f = await interactiveFixture(t), input = interaction(f); await f.adapter.waitInteraction(f.input.sessionId, input);
  await assert.rejects(f.adapter.waitInteraction(f.input.sessionId, { ...input, request: { ...input.request, questions: input.request.questions.map(q => ({ ...q, question: 'Changed scope?' })) } }), { code: 'CLAUDE_REQUEST_CHANGED' });
  await assert.rejects(f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), answers: [['A']] }), { code: 'CLAUDE_REQUEST_EXPIRED' });
  assert.throws(() => f.adapter.waitInteraction(f.input.sessionId, { ...input, generation: randomUUID() }), { code: 'CLAUDE_GENERATION_CHANGED' });
  assert.throws(() => f.adapter.waitInteraction(f.input.sessionId, { ...input, turnId: 'other-turn' }), { code: 'CLAUDE_REQUEST_EXPIRED' });
  await assert.rejects(f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), controlToken: randomUUID(), answers: [['A']] }), { code: 'CLAUDE_CONTROL_EXPIRED' });
  const other = f.adapter.register({ ...registration(), interactions: 1 });
  await assert.rejects(f.adapter.respondQuestion(f.input.sessionId, input.id, { controlToken: other.generation, clientMessageId: randomUUID(), answers: [['A']] }), { code: 'CLAUDE_CONTROL_EXPIRED' });
});

test('turn end, phone departure, lease loss and timeout close held requests without a grant or replay', async t => {
  for (const end of ['turn', 'phone', 'lease', 'timeout']) {
    const f = await interactiveFixture(t, { leaseMs: end === 'lease' ? 30 : 1000, pollMs: 200, operationMs: 500, interactionMs: end === 'timeout' ? 25 : 1000 });
    const input = interaction(f), pending = f.adapter.waitInteraction(f.input.sessionId, input);
    if (end === 'turn') f.emit([{ type: 'state', turnId: null, activity: 'thinking' }]);
    if (end === 'phone') f.unwatch();
    if (end === 'lease') { await sleep(35); f.adapter.snapshot(); }
    let result = await pending;
    if (end === 'timeout' && result.status === 'pending') {
      // A poll timer may wake just before the wall-clock deadline. The host polls again.
      await until(async () => {
        result = await f.adapter.waitInteraction(f.input.sessionId, input);
        return result.status !== 'pending';
      });
    }
    assert.deepEqual(result, { status: 'closed' }, end);
    if (end === 'timeout') {
      await assert.rejects(f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), answers: [['A']] }), { code: 'CLAUDE_REQUEST_EXPIRED' });
      assert.deepEqual(await f.adapter.waitInteraction(f.input.sessionId, input), { status: 'closed' });
    }
  }
});

test('without a phone a request immediately stays local; reconnecting cannot revive it', async t => {
  const f = fixture(t, undefined, true); f.emit([{ type: 'state', turnId: 'interactive-turn', activity: 'working' }]);
  const input = interaction(f); assert.deepEqual(await f.adapter.waitInteraction(f.input.sessionId, input), { status: 'closed' });
  await f.ready(); f.emit([{ type: 'state', turnId: 'interactive-turn', activity: 'working' }]);
  assert.deepEqual(await f.adapter.waitInteraction(f.input.sessionId, input), { status: 'closed' }); assert.equal(f.latest().questions.length, 0);
});

test('bounded request history accepts new requests after hundreds of completions but rejects a retired ID', async t => {
  const f = fixture(t, undefined, true); f.emit([{ type: 'state', turnId: 'interactive-turn', activity: 'working' }]); const first = interaction(f);
  await f.adapter.waitInteraction(f.input.sessionId, first);
  for (let serial = 2; serial <= 260; serial++) await f.adapter.waitInteraction(f.input.sessionId, interaction(f, serial));
  await f.ready(); f.emit([{ type: 'state', turnId: 'interactive-turn', activity: 'working' }]);
  assert.deepEqual(await f.adapter.waitInteraction(f.input.sessionId, first), { status: 'closed' });
  const latest = interaction(f, 261); assert.deepEqual(await f.adapter.waitInteraction(f.input.sessionId, latest), { status: 'pending' });
  assert.equal(f.latest().questions[0].id, latest.id);
});

test('schema refuses duplicate question keys/options and unbounded or non-absolute permission details', () => {
  const input = { generation: randomUUID(), id: randomUUID(), serial: 1, turnId: 't', request: questionDescriptor() };
  assert.equal(claudeInteractionWaitSchema.safeParse(input).success, true);
  assert.equal(claudeInteractionWaitSchema.safeParse({ ...input, request: { ...input.request, questions: [input.request.questions[0], input.request.questions[0]] } }).success, false);
  assert.equal(claudeInteractionWaitSchema.safeParse({ ...input, request: { ...input.request, questions: [{ ...input.request.questions[0], options: [input.request.questions[0].options[0], input.request.questions[0].options[0]] }] } }).success, false);
  assert.equal(claudeInteractionWaitSchema.safeParse({ ...input, request: { kind: 'permission', action: 'Write', directory: 'relative', detail: '{}' } }).success, false);
  assert.equal(claudeInteractionWaitSchema.safeParse({ ...input, request: { kind: 'permission', action: 'Write', directory: '/synthetic', detail: 'x'.repeat(32001) } }).success, false);
});

test('HTTP interaction writes require the phone scope while host waits and cancellation require the separate bridge key', async t => {
  const f = await serverFixture(t), input = { ...registration(), interactions: 1 }, host = f.adapter.register(input);
  const pairing = (await f.app.inject({ method: 'POST', url: '/api/pairing', headers: f.auth })).json();
  const device = (await f.app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code } })).json();
  assert.ok(device.token); const phoneAuth = { authorization: `Bearer ${device.token}` };
  const off = await f.adapter.watchSession(input.sessionId, () => {}, () => {}); t.after(off);
  f.adapter.ingest(input.sessionId, host.generation, 1, [{ type: 'state', turnId: 'interactive-turn', activity: 'working' }, { type: 'messages', messages: history, partial: false }]);
  const body = { generation: host.generation, id: randomUUID(), serial: 1, turnId: 'interactive-turn', request: questionDescriptor() }, route = `/api/claude-bridge/${input.sessionId}/interaction`;
  assert.equal((await f.app.inject({ method: 'POST', url: route, headers: f.auth, payload: body })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: route, headers: f.hostHeaders, payload: body })).json().status, 'pending');
  const answer = { controlToken: host.generation, clientMessageId: randomUUID(), answers: [['A']] }, phoneRoute = `/api/agents/claude/sessions/${input.sessionId}/questions/${body.id}/respond`;
  assert.equal((await f.app.inject({ method: 'POST', url: phoneRoute, headers: f.hostHeaders, payload: answer })).statusCode, 401);
  const first = await f.app.inject({ method: 'POST', url: phoneRoute, headers: phoneAuth, payload: answer }); assert.equal(first.statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: phoneRoute, headers: phoneAuth, payload: answer })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: phoneRoute, headers: phoneAuth, payload: { ...answer, clientMessageId: randomUUID() } })).statusCode, 409);
  assert.deepEqual((await f.app.inject({ method: 'POST', url: route, headers: f.hostHeaders, payload: body })).json(), { status: 'answered', answer: { answers: [['A']] } });
  assert.equal((await f.app.inject({ method: 'POST', url: `${route}/close`, headers: f.auth, payload: { generation: host.generation, id: body.id, serial: 1 } })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: `${route}/close`, headers: f.hostHeaders, payload: { generation: host.generation, id: body.id, serial: 1 } })).statusCode, 200);
  const devices = (await f.app.inject({ url: '/api/devices', headers: phoneAuth })).json();
  assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/devices/${devices.devices[0].id}`, headers: f.auth })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: phoneRoute, headers: phoneAuth, payload: answer })).statusCode, 401);
});

test('a lost answer response never grants permission or retries the native request', async t => {
  const f = await interactiveHost(t), originalFetch = f.host.$.http.fetch;
  f.host.$.http.fetch = async (url, init) => {
    const response = await originalFetch(url, init);
    if (url.endsWith('/interaction') && JSON.parse(response.text).status === 'answered') throw new Error('synthetic lost answer');
    return response;
  };
  let nextCalls = 0;
  const waiting = f.host.fire('classic.PermissionRequest', { tool_name: 'Write', cwd: '/synthetic/host-project', tool_input: { file_path: '/synthetic/file', content: 'synthetic only' } }, async () => { ++nextCalls; return {}; });
  await until(() => f.latest().permissions.length === 1);
  await f.adapter.respondPermission(f.host.id, f.latest().permissions[0].id, { ...f.op(), decision: 'once' });
  assert.deepEqual(await waiting, {}); assert.equal(nextCalls, 1);
  await until(() => !f.latest().permissions.length);
  assert.equal(f.host.calls.requests.filter(r => r.url.endsWith('/interaction')).length, 1);
});

test('a pending queue receipt does not prevent answering the original question', async t => {
  const f = await interactiveFixture(t), input = interaction(f);
  await f.adapter.sendMessage(f.input.sessionId, { ...f.op(), text: 'queued while working', delivery: 'queue' });
  const waiting = f.adapter.waitInteraction(f.input.sessionId, input);
  await f.adapter.respondQuestion(f.input.sessionId, input.id, { ...f.op(), answers: [['A']] });
  assert.equal((await waiting).status, 'answered'); assert.equal(f.latest().submission.delivery, 'submitted');
});

test('parallel interaction arrivals can be out of serial order, stay bounded, and shutdown wakes their HTTP waits', async t => {
  const f = await serverFixture(t, new ClaudeAdapter()), input = { ...registration(), interactions: 1 }, host = f.adapter.register(input);
  const off = await f.adapter.watchSession(input.sessionId, () => {}, () => {}); t.after(off);
  f.adapter.ingest(input.sessionId, host.generation, 1, [{ type: 'state', turnId: 'interactive-turn', activity: 'working' }]);
  const body = { generation: host.generation, id: randomUUID(), serial: 2, turnId: 'interactive-turn', request: questionDescriptor() };
  const second = f.adapter.waitInteraction(input.sessionId, body), first = f.adapter.waitInteraction(input.sessionId, { ...body, id: randomUUID(), serial: 1 });
  const httpWait = fetch(`${f.base}/api/claude-bridge/${input.sessionId}/interaction`, { method: 'POST', headers: { ...f.hostHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, id: randomUUID(), serial: 3 }) });
  await sleep(20);
  const start = Date.now(); await f.app.close();
  assert.deepEqual(await second, { status: 'closed' }); assert.deepEqual(await first, { status: 'closed' });
  assert.equal((await (await httpWait).json()).status, 'closed'); assert.ok(Date.now() - start < 500);
});
