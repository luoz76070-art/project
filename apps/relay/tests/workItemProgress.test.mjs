import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { progressCandidate } from '../dist/workItems/progress.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
const reasons = { completed: ['ok', '本轮已完成。'], interrupted: ['cancelled', '本轮已中断。'], failed: ['provider_error', '本轮执行失败，请在电脑端查看详情。'] };
const turn = (turnId, status = 'completed') => ({ turnId, status, reason: { code: reasons[status][0], message: reasons[status][1] }, endedAt: new Date().toISOString(), timeSource: 'provider' });

async function fixture(t, { root: existing, sessionId = randomUUID(), lastTurn = null } = {}) {
  const root = existing ?? await fs.mkdtemp(path.join(os.tmpdir(), 'work-item-progress-'));
  const desktopListeners = new Set(), agentListeners = new Set(), calls = [];
  const state = { outcome: 'confirmed', busy: false, messages: [], lastTurn, agentLastTurn: null, consumedTurns: undefined };
  const desktopSnapshot = () => ({ threadId: sessionId, status: state.busy ? 'inProgress' : 'idle', messages: state.messages, lastTurn: state.lastTurn,
    control: { transport: 'native', token: 'fixture-token', activeTurnId: state.busy ? 'turn-busy' : null, canSend: true, submission: null, queue: { items: [] } } });
  const agentView = agentId => ({ agentId, session: { id: sessionId, title: '目标会话', directory: root, updatedAt: new Date().toISOString() }, connected: true,
    status: 'idle', messages: [], questions: [], permissions: [], activity: 'thinking', historyCursor: null, partialText: false, lastTurn: state.agentLastTurn, consumedTurns: state.consumedTurns,
    submission: null, control: { token: 'fixture-token', canSend: true, canSteer: true, canInterrupt: true } });
  const desktop = { stop: async () => {}, messageQueue: { stop: async () => {}, revoke: async () => {} },
    followThread() { return () => {}; }, getStreamSnapshot: desktopSnapshot,
    onStreamSnapshot(listener) { desktopListeners.add(listener); return () => desktopListeners.delete(listener); },
    async sendMessage(body) { calls.push(body); return { ok: true, delivery: state.outcome }; } };
  const adapter = agentId => ({ validSessionId: value => value === sessionId,
    async watchSession(_id, listener) { const entry = () => listener(agentView(agentId)); agentListeners.add(entry); entry(); return () => agentListeners.delete(entry); },
    async sendMessage(_target, body) { calls.push(body); return { ok: true, delivery: state.outcome }; } });
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: {
    store: { close() {}, getThreadSummary: async id => id === sessionId ? { id, threadName: '目标会话', cwd: root, source: 'vscode', originator: 'desktop' } : null },
    live: { stop: async () => {} }, liveTurns: { stop: async () => {} }, desktopControl: desktop,
    agentGateway: { stop: async () => {}, sessions: adapter, snapshot: () => ['claude', 'deepseek', 'opencode'].map(id => ({ id, sessionApi: 1 })) },
  } });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  t.after(async () => { await close(); if (!existing) await fs.rm(root, { recursive: true, force: true }); });
  const request = (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: 'Bearer admin' } });
  const item = async uid => (await request('GET', `/api/work-items/${uid}`)).json().item;
  async function until(uid, check, label) {
    for (const deadline = Date.now() + 5000; Date.now() < deadline;) { const value = await item(uid); if (check(value)) return value; await settle(5); }
    assert.fail(`condition not reached: ${label}`);
  }
  async function handoff(agentId = 'codex') {
    const info = (await request('GET', '/api/work-items')).json();
    const created = (await request('POST', '/api/work-items', { storeId: info.storeId, uid: randomUUID(), mutationId: randomUUID(), expectedRevision: 0, title: '修复登录页', detail: '按截图修', kind: 'task', assets: [], codeRefs: [] })).json();
    const input = { storeId: created.storeId, expectedRevision: created.item.revision, handoffId: randomUUID(), target: { agentId, sessionId } };
    const preview = await request('POST', `/api/work-items/${created.item.uid}/handoffs/preview`, input);
    assert.equal(preview.statusCode, 200, preview.body);
    const submit = await request('POST', `/api/work-items/${created.item.uid}/handoffs`, { ...input, previewHash: preview.json().previewHash, confirmed: true });
    assert.equal(submit.statusCode, 202, submit.body);
    return { uid: created.item.uid, id: input.handoffId };
  }
  const emit = () => { for (const listener of desktopListeners) listener(desktopSnapshot()); for (const listener of agentListeners) listener(); };
  const userMessage = (id, turnId) => ({ id: `native-${turnId}`, clientMessageId: id, turnId, role: 'user', text: '交接', kind: 'userMessage', timestamp: new Date().toISOString() });
  return { root, sessionId, state, calls, request, item, until, handoff, emit, userMessage, close, watchers: () => desktopListeners.size + agentListeners.size };
}

