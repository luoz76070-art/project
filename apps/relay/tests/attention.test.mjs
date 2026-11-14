import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { AttentionHub, attentionLimits } from '../dist/attention/attentionHub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const past = new Date(Date.now() - 60 * 60_000).toISOString();
const turn = (turnId, status = 'completed', endedAt = new Date().toISOString()) => ({ turnId, status, reason: { code: status === 'completed' ? 'ok' : 'provider_error', message: '' }, endedAt, timeSource: 'provider' });
const approval = (id, command, extra = {}) => ({ id, source: 'desktop', threadId: 'T', turnId: 'turn-2', kind: 'command', status: 'pending', title: '运行命令', detail: command, command, cwd: '/tmp', reason: null,
  preview: command, unavailableReason: null, availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'], createdAt: past, updatedAt: past, ...extra });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-'));
  const threadId = randomUUID(), sessionId = 'session-1', calls = [];
  const desktopState = { status: 'idle', activeTurnId: null, lastTurn: turn('turn-1', 'completed', past), approvals: [], userInputs: [] };
  const desktopListeners = new Set(); let follows = 0;
  const desktopSnapshot = () => ({ threadId, source: 'desktop-ipc', messages: [], messageCount: 0, eventCount: 0, updatedAt: new Date().toISOString(), changeType: null, ...desktopState });
  const desktop = { stop: async () => {}, messageQueue: { stop: async () => {}, revoke: async () => {} },
    followThread() { follows++; return () => { follows--; }; }, getStreamSnapshot: id => id === threadId ? desktopSnapshot() : null,
    onStreamSnapshot(listener) { desktopListeners.add(listener); return () => desktopListeners.delete(listener); },
    async sendMessage(body) { calls.push(['desktop-send', body.threadId]); return { ok: true, delivery: 'confirmed' }; },
    async respondApproval(id, approvalId, decision) { calls.push(['desktop-approval', id, approvalId, decision]); return { ok: true }; } };
  const agentState = { status: 'idle', lastTurn: null, permissions: [], questions: [] }, agentListeners = new Set();
  const agentView = () => ({ agentId: 'deepseek', session: { id: sessionId, title: 'DeepSeek 会话', directory: root, updatedAt: past }, connected: true, messages: [], activity: 'thinking',
    historyCursor: null, partialText: false, submission: null, control: { token: '11111111-1111-4111-8111-111111111111', canSend: true, canSteer: true, canInterrupt: true }, ...agentState });
  const adapter = { validSessionId: value => value === sessionId,
    async watchSession(_id, listener) { const entry = () => listener(agentView()); agentListeners.add(entry); entry(); return () => agentListeners.delete(entry); },
    async sendMessage() { calls.push(['agent-send']); return { ok: true, delivery: 'confirmed' }; },
    async respondPermission(id, permissionId, body) { calls.push(['agent-permission', id, permissionId, body.decision, body.controlToken]); return { ok: true, delivery: 'confirmed' }; } };
  const liveTurns = Object.assign(new EventEmitter(), { stop: async () => {}, turns: new Map(),
    async startTurn(body) { const snapshot = { threadId: body.threadId ?? 'live-thread', turnId: 'live-turn-1', status: 'inProgress', messageCount: 0, eventCount: 0, messages: [], events: [], approvals: [], userInputs: [],
      thread: { id: 'live-thread', threadName: '后台任务' }, error: null, updatedAt: new Date().toISOString(), lastTurn: null }; this.turns.set(snapshot.turnId, snapshot); return snapshot; },
    getTurn(id) { return this.turns.get(id) ?? null; },
    async respondApproval(params) { calls.push(['live-approval', params.turnId, params.approvalId, params.decision]); return {}; } });
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: {
    store: { close() {}, getThreadSummary: async id => id === threadId ? { id, threadName: '修复登录页', cwd: root, source: 'vscode', originator: 'desktop' } : null },
    live: { stop: async () => {} }, liveTurns, desktopControl: desktop,
    agentGateway: { stop: async () => {}, sessions: () => adapter, snapshot: () => [{ id: 'deepseek', sessionApi: 1 }] },
  } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const request = (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: 'Bearer admin' } });
  const items = async () => (await request('GET', '/api/attention')).json().items;
  const emitDesktop = async patch => { Object.assign(desktopState, patch); for (const listener of desktopListeners) listener(desktopSnapshot()); await settle(); };
  const emitAgent = async patch => { Object.assign(agentState, patch); for (const listener of agentListeners) listener(); await settle(); };
  return { app, threadId, sessionId, calls, request, items, emitDesktop, emitAgent, liveTurns, follows: () => follows };
}