test('Codex Desktop: delivered -> in_progress, binds the consuming turn, completed -> to_verify; other turns and repeats change nothing', async t => {
  const f = await fixture(t), { uid, id } = await f.handoff('codex');
  let card = await f.until(uid, value => value.state === 'in_progress', 'delivered card in progress');
  assert.equal(card.lastTransition.actor, 'system'); assert.equal(card.currentAttempt.channel, 'codex-desktop'); assert.equal(card.currentAttempt.turnId, null);
  f.state.lastTurn = turn('turn-older'); f.emit();
  f.state.messages.push(f.userMessage(randomUUID(), 'turn-other'), f.userMessage(id, 'turn-mine')); f.emit();
  card = await f.until(uid, value => value.currentAttempt.turnId === 'turn-mine', 'turn bound');
  assert.equal(card.state, 'in_progress', 'an older turn result must not move the card');
  f.state.lastTurn = turn('turn-other'); f.emit(); await settle();
  assert.equal((await f.item(uid)).state, 'in_progress', "another turn's result is ignored");
  f.state.lastTurn = turn('turn-mine'); f.emit();
  card = await f.until(uid, value => value.state === 'to_verify', 'completed turn waits for verification');
  assert.equal(card.lastTransition.actor, 'system'); assert.equal(card.currentAttempt.lastTurn.turnId, 'turn-mine');
  f.emit(); f.emit(); await settle();
  card = await f.item(uid); assert.equal(card.state, 'to_verify', 'to_verify never becomes done automatically');
  assert.equal(f.watchers(), 0, 'the watch closes once the turn result is written');
  assert.equal(f.calls.length, 1, 'progress tracking never sends');
  const accept = await f.request('POST', `/api/work-items/${uid}/verify`, { mutationId: randomUUID(), expectedRevision: card.revision, decision: 'accept' });
  assert.equal(accept.statusCode, 200, accept.body); assert.equal(accept.json().item.state, 'done');
});

test('Codex Desktop: failed or interrupted turn -> returned with the turn reason', async t => {
  for (const status of ['failed', 'interrupted']) {
    const f = await fixture(t), { uid, id } = await f.handoff('codex');
    await f.until(uid, value => value.state === 'in_progress', 'in progress');
    f.state.messages.push(f.userMessage(id, 'turn-x')); f.state.lastTurn = turn('turn-x', status); f.emit();
    const card = await f.until(uid, value => value.state === 'returned', `${status} returns the card`);
    assert.equal(card.lastTransition.actor, 'system'); assert.equal(card.lastTransition.reason, reasons[status][1]);
  }
});

test("a user's decision wins: a turn ending after the user returned the card changes nothing", async t => {
  const f = await fixture(t), { uid, id } = await f.handoff('codex');
  f.state.messages.push(f.userMessage(id, 'turn-u')); f.emit();
  let card = await f.until(uid, value => value.currentAttempt.turnId === 'turn-u', 'bound');
  const returned = await f.request('POST', `/api/work-items/${uid}/actions`, { mutationId: randomUUID(), expectedRevision: card.revision, action: 'return', reason: '不用做了' });
  assert.equal(returned.statusCode, 200, returned.body);
  f.state.lastTurn = turn('turn-u'); f.emit(); await settle();
  card = await f.item(uid); assert.equal(card.state, 'returned'); assert.equal(card.lastTransition.actor, 'user');
  assert.equal(f.watchers(), 0);
});

test('queued on a busy session: the card stays todo until the message is actually consumed', async t => {
  const f = await fixture(t); f.state.busy = true;
  const { uid, id } = await f.handoff('codex');
  await f.until(uid, value => value.handoffs?.at(-1)?.status === 'queued', 'queued record');
  await settle();
  assert.equal((await f.item(uid)).state, 'todo');
  f.state.busy = false; f.state.messages.push(f.userMessage(id, 'turn-q')); f.emit();
  let card = await f.until(uid, value => value.state === 'in_progress', 'consumed message starts progress');
  assert.equal(card.handoffs.at(-1).status, 'delivered'); assert.equal(card.currentAttempt.turnId, 'turn-q');
  f.state.lastTurn = turn('turn-q'); f.emit();
  card = await f.until(uid, value => value.state === 'to_verify', 'to verify');
});

test('unknown delivery never progresses on its own; the user marking it received starts tracking', async t => {
  const f = await fixture(t); f.state.outcome = 'uncertain';
  const { uid, id } = await f.handoff('codex');
  await f.until(uid, value => value.handoffs?.at(-1)?.status === 'unknown', 'unknown');
  await settle();
  assert.equal((await f.item(uid)).state, 'todo'); assert.equal(f.watchers(), 0);
  const resolved = await f.request('POST', `/api/work-items/${uid}/handoffs/${id}/resolve`, { outcome: 'delivered' });
  assert.equal(resolved.statusCode, 200, resolved.body);
  await f.until(uid, value => value.state === 'in_progress', 'user-confirmed delivery starts progress');
  f.state.messages.push(f.userMessage(id, 'turn-k')); f.state.lastTurn = turn('turn-k'); f.emit();
  await f.until(uid, value => value.state === 'to_verify', 'to verify');
  assert.equal(f.calls.length, 1);
});

test('relay restart resumes tracking from the persisted binding', async t => {
  const first = await fixture(t), { uid, id } = await first.handoff('codex');
  first.state.messages.push(first.userMessage(id, 'turn-r')); first.emit();
  await first.until(uid, value => value.currentAttempt.turnId === 'turn-r', 'bound before restart');
  await first.close();
  const second = await fixture(t, { root: first.root, sessionId: first.sessionId, lastTurn: turn('turn-r') });
  const card = await second.until(uid, value => value.state === 'to_verify', 'resumed after restart');
  assert.equal(card.currentAttempt.lastTurn.turnId, 'turn-r');
  await fs.rm(first.root, { recursive: true, force: true });
});

test('agents without turn binding: delivery moves the card to in_progress, then no watch and no guessed turn result', async t => {
  for (const agent of ['claude', 'opencode']) {
    const f = await fixture(t), { uid } = await f.handoff(agent);
    let card = await f.until(uid, value => value.state === 'in_progress', `${agent} in progress`);
    for (const deadline = Date.now() + 2000; f.watchers() && Date.now() < deadline;) await settle(5);
    assert.equal(f.watchers(), 0);
    f.state.agentLastTurn = turn('whatever'); f.emit(); await settle();
    card = await f.item(uid); assert.equal(card.state, 'in_progress'); assert.equal(card.currentAttempt.agentId, agent);
  }
});