test('risk patterns match the phone approval card exactly', async () => {
  const block = text => text.slice(text.indexOf('const risks: [RegExp, string][] = ['), text.indexOf('];', text.indexOf('const risks')) + 2);
  const phone = await fs.readFile(path.join(here, '../../mobile/src/features/chat/approvalModel.ts'), 'utf8');
  const relay = await fs.readFile(path.join(here, '../src/attention/risk.ts'), 'utf8');
  assert.ok(block(phone).length > 200);
  assert.equal(block(relay), block(phone));
});

test('desktop: only the turn started after sending is reported; approvals can be answered unless risky', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.items(), []);
  const sent = await f.request('POST', `/api/desktop/control/threads/${f.threadId}/messages`, { message: '修一下', clientMessageId: randomUUID() });
  assert.equal(sent.statusCode, 200, sent.body);
  await settle();
  let [item] = await f.items();
  assert.equal(item.key, `desktop:${f.threadId}`);
  assert.equal(item.title, '修复登录页');
  assert.equal(item.lastTurn, null, 'the turn that ended before sending is not reported');
  assert.equal(f.follows(), 1);

  await f.emitDesktop({ status: 'inProgress', activeTurnId: 'turn-2', approvals: [approval('a1', 'pnpm test'), approval('a2', 'git push --force origin main')] });
  [item] = await f.items();
  assert.equal(item.running, true);
  assert.deepEqual(item.requests.map(r => [r.id, r.canAllow, r.canDeny, r.risks.length > 0]), [['a1', true, true, false], ['a2', false, true, true]]);

  const risky = await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'a2', decision: 'allow' });
  assert.equal(risky.statusCode, 409);
  assert.equal((await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'a1', decision: 'allow' })).statusCode, 200);
  assert.equal((await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'a2', decision: 'deny' })).statusCode, 200);
  assert.deepEqual(f.calls.filter(c => c[0] === 'desktop-approval'), [['desktop-approval', f.threadId, 'a1', 'accept'], ['desktop-approval', f.threadId, 'a2', 'decline']]);
  assert.equal((await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'gone', decision: 'deny' })).statusCode, 410);

  await f.emitDesktop({ status: 'completed', activeTurnId: null, approvals: [], lastTurn: turn('turn-2') });
  [item] = await f.items();
  assert.equal(item.running, false);
  assert.equal(item.lastTurn.turnId, 'turn-2');
});

test('agent: permissions are answered with the session control token; questions need the app', async t => {
  const f = await fixture(t);
  const sent = await f.request('POST', `/api/agents/deepseek/sessions/${f.sessionId}/messages`, { text: '继续', delivery: 'queue', controlToken: '11111111-1111-4111-8111-111111111111', clientMessageId: randomUUID() });
  assert.equal(sent.statusCode, 200, sent.body);
  await settle();
  await f.emitAgent({ status: 'running', permissions: [{ id: 'p1', status: 'pending', action: 'bash', resources: ['ls -la'], save: [], detail: '', unavailableReason: null, decisions: ['once', 'always', 'reject'] }],
    questions: [{ id: 'q1', status: 'pending', questions: [{ question: '用哪个方案？', header: '', options: [], multiple: false, custom: true }] }] });
  let [item] = await f.items();
  assert.equal(item.key, `agent:deepseek:${f.sessionId}`);
  assert.equal(item.title, 'DeepSeek 会话');
  assert.deepEqual(item.requests.map(r => [r.id, r.kind, r.canAllow]), [['p1', 'approval', true], ['q1', 'question', false]]);
  assert.equal((await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'q1', decision: 'allow' })).statusCode, 410);
  assert.equal((await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'p1', decision: 'deny' })).statusCode, 200);
  assert.deepEqual(f.calls.find(c => c[0] === 'agent-permission'), ['agent-permission', f.sessionId, 'p1', 'reject', '11111111-1111-4111-8111-111111111111']);
  await f.emitAgent({ status: 'idle', permissions: [], questions: [], lastTurn: turn('agent-turn') });
  [item] = await f.items();
  assert.equal(item.lastTurn.turnId, 'agent-turn');
});

test('live turns: reports only the started turn and answers its approvals', async t => {
  const f = await fixture(t);
  const started = await f.request('POST', '/api/live/turns', { message: '跑测试', clientMessageId: randomUUID() });
  assert.equal(started.statusCode, 200, started.body);
  let [item] = await f.items();
  assert.equal(item.key, 'live:live-thread');
  assert.equal(item.running, true);
  const base = f.liveTurns.turns.get('live-turn-1');
  f.liveTurns.emit('snapshot', { ...base, turnId: 'other', status: 'completed', lastTurn: turn('other') });
  f.liveTurns.emit('snapshot', { ...base, approvals: [{ id: 'l1', requestId: 1, kind: 'fileChange', status: 'pending', title: '修改文件', detail: 'src/a.ts', command: null, cwd: null, reason: null, availableDecisions: ['accept', 'decline'], createdAt: past, updatedAt: past }] });
  [item] = await f.items();
  assert.equal(item.lastTurn, null);
  assert.equal(item.requests[0].canAllow, true);
  assert.equal((await f.request('POST', '/api/attention/respond', { key: item.key, requestId: 'l1', decision: 'allow' })).statusCode, 200);
  assert.deepEqual(f.calls.find(c => c[0] === 'live-approval'), ['live-approval', 'live-turn-1', 'l1', 'accept']);
  f.liveTurns.emit('snapshot', { ...base, status: 'failed', approvals: [], lastTurn: turn('live-turn-1', 'failed') });
  [item] = await f.items();
  assert.equal(item.lastTurn.status, 'failed');
});