test('DeepSeek (W4b): only the bridge-reported consuming turn is bound; its own result moves the card', async t => {
  const f = await fixture(t), { uid, id } = await f.handoff('deepseek');
  let card = await f.until(uid, value => value.state === 'in_progress', 'deepseek in progress');
  assert.equal(card.currentAttempt.channel, 'agent'); assert.equal(card.currentAttempt.turnId, null);
  f.state.agentLastTurn = turn('7'); f.emit(); await settle();
  card = await f.item(uid); assert.equal(card.state, 'in_progress', 'an old bridge without bindings is never guessed'); assert.equal(card.currentAttempt.turnId, null);
  f.state.consumedTurns = [{ clientMessageId: randomUUID(), turnId: '7' }, { clientMessageId: id, turnId: '8' }]; f.emit();
  card = await f.until(uid, value => value.currentAttempt.turnId === '8', 'consuming turn bound');
  assert.equal(card.state, 'in_progress', "the busy turn's result does not move the card");
  f.state.agentLastTurn = turn('8'); f.emit();
  card = await f.until(uid, value => value.state === 'to_verify', 'completed turn waits for verification');
  assert.equal(card.lastTransition.actor, 'system'); assert.equal(card.currentAttempt.lastTurn.turnId, '8');
  for (const deadline = Date.now() + 2000; f.watchers() && Date.now() < deadline;) await settle(5);
  assert.equal(f.watchers(), 0, 'the watch closes once the turn result is written');
  assert.equal(f.calls.length, 1, 'progress tracking never sends');
});

test('DeepSeek (W4b): a failed consuming turn returns the card with its reason', async t => {
  const f = await fixture(t), { uid, id } = await f.handoff('deepseek');
  await f.until(uid, value => value.state === 'in_progress', 'deepseek in progress');
  f.state.consumedTurns = [{ clientMessageId: id, turnId: '3' }]; f.state.agentLastTurn = turn('3', 'failed'); f.emit();
  const card = await f.until(uid, value => value.state === 'returned', 'failed turn returned');
  assert.equal(card.currentAttempt.turnId, '3'); assert.equal(card.lastTransition.reason, reasons.failed[1]);
});

test('progressCandidate ignores old, foreign-attempt and already-settled cards', () => {
  const now = Date.parse('2026-11-14T00:00:00Z');
  const record = { handoffId: randomUUID(), attemptId: 'a', status: 'delivered', createdAt: new Date(now - 1000).toISOString() };
  const base = { state: 'todo', handoffs: [record], currentAttempt: { attemptId: 'a', delivery: 'none', channel: null, clientMessageId: null, lastTurn: null } };
  assert.equal(progressCandidate(base, now), record);
  assert.equal(progressCandidate({ ...base, handoffs: [{ ...record, createdAt: new Date(now - 25 * 3600e3).toISOString() }] }, now), null);
  assert.equal(progressCandidate({ ...base, currentAttempt: { ...base.currentAttempt, attemptId: 'b' } }, now), null);
  assert.equal(progressCandidate({ ...base, handoffs: [{ ...record, status: 'unknown' }] }, now), null);
  for (const state of ['to_verify', 'done', 'returned']) assert.equal(progressCandidate({ ...base, state }, now), null);
  const running = { ...base, state: 'in_progress', currentAttempt: { attemptId: 'a', delivery: 'delivered', channel: 'codex-desktop', clientMessageId: record.handoffId, lastTurn: null } };
  assert.equal(progressCandidate(running, now), record);
  assert.equal(progressCandidate({ ...running, currentAttempt: { ...running.currentAttempt, channel: 'agent' } }, now), null);
  assert.equal(progressCandidate({ ...running, currentAttempt: { ...running.currentAttempt, channel: 'agent', agentId: 'deepseek' } }, now), record);
  for (const agentId of ['claude', 'opencode', null]) assert.equal(progressCandidate({ ...running, currentAttempt: { ...running.currentAttempt, channel: 'agent', agentId } }, now), null);
});