test('event stream sends the snapshot, then item changes', async t => {
  const f = await fixture(t);
  await f.request('POST', `/api/desktop/control/threads/${f.threadId}/messages`, { message: '修一下', clientMessageId: randomUUID() });
  await settle();
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${address}/api/attention/events`, { headers: { authorization: 'Bearer admin' }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '';
  const until = async pattern => { while (!pattern.test(text)) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); } };
  await until(/event: snapshot\ndata: .*修复登录页/);
  await f.emitDesktop({ status: 'inProgress', activeTurnId: 'turn-2' });
  await until(/event: item\ndata: .*"running":true/);
  controller.abort();
});

test('hub: idle watches expire, active ones stay; limits never drop running work; revoke forgets the device', () => {
  let now = Date.now();
  const listeners = new Set(), snapshots = new Map();
  const desktop = { onStreamSnapshot(l) { listeners.add(l); return () => listeners.delete(l); }, followThread() { return () => {}; }, getStreamSnapshot: id => snapshots.get(id) ?? null };
  const hub = new AttentionHub({ desktop, liveTurns: new EventEmitter(), gateway: {}, codex: { getThreadSummary: async () => null }, now: () => now });
  const snap = (threadId, status) => ({ threadId, status, messages: [], lastTurn: null, approvals: [], userInputs: [] });
  for (let i = 0; i < attentionLimits.perOwner; i++) { snapshots.set(`t${i}`, snap(`t${i}`, 'inProgress')); hub.watch('phone', { source: 'desktop', threadId: `t${i}` }); }
  snapshots.set('extra', snap('extra', 'idle'));
  hub.watch('phone', { source: 'desktop', threadId: 'extra' });
  assert.equal(hub.items('phone').length, attentionLimits.perOwner, 'all running: the extra watch is skipped');
  for (const l of listeners) l(snap('t0', 'completed'));
  hub.watch('phone', { source: 'desktop', threadId: 'extra' });
  assert.ok(hub.items('phone').some(i => i.threadId === 'extra') && !hub.items('phone').some(i => i.threadId === 't0'), 'the idle watch made room');
  now += attentionLimits.idleMs + 1;
  hub.expire();
  assert.ok(!hub.items('phone').some(i => i.threadId === 'extra'), 'idle watch expired');
  assert.equal(hub.items('phone').length, attentionLimits.perOwner - 1);
  hub.revoke('phone');
  assert.deepEqual(hub.items('phone'), []);
  hub.stop();
});

test('hub: one upstream listener per channel however many watches; released when the last one goes', () => {
  const desktopListeners = new Set(), live = new EventEmitter();
  const desktop = { onStreamSnapshot(l) { desktopListeners.add(l); return () => desktopListeners.delete(l); }, followThread() { return () => {}; }, getStreamSnapshot: () => null };
  const hub = new AttentionHub({ desktop, liveTurns: Object.assign(live, { getTurn: () => null }), gateway: {}, codex: { getThreadSummary: async () => null } });
  for (let i = 0; i < 6; i++) { hub.watch(`p${i}`, { source: 'desktop', threadId: `t${i}` }); hub.watch(`p${i}`, { source: 'live', threadId: `l${i}`, turnId: `turn-${i}` }); }
  assert.equal(desktopListeners.size, 1);
  assert.equal(live.listenerCount('snapshot'), 1);
  for (const l of desktopListeners) l({ threadId: 't3', status: 'inProgress', messages: [], approvals: [], userInputs: [] });
  live.emit('snapshot', { threadId: 'l4', turnId: 'turn-4', status: 'inProgress', approvals: [], userInputs: [], thread: null, lastTurn: null });
  assert.equal(hub.items('p3').find(i => i.source === 'desktop').running, true);
  assert.equal(hub.items('p4').find(i => i.source === 'live').running, true);
  assert.equal(hub.items('p5').find(i => i.source === 'live').running, false);
  for (let i = 0; i < 6; i++) hub.revoke(`p${i}`);
  assert.equal(desktopListeners.size, 0);
  assert.equal(live.listenerCount('snapshot'), 0);
  hub.stop();
});
