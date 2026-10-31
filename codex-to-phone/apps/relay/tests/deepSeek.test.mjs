import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createDeepSeekBridge } from '../../../plugins/mobile-deepseek/bridge.mjs';
import { apply } from '../../../plugins/mobile-deepseek/index.mjs';
import { messageOf } from '../../../plugins/mobile-deepseek/messages.mjs';
import { DeepSeekClient } from '../dist/agents/deepSeekClient.js';
import { DeepSeekAdapter } from '../dist/agents/deepSeekAdapter.js';
import { deepSeekConfigSchema, deepSeekInfo } from '../dist/agents/deepSeekProtocol.js';
import { parseManagedConfig } from '../dist/gateway/config.js';
import { AgentGateway } from '../dist/agents/agentGateway.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const directory = '/synthetic/deepseek', token = 'd'.repeat(48);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 3000; while (!predicate()) { if (Date.now() > end) assert.fail('synthetic dsh timeout'); await sleep(10); } }
const user = value => Object.freeze({ ...value, id: randomUUID(), role: 'user' });

async function fixture(t, options = {}) {
  const listeners = new Map(), calls = [], log = [], agents = new Map(), pendingRemoteEvents = new Map(), continued = [];
  let reads = 0, observations = 0, disposed = 0, release;
  const barrier = options.delayed ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const emit = (name, ...args) => { for (const callback of listeners.get(name) ?? []) callback(...args); };
  const agent = {
    id: 'original-session:with/arbitrary-host-id', status: 'idle', session: { id: 'original-session:with/arbitrary-host-id', header: { cwd: directory, createdAt: 1000 } },
    followup(message) { submit('queue', message); }, steer(message) { submit('steer', message); },
    cancel(cause, config) { calls.push({ action: 'interrupt', cause, config }); if (!options.pendingCancel) event('turn/end', { turn: 1 }); },
  };
  agent.inbox = { nextTurn: [], nextStep: [] };
  if (options.nativeQueue) agent.inbox.remove = messageId => {
    calls.push({ action: 'queue-cancel', messageId });
    if (options.throwQueueCancel) throw new Error('synthetic cancellation outcome unknown');
    const index = agent.inbox.nextTurn.findIndex(message => message.id === messageId);
    if (index < 0) return false;
    agent.inbox.nextTurn.splice(index, 1);
    emit('agent/inbox/spliced', { agent });
    return true;
  };
  agents.set(agent.id, agent);
  function event(type, data) { const value = { seq: log.length, time: Date.now(), type, data }; log.push(value); emit('session/event', agent.session, value); return value; }
  function submit(mode, message) {
    calls.push({ action: 'message', mode, message });
    if (options.throwSend) throw new Error('synthetic private failure');
    if (options.nativeQueue && mode === 'queue' && agent.status === 'running') { agent.inbox.nextTurn.push(message); emit('agent/inbox/spliced', { agent }); return; }
    if (options.confirm) event('user/message', message);
  }
  if (options.running) { agent.status = 'running'; event('turn/start', { turn: 1 }); }
  if (options.initial) {
    event('user/message', user({ source: { kind: 'user' }, content: [{ type: 'text', text: '用户记录' }] }));
    event('user/message', user({ source: { kind: 'context' }, content: [{ type: 'text', text: 'hidden context' }] }));
    event('assistant/message', { turn: 1, step: 1, message: { id: 'initial-assistant', role: 'assistant', content: [{ type: 'text', text: '公开输出' }, { type: 'reasoning', text: 'hidden reasoning' }, { type: 'tool-call', arguments: 'hidden args' }] } });
  }
  const ctx = {
    agents: { list: () => [...agents.values()], get: id => agents.get(id), roots: () => [agent] },
    typertGateway: { pendingRemoteEvents, settleRemoteEvent(pending, outcome) {
      this.finishRemoteEvent(pending);
      pending.source.resolve(outcome);
    }, finishRemoteEvent(pending) {
      this.pendingRemoteEvents.delete(pending.id);
      pending.releaseSignal();
      pending.releaseContext();
      const clients = new Set(pending.deliveries);
      for (const client of clients) this.removeRemoteEventDelivery(pending, client);
      const cancellation = { type: "cancel", eventId: pending.id };
      for (const client of clients) client.queue.push(cancellation);
    } },
    userQuestions: { continued: () => continued, answer(owner, callId, value) {
      assert.equal(owner, agent); calls.push({ action: 'continued', callId, value });
      if (options.throwAnswer) throw new Error('synthetic uncertain');
      agent.inbox.nextStep.push({ source: { kind: 'user-question-reply', callId } });
      return true;
    } },
    on(name, callback) { const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(callback); return () => set.delete(callback); },
    sessionQuery: { async observeSession(id, config) {
      observations++; assert.equal(id, agent.id); assert.equal(config.projectionMode, 'none');
      const captured = log.slice(), cursor = options.large ? 100000 : captured.length - 1;
      await barrier;
      return { source: 'live', cursor, get events() { reads++; if (options.large) assert.fail('large log must not materialize'); return captured; }, [Symbol.dispose]() { disposed++; } };
    } },
  };
  function addPending(type, request) {
    const pending = { id: randomUUID(), source: { event: type, request: { agent, ...request }, resolve: value => { pending.result = value; calls.push({ action: 'interaction', event: type, value: value.value }); } } };
    pending.deliveries = new Set(); pending.releaseSignal = () => {
      if (options.throwSettle) { pendingRemoteEvents.set(pending.id, pending); calls.push({ action: 'interaction-unknown' }); throw new Error('synthetic unknown'); }
    }; pending.releaseContext = () => {};
    pendingRemoteEvents.set(pending.id, pending); return pending;
  }
  const bridge = createDeepSeekBridge(ctx, { port: 0, token, directory }, user, options.harnessVersion ?? '0.2.1-rc.2'), address = await bridge.ready;
  const config = { url: `http://127.0.0.1:${address.port}/`, token, directory };
  const client = new DeepSeekClient(config, { timeoutMs: 2000 }), adapter = new DeepSeekAdapter(client);
  t.after(async () => { await adapter.stop(); await bridge.stop(); });
  const id = (await adapter.listSessions()).sessions[0].id;
  const values = []; let disconnected = 0;
  const watch = async () => adapter.watchSession(id, value => values.push(value), () => { disconnected++; });
  return { addPending, pendingRemoteEvents, continued, bridge, client, adapter, config, id, agent, agents, ctx, event, emit, calls, values, watch, release, stats: () => ({ reads, observations, disposed, disconnected, listeners: [...listeners.values()].reduce((n, set) => n + set.size, 0) }) };
}
const operation = value => ({ clientMessageId: randomUUID(), controlToken: value.control.token });
const current = f => f.values.at(-1);

test('dsh queued mobile input is visible and cancel removes only its original native inbox item', async t => {
  const f = await fixture(t, { running: true, nativeQueue: true }); await f.watch();
  const desktop = user({ source: { kind: 'user' }, content: [{ type: 'text', text: 'desktop-owned queue' }] });
  f.agent.inbox.nextTurn.push(desktop);
  const input = { ...operation(current(f)), text: 'mobile-owned queued input', delivery: 'queue' };
  const result = await f.adapter.sendMessage(f.id, input);
  assert.equal(result.delivery, 'submitted', 'queue acceptance is not execution confirmation');
  await until(() => current(f).submission?.clientMessageId === input.clientMessageId);
  assert.equal(current(f).queue?.available, true);
  assert.deepEqual(current(f).queue.items.map(item => [item.clientMessageId, item.text, item.status]), [[input.clientMessageId, input.text, 'waiting']]);
  assert.equal(current(f).messages.some(message => message.text === input.text), false);
  assert.equal((await f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, operation(current(f)))).delivery, 'confirmed');
  await until(() => current(f).queue?.items.length === 0 && !current(f).submission);
  assert.deepEqual(f.agent.inbox.nextTurn.map(message => message.id), [desktop.id]);
  assert.equal(f.agent.status, 'running');
  assert.equal(f.calls.filter(call => call.action === 'interrupt').length, 0);
  assert.equal(current(f).control.canSend, true);
});

test('dsh queue cancellation rejects foreign and already consumed items without stopping work', async t => {
  const f = await fixture(t, { running: true, nativeQueue: true }); await f.watch();
  const input = { ...operation(current(f)), text: 'queued target', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, input);
  await until(() => current(f).submission?.clientMessageId === input.clientMessageId);
  assert.equal(current(f).queue?.items.length, 1);
  await assert.rejects(f.adapter.cancelQueuedMessage(f.id, randomUUID(), operation(current(f))), { code: 'DEEPSEEK_QUEUE_ITEM_EXPIRED' });
  const taken = f.agent.inbox.nextTurn.shift();
  await assert.rejects(f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, operation(current(f))), { statusCode: 409 });
  assert.equal(f.calls.filter(call => call.action === 'interrupt').length, 0);
  assert.equal(taken.id, f.calls[0].message.id);
});

test('dsh queued input remains cancellable after reconnect and rejects a previous control token', async t => {
  const f = await fixture(t, { running: true, nativeQueue: true }); const close = await f.watch();
  const input = { ...operation(current(f)), text: 'pending across reconnect', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, input);
  await until(() => current(f).queue?.items.length === 1);
  const old = operation(current(f)); close(); await sleep(40);
  await f.watch();
  assert.equal(current(f).queue.items[0].clientMessageId, input.clientMessageId);
  await assert.rejects(f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, old), { code: 'DEEPSEEK_STALE_CONTROL' });
  await f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, operation(current(f)));
  await until(() => current(f).queue.items.length === 0);
  assert.equal(f.calls.filter(call => call.action === 'queue-cancel').length, 1);
});

test('dsh uncertain queue cancellation stays locked across subsequent snapshots and reconnect', async t => {
  const f = await fixture(t, { running: true, nativeQueue: true, throwQueueCancel: true }); const close = await f.watch();
  const input = { ...operation(current(f)), text: 'keep unknown queue outcome', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, input);
  await until(() => current(f).queue?.items.length === 1);
  assert.equal((await f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, operation(current(f)))).delivery, 'uncertain');
  await until(() => current(f).queue.items[0].status === 'uncertain');
  close(); await sleep(40); await f.watch();
  assert.equal(current(f).queue.items[0].status, 'uncertain');
  await assert.rejects(f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, operation(current(f))), { code: 'DEEPSEEK_QUEUE_ITEM_EXPIRED' });
  assert.equal(f.calls.filter(call => call.action === 'queue-cancel').length, 1);
  assert.equal(f.agent.inbox.nextTurn.length, 1);
  // The original bridge also remembers uncertainty if the Relay is restarted.
  await assert.rejects(f.client.json(`/sessions/${f.id}/queue/${input.clientMessageId}/cancel`, z.unknown(), operation(current(f))), { statusCode: 409 });
  assert.equal(f.calls.filter(call => call.action === 'queue-cancel').length, 1);
});

test('dsh late uncertain cancellation cannot restore an item removed by authoritative sync', async t => {
  const f = await fixture(t, { running: true, nativeQueue: true }); await f.watch();
  const input = { ...operation(current(f)), text: 'first queued target', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, input); await until(() => current(f).queue?.items.length === 1);
  const json = f.client.json.bind(f.client); let release;
  f.client.json = async (...args) => {
    const result = await json(...args);
    if (args[0].endsWith('/cancel')) { await new Promise(resolve => { release = resolve; }); return { ok: true, delivery: 'uncertain' }; }
    return result;
  };
  const cancelling = f.adapter.cancelQueuedMessage(f.id, input.clientMessageId, operation(current(f)));
  await until(() => release && current(f).queue?.items.length === 0);
  const next = { ...operation(current(f)), text: 'new queued target', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, next); await until(() => current(f).queue?.items[0]?.clientMessageId === next.clientMessageId);
  release(); await cancelling; f.client.json = json;
  assert.equal(current(f).queue.items[0].status, 'waiting');
  await f.adapter.cancelQueuedMessage(f.id, next.clientMessageId, operation(current(f)));
  await until(() => current(f).queue.items.length === 0);
  assert.equal(f.calls.filter(call => call.action === 'queue-cancel').length, 2);
});

test('dsh public queue cancellation requires a paired device and deduplicates identical operations', async t => {
  const f = await fixture(t, { running: true, nativeQueue: true }); await f.watch();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-dsh-queue-test-'));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty-codex'), defaultCwd: root }, services: { agentGateway: new AgentGateway([f.adapter]), desktopControl: { stop: async () => {} } } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: { authorization: 'Bearer synthetic-admin' } })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code } })).json();
  const headers = { authorization: `Bearer ${device.token}` }, route = `/api/agents/deepseek/sessions/${f.id}`;
  const input = { ...operation(current(f)), text: 'HTTP queued target', delivery: 'queue' };
  assert.equal((await app.inject({ method: 'POST', url: `${route}/messages`, headers, payload: input })).statusCode, 200);
  await until(() => current(f).queue?.items.length === 1);
  const cancel = { method: 'POST', url: `${route}/queue/${input.clientMessageId}/cancel`, headers, payload: operation(current(f)) };
  assert.equal((await app.inject({ ...cancel, headers: {} })).statusCode, 401);
  const replies = await Promise.all([app.inject(cancel), app.inject(cancel)]);
  for (const reply of replies) { assert.equal(reply.statusCode, 200); assert.equal(reply.json().delivery, 'confirmed'); }
  assert.equal(f.calls.filter(call => call.action === 'queue-cancel').length, 1);
  assert.equal((await app.inject({ ...cancel, url: `${route}/queue/${randomUUID()}/cancel` })).statusCode, 409);
  assert.equal((await app.inject({ ...cancel, payload: { ...cancel.payload, extra: true } })).statusCode, 400);
  await until(() => current(f).queue?.items.length === 0);
  assert.equal(f.agent.status, 'running');
});

const modelUnavailable = { kind: 'error', error: { code: 'INVALID_REQUEST', message: '400: {"message":"model is unavailable on every account (per-model cooldown), try another model","type":"invalid_request_error"}' } };

test('dsh failed turn is a visible bounded runtime notice without exposing upstream secrets', () => {
  const event = { seq: 8, time: 1000, type: 'turn/end', data: { turn: 3, reason: modelUnavailable } };
  const failure = messageOf(event);
  assert.match(failure?.text ?? '', /模型服务暂不可用/);
  assert.equal(failure.turnId, '3');
  assert.equal(failure.phase, undefined, 'failure must not claim a successful final answer');
  assert.equal(failure.kind, 'agent_message', 'existing APK36 message contract remains usable');
  const privateFailure = messageOf({ ...event, data: { turn: 3, reason: { kind: 'error', error: { code: 'UNEXPECTED_PRIVATE_CODE', message: 'Bearer synthetic-secret https://private.invalid/api?token=synthetic-key' } } } });
  assert.match(privateFailure.text, /执行失败/);
  assert.doesNotMatch(privateFailure.text, /synthetic|private.invalid|UNEXPECTED_PRIVATE_CODE/);
  assert.ok(Buffer.byteLength(privateFailure.text) < 1024);
  for (const kind of ['completed', 'aborted', 'max-tokens', 'blocked']) assert.equal(messageOf({ ...event, data: { turn: 3, reason: { kind } } }), null);
  assert.equal(messageOf({ ...event, seq: -1 }), null);
  assert.equal(messageOf({ ...event, data: { turn: -1, reason: modelUnavailable } }), null);
});

test('dsh accepted input followed by model failure remains delivered and shows one notice live and after reopen', async t => {
  const f = await fixture(t, { confirm: true }); let close = await f.watch();
  const input = { ...operation(current(f)), text: 'synthetic failed model request', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, input);
  f.agent.status = 'running'; f.event('turn/start', { turn: 8 });
  const errorEvent = f.event('turn/end', { turn: 8, reason: modelUnavailable });
  f.agent.status = 'idle'; f.emit('agent/status', { agent: f.agent });
  await until(() => current(f).messages.some(message => message.text.includes('模型服务暂不可用')));
  const live = current(f), notice = live.messages.find(message => message.text.includes('模型服务暂不可用'));
  assert.equal(live.submission.delivery, 'confirmed');
  assert.equal(live.messages.filter(message => message.text === input.text).length, 1);
  assert.equal(live.messages.filter(message => message.id === notice.id).length, 1);
  assert.equal(live.operationError, null); assert.equal(live.control.canSend, true);
  f.emit('session/event', f.agent.session, errorEvent);
  close(); close = await f.watch();
  assert.deepEqual(current(f).messages.find(message => message.id === notice.id), notice);
  assert.equal(current(f).messages.filter(message => message.id === notice.id).length, 1);
  assert.equal(f.calls.length, 1, 'showing or reopening a failure never resubmits');
  close();
});

for (const harnessVersion of ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5']) test(`dsh ${harnessVersion} reports the loaded runtime and passes the gateway handshake`, async t => {
  const f = await fixture(t, { harnessVersion, initial: true });
  const info = await f.client.json('/info', deepSeekInfo);
  assert.equal(info.harnessVersion, harnessVersion);
  assert.equal(info.messagePhases, true);
  assert.equal((await f.adapter.probe()).capabilities.approve, true);
  const close = await f.watch();
  assert.deepEqual(current(f).messages.map(message => message.text), ['用户记录', '公开输出']);
  assert.equal(f.calls.length, 0);
  close();
});

test('dsh missing or unverified runtime cannot start a bridge or pass the gateway handshake', () => {
  for (const version of [undefined, '', '0.2.1-rc.1', '0.2.1-rc.4', '0.2.1-rc.6', '0.2.1', '0.2.2']) {
    assert.throws(() => createDeepSeekBridge({}, { port: 0, token, directory }, user, version), /DEEPSEEK_VERSION_UNSUPPORTED/u);
    assert.equal(deepSeekInfo.safeParse({ protocol: 1, harnessVersion: version }).success, false);
  }
});

test('dsh constructor/probe/list are passive; arbitrary host id has lifecycle UUID alias and exact scope', async t => {
  const f = await fixture(t);
  assert.match(f.id, /^[0-9a-f-]{36}$/u); assert.notEqual(f.id, f.agent.id);
  assert.deepEqual(f.stats(), { reads: 0, observations: 0, disposed: 0, disconnected: 0, listeners: 6 });
  f.agents.set('other', { id: 'other', session: { header: { cwd: '/synthetic/other' } } });
  f.agents.set('child', { id: 'child', session: { header: { cwd: directory, origin: 'subagent' } } });
  assert.equal((await f.adapter.listSessions()).sessions.length, 1);
  const status = await f.adapter.probe(); assert.equal(status.capabilities.approve, true); assert.equal(status.sameDesktopThreadVerified, false);
  assert.equal(f.stats().reads, 0); assert.equal(f.calls.length, 0);
});

test('dsh private endpoint rejects wrong token, browser origin, query and path-shaped ids', async t => {
  const f = await fixture(t);
  for (const headers of [{}, { Authorization: `Bearer ${token}`, Origin: 'https://synthetic.invalid' }, { Authorization: `Bearer ${token}`, Origin: '' }]) {
    const response = await fetch(new URL('sessions', f.config.url), { headers }); assert.equal(response.status, 403);
  }
  assert.equal((await fetch(new URL('sessions?x=1', f.config.url), { headers: { Authorization: `Bearer ${token}` } })).status, 400);
  assert.equal(f.adapter.validSessionId('../anything'), false);
  await assert.rejects(f.adapter.watchSession('../anything', () => {}, () => {}), { code: 'DEEPSEEK_INPUT_INVALID' });
});

test('dsh reads baseline only on subscription, text-only, bounded, releases observation and shares stream', async t => {
  const f = await fixture(t, { initial: true }); const close = await f.watch(), close2 = await f.watch();
  assert.equal(f.stats().observations, 1); assert.equal(f.stats().reads, 1); assert.equal(f.stats().disposed, 1);
  assert.deepEqual(current(f).messages.map(message => message.text), ['用户记录', '公开输出']);
  assert.equal(JSON.stringify(current(f)).includes('hidden'), false);
  close(); close2(); await sleep(20);
  assert.equal(f.calls.length, 0);
});

test('dsh large log stays lazy; future events sync without claiming complete history', async t => {
  const f = await fixture(t, { large: true }); await f.watch(); assert.equal(f.stats().reads, 0); assert.equal(current(f).partialText, true); assert.equal(current(f).historyCursor, null);
  f.emit('session/event', f.agent.session, { seq: 100001, time: 6000, type: 'user/message', data: user({ source: { kind: 'user' }, content: [{ type: 'text', text: '大日志后续增量' }] }) });
  await until(() => current(f).messages[0]?.text === '大日志后续增量'); assert.equal(f.stats().reads, 0);
});

test('dsh baseline races buffered live events without overriding the newer turn', async t => {
  const f = await fixture(t, { delayed: true }); const pending = f.watch(); await until(() => f.stats().observations === 1);
  f.agent.status = 'running'; f.event('turn/start', { turn: 7 }); f.event('user/message', user({ source: { kind: 'user' }, content: [{ type: 'text', text: '同步期间的新消息' }] }));
  f.release(); await pending; assert.equal(current(f).control.canInterrupt, true); assert.equal(current(f).messages[0].text, '同步期间的新消息');
});

test('dsh queue admission confirms original frozen message once, not an idle signal', async t => {
  const f = await fixture(t, { confirm: true }); await f.watch();
  const input = { ...operation(current(f)), text: '合成输入', delivery: 'queue' };
  assert.equal((await f.adapter.sendMessage(f.id, input)).delivery, 'confirmed');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].mode, 'queue'); assert.equal(Object.isFrozen(f.calls[0].message), true);
  await until(() => current(f).submission?.delivery === 'confirmed'); assert.equal(current(f).messages.filter(message => message.text === input.text).length, 1);
  await assert.rejects(f.adapter.sendMessage(f.id, input)); assert.equal(f.calls.length, 1);
});

test('dsh pending/unknown send locks across reconnect; no automatic replay', async t => {
  const f = await fixture(t, { throwSend: true }); const close = await f.watch();
  const input = { ...operation(current(f)), text: '待确认', delivery: 'queue' };
  assert.equal((await f.adapter.sendMessage(f.id, input)).delivery, 'uncertain');
  close(); await sleep(40); await f.watch();
  assert.equal(current(f).submission.delivery, 'uncertain'); assert.equal(current(f).control.canSend, false); assert.equal(f.calls.length, 1);
});

test('dsh authoritative discard unlocks with rejection tied to original submission', async t => {
  const f = await fixture(t); await f.watch(); const input = { ...operation(current(f)), text: '取消排队', delivery: 'queue' };
  await f.adapter.sendMessage(f.id, input); f.emit('agent/inbox/discarded', { agent: f.agent, message: f.calls[0].message });
  await until(() => current(f).operationError?.clientMessageId === input.clientMessageId); assert.equal(current(f).submission, null); assert.equal(current(f).control.canSend, true);
});

test('dsh steer and cancel bind original open turn; stale turn cannot cancel later work', async t => {
  const f = await fixture(t, { running: true, confirm: true }); await f.watch();
  await f.adapter.sendMessage(f.id, { ...operation(current(f)), text: '当前任务引导', delivery: 'steer' });
  await until(() => current(f).submission?.delivery === 'confirmed'); assert.equal(f.calls[0].mode, 'steer');
  const old = operation(current(f)); f.event('turn/end', { turn: 1 }); f.event('turn/start', { turn: 2 });
  await until(() => current(f).control.token !== old.controlToken);
  await assert.rejects(f.adapter.interruptSession(f.id, old), { code: 'DEEPSEEK_STALE_CONTROL' });
  assert.equal(f.calls.filter(call => call.action === 'interrupt').length, 0);
  assert.equal((await f.adapter.interruptSession(f.id, operation(current(f)))).delivery, 'submitted');
  assert.deepEqual(f.calls.at(-1).cause, { kind: 'user' }); assert.deepEqual(f.calls.at(-1).config, { keepInbox: true });
});

test('dsh interrupt confirmation requires the same turn end, not a later turn', async t => {
  const f = await fixture(t, { running: true, pendingCancel: true }); await f.watch();
  await f.adapter.interruptSession(f.id, operation(current(f))); f.event('turn/end', { turn: 99 });
  await sleep(250); assert.equal(current(f).submission.delivery, 'submitted');
  f.event('turn/end', { turn: 1 }); await until(() => current(f).submission?.delivery === 'confirmed');
});

test('dsh streaming excludes reasoning/tool args and replaces live text with durable message', async t => {
  const f = await fixture(t, { running: true }); await f.watch();
  let revision = 0;
  const send = frame => f.emit('agent/assistant-stream', { agent: f.agent, frame: { attemptId: 'attempt-a', revision: ++revision, ...frame } });
  send({ type: 'start', turn: 1, step: 1 });
  send({ type: 'chunk', index: 0, time: 5000, chunk: { type: 'reasoning-delta', index: 0, text: 'hidden thinking' } });
  send({ type: 'chunk', index: 1, time: 5001, chunk: { type: 'text-delta', index: 1, text: '实时 ' } });
  send({ type: 'chunk', index: 2, time: 5002, chunk: { type: 'text-delta', index: 1, text: '📱' } });
  send({ type: 'chunk', index: 2, time: 5002, chunk: { type: 'text-delta', index: 1, text: '重复帧' } });
  await until(() => current(f).messages[0]?.text === '实时 📱');
  const event = f.event('assistant/message', { turn: 1, step: 1, message: { id: 'canonical', role: 'assistant', content: [{ type: 'text', text: '实时 📱完成' }, { type: 'reasoning', text: 'hidden thinking' }] } });
  send({ type: 'end', index: 3, outcome: { kind: 'committed', eventType: 'assistant/message', seq: event.seq } });
  await until(() => current(f).messages[0]?.text === '实时 📱完成'); assert.equal(current(f).messages.length, 1); assert.equal(JSON.stringify(current(f)).includes('hidden'), false); assert.equal(f.stats().reads, 1);
});

test('dsh abandoned attempt text disappears, status stops on idle, disposal invalidates alias and stream', async t => {
  const f = await fixture(t, { running: true }); await f.watch();
  let revision = 0;
  const emit = frame => f.emit('agent/assistant-stream', { agent: f.agent, frame: { attemptId: 'a', revision: ++revision, ...frame } });
  emit({ type: 'start', turn: 1, step: 1 }); emit({ type: 'chunk', index: 0, chunk: { type: 'text-delta', index: 0, text: '临时' } });
  await until(() => current(f).messages.length === 1); emit({ type: 'end', index: 1, outcome: { kind: 'abandoned' } });
  f.agent.status = 'idle'; f.emit('agent/status', { agent: f.agent, status: 'idle' }); await until(() => current(f).status === 'idle' && current(f).messages.length === 0);
  f.agents.delete(f.agent.id); f.emit('agent/disposed', { agent: f.agent }); await until(() => f.stats().disconnected === 1);
  await assert.rejects(f.client.events(f.id, () => {}, () => {}), { code: 'DEEPSEEK_SESSION_GONE' });
});

test('dsh official per-frame revisions reject stale, duplicate and out-of-order frames across attempts', async t => {
  const f = await fixture(t, { running: true }); await f.watch();
  const emit = frame => f.emit('agent/assistant-stream', { agent: f.agent, frame });
  emit({ type: 'start', attemptId: 'first', revision: 10, turn: 1, step: 1 });
  emit({ type: 'chunk', attemptId: 'first', revision: 11, index: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } });
  emit({ type: 'chunk', attemptId: 'first', revision: 12, index: 1, chunk: { type: 'text-delta', index: 0, text: '实时输出' } });
  await until(() => current(f).messages[0]?.text === '实时输出');
  assert.equal(current(f).activity, 'outputting');
  emit({ type: 'start', attemptId: 'first', revision: 10, turn: 1, step: 1 });
  emit({ type: 'chunk', attemptId: 'first', revision: 12, index: 2, chunk: { type: 'text-delta', index: 0, text: '过期' } });
  emit({ type: 'chunk', attemptId: 'first', revision: 13, index: 1, chunk: { type: 'text-delta', index: 0, text: '重复' } });
  emit({ type: 'chunk', attemptId: 'first', revision: 14, index: 3, chunk: { type: 'text-delta', index: 0, text: '乱序' } });
  emit({ type: 'chunk', attemptId: 'first', revision: 13, index: 2, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '实时输出完成' } } });
  await until(() => current(f).messages[0]?.text === '实时输出完成');
  emit({ type: 'end', attemptId: 'first', revision: 14, index: 3, outcome: { kind: 'abandoned' } });
  await until(() => current(f).messages.length === 0);
  emit({ type: 'start', attemptId: 'next', revision: 15, turn: 1, step: 2 });
  emit({ type: 'chunk', attemptId: 'next', revision: 16, index: 0, chunk: { type: 'text-delta', index: 0, text: '新尝试' } });
  emit({ type: 'end', attemptId: 'first', revision: 17, index: 1, outcome: { kind: 'abandoned' } });
  emit({ type: 'start', attemptId: 'first', revision: 10, turn: 1, step: 1 });
  emit({ type: 'chunk', attemptId: 'next', revision: 17, index: 1, chunk: { type: 'text-delta', index: 0, text: '继续' } });
  await until(() => current(f).messages[0]?.text === '新尝试继续');
  assert.equal(current(f).messages.length, 1);
});

test('dsh recent text/message budgets are bounded and stop removes all host listeners', async t => {
  const f = await fixture(t); await f.watch();
  for (let i = 0; i < 140; i++) f.event('user/message', user({ source: { kind: 'user' }, content: [{ type: 'text', text: '界'.repeat(20000) }] }));
  await until(() => current(f).messages.length > 0); assert.ok(Buffer.byteLength(JSON.stringify(current(f).messages)) < 270000); assert.ok(current(f).messages.length <= 120);
  await f.adapter.stop(); await f.bridge.stop(); assert.equal(f.stats().listeners, 0); assert.equal(f.calls.length, 0);
});

test('dsh config rejects remote URL, shared secret and unknown settings', () => {
  assert.equal(deepSeekConfigSchema.safeParse({ url: 'https://synthetic.invalid', token, directory }).success, false);
  assert.equal(deepSeekConfigSchema.safeParse({ url: 'http://127.0.0.1:1/?x=1', token, directory }).success, false);
  const base = { version: 1, port: 8787, token: 'm'.repeat(40), managerKey: 'k'.repeat(40), workspace: '/synthetic', codexHome: '/synthetic/codex', desktopTransport: 'native' };
  assert.equal(parseManagedConfig({ ...base, deepseek: { url: 'http://127.0.0.1:9876/', token, directory } }).deepseek.token, token);
  assert.throws(() => parseManagedConfig({ ...base, deepseek: { url: 'http://127.0.0.1:9876/', token: base.token, directory } }), { code: 'GATEWAY_CONFIG_INVALID' });
  assert.throws(() => createDeepSeekBridge({}, { port: 0, token, directory, unwanted: true }, user, '0.2.1-rc.2'));
});

test('dsh loader rejects private configuration errors before loading the host factory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-config-test-')), file = path.join(root, 'private.json');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(apply({}, { configFile: 'relative.json' }), { message: 'DEEPSEEK_CONFIG_INVALID' });
  await fs.writeFile(file, '{"token":"private malformed', { mode: 0o600 });
  await assert.rejects(apply({}, { configFile: file }), { message: 'DEEPSEEK_CONFIG_INVALID' });
  if (process.platform !== 'win32') {
    await fs.chmod(file, 0o644); await assert.rejects(apply({}, { configFile: file }), { message: 'DEEPSEEK_CONFIG_PERMISSIONS' });
  }
});

test('dsh alias never redirects a disposed handle to a replacement with the same host id', async t => {
  const f = await fixture(t); await f.watch(); const old = operation(current(f));
  f.agents.set(f.agent.id, { ...f.agent });
  await assert.rejects(f.adapter.sendMessage(f.id, { ...old, delivery: 'queue', text: '不能转发给替代会话' }), { code: 'DEEPSEEK_SESSION_GONE' });
  assert.equal(f.calls.length, 0);
});

test('dsh relay production factory registers configured adapter without an injected AgentGateway', async t => {
  const f = await fixture(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-dsh-factory-test-'));
  const app = await createRelayServer({ logger: false, config: {
    host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty-codex'), defaultCwd: root, deepseek: f.config,
  }, services: { desktopControl: { stop: async () => {} } } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const headers = { authorization: 'Bearer synthetic-admin' };
  const listed = await app.inject({ url: '/api/agents', headers });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().agents.find(agent => agent.id === 'deepseek')?.state, 'unprobed');
  assert.equal(f.stats().observations, 0);
  const sessions = await app.inject({ url: '/api/agents/deepseek/sessions', headers });
  assert.equal(sessions.statusCode, 200);
  assert.deepEqual(sessions.json().sessions.map(session => session.id), [f.id]);
  assert.equal(f.stats().reads, 0);
  assert.equal(f.calls.length, 0);
  const status = await app.inject({ method: 'POST', url: '/api/agents/deepseek/probe', headers });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().agent.state, 'connected');
  assert.equal(JSON.stringify(status.json()).includes(token), false);
});

test('dsh public Agent routes retain pairing auth, session-bound SSE tokens and duplicate protection', async t => {
  const f = await fixture(t, { confirm: true, running: true });
  const nativeQuestion = f.addPending('user-questions/request', { questions: [{ id: 'q', question: '测试原问题', options: [{ label: '继续' }] }] });
  f.event('step/start', { turn: 1, step: 1 });
  f.event('tool/call', { turn: 1, step: 1, callId: 'http-tool', name: 'bash', arguments: '{"command":"printf safe"}' });
  const nativePermission = f.addPending('approval/request', { toolName: 'bash', callId: 'http-tool' });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-dsh-test-'));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty-codex'), defaultCwd: root }, services: { agentGateway: new AgentGateway([f.adapter]), desktopControl: { stop: async () => {} } } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const auth = { authorization: 'Bearer synthetic-admin' }, route = `/api/agents/deepseek/sessions/${f.id}`, base = `http://127.0.0.1:${app.server.address().port}`;
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code } })).json(); assert.ok(device.token);
  const deviceAuth = { authorization: `Bearer ${device.token}` };
  assert.equal((await app.inject({ url: '/api/agents/deepseek/sessions' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/agents/deepseek/sessions', headers: deviceAuth })).statusCode, 200);
  const streamToken = (await app.inject({ method: 'POST', url: `${route}/stream-token`, headers: deviceAuth })).json().streamToken;
  assert.equal((await fetch(`${base}/api/agents/deepseek/sessions/${randomUUID()}/events?streamToken=${streamToken}`)).status, 401);
  const response = await fetch(`${base}${route}/events?streamToken=${streamToken}`), reader = response.body.getReader();
  const { value } = await reader.read(), frame = new TextDecoder().decode(value);
  const snapshot = JSON.parse(frame.split('\n').find(line => line.startsWith('data:')).slice(5));
  for (const [kind, extra, native] of [['questions', { answers: [['继续']] }, nativeQuestion], ['permissions', { decision: 'reject' }, nativePermission]]) {
    const item = snapshot[kind][0], interaction = { method: 'POST', url: `${route}/${kind}/${item.id}/respond`, headers: deviceAuth, payload: { ...operation(snapshot), ...extra } };
    assert.equal((await app.inject({ ...interaction, headers: {} })).statusCode, 401);
    const [a, b] = await Promise.all([app.inject(interaction), app.inject(interaction)]);
    assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200); assert.ok(native.result);
    assert.equal((await app.inject({ ...interaction, payload: { ...interaction.payload, ...(kind === 'questions' ? { answers: [['改变']] } : { decision: 'once' }) } })).statusCode, 409);
  }
  assert.equal(nativePermission.result.value, 'rejected');
  const payload = { ...operation(snapshot), text: '设备原会话测试', delivery: 'queue' }, request = { method: 'POST', url: `${route}/messages`, headers: deviceAuth, payload };
  const [a, b] = await Promise.all([app.inject(request), app.inject(request)]);
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200); assert.equal(f.calls.filter(call => call.action === 'message').length, 1);
  assert.equal((await app.inject({ ...request, payload: { ...payload, text: '同ID改内容' } })).statusCode, 409);
  await reader.cancel();
});

for (const mode of ['version', 'redirect', 'oversize', 'timeout']) test(`dsh client fails closed on ${mode}, never follows or retries`, async t => {
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    if (mode === 'redirect') { res.writeHead(302, { location: '/unexpected' }); res.end(); }
    else if (mode === 'oversize') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify('x'.repeat(1024 * 1024 + 1))); }
    else if (mode === 'version') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ protocol: 1, harnessVersion: 'unknown' })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = new DeepSeekClient({ url: `http://127.0.0.1:${server.address().port}/`, token, directory }, { timeoutMs: 60 });
  t.after(async () => { client.stop(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  await assert.rejects(client.json('/info', mode === 'oversize' ? z.unknown() : deepSeekInfo)); assert.equal(calls, 1);
});

const question = (id = 'direction') => ({ id, question: '下一步做什么？', header: '方向', options: [{ label: '继续', description: '保留原任务' }, { label: '暂停' }] });
function approval(f, args = '{"command":"printf safe","timeout":1000}', extra = {}) {
  f.event('step/start', { turn: 1, step: 1 });
  f.event('tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'bash', arguments: args });
  return f.addPending('approval/request', { toolName: 'bash', callId: 'call-a', reason: '需要本次操作权限', ...extra });
}

test('dsh pre-existing native questions retain plan detail and exact answer ids/labels/custom', async t => {
  const f = await fixture(t, { running: true });
  const pending = f.addPending('user-questions/request', { questions: [
    { ...question(), detail: '完整计划\n第一步：检查\n第二步：执行', intent: { kind: 'plan-review', approve: '继续' } },
    { ...question('many'), multiSelect: true }, { id: 'text', question: '补充说明' },
  ] });
  await f.watch(); const card = current(f).questions[0];
  assert.ok(card.questions[0].question.includes('第二步：执行'));
  assert.equal((await f.adapter.respondQuestion(f.id, card.id, { ...operation(current(f)), answers: [['继续'], ['继续', '自己的补充'], ['自由回答']] })).delivery, 'confirmed');
  assert.deepEqual(pending.result.value, { answers: [ { id: 'direction', selected: ['继续'] }, { id: 'many', selected: ['继续'], custom: '自己的补充' }, { id: 'text', selected: [], custom: '自由回答' } ] });
  await until(() => current(f).questions.length === 0); assert.equal(f.calls.length, 1);
});

test('dsh approval exposes complete original input and only one-time allow or reject', async t => {
  const f = await fixture(t, { running: true }); const pending = approval(f); await f.watch();
  const card = current(f).permissions[0];
  assert.deepEqual(card.decisions, ['once', 'reject']); assert.ok(card.detail.endsWith('{"command":"printf safe","timeout":1000}'));
  await assert.rejects(f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'always' }), { code: 'DEEPSEEK_DECISION_UNAVAILABLE' });
  assert.equal(f.calls.length, 0);
  const input = { ...operation(current(f)), decision: 'once' };
  const [first, second] = await Promise.allSettled([f.adapter.respondPermission(f.id, card.id, input), f.adapter.respondPermission(f.id, card.id, input)]);
  assert.equal(first.status, 'fulfilled'); assert.equal(second.status, 'rejected');
  assert.equal(pending.result.value, 'allowed-once'); assert.equal(f.calls.length, 1);
});

test('dsh approval preserves official localized display reasons and settles the original request', async t => {
  const f = await fixture(t, { running: true });
  const pending = approval(f, undefined, { displayReason: { en: 'Read outside the workspace', zh: '读取工作区外文件' } });
  await f.watch(); const card = current(f).permissions[0];
  assert.deepEqual(card.decisions, ['once', 'reject']);
  assert.ok(card.detail.includes('Read outside the workspace')); assert.ok(card.detail.includes('读取工作区外文件'));
  assert.ok(card.detail.includes('需要本次操作权限')); assert.ok(!card.detail.includes('[object Object]'));
  await f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'once' });
  assert.equal(pending.result.value, 'allowed-once'); assert.equal(f.calls.length, 1);
});

test('dsh malformed or oversized localized reasons cannot allow but can reject', async t => {
  for (const displayReason of [null, 'plain text', [], { zh: '缺少英文回退' }, { en: { text: 'nested' } }, { en: '界'.repeat(11000) }, { en: 'fallback', zh: 1 }]) {
    const f = await fixture(t, { running: true }); const pending = approval(f, undefined, { displayReason });
    await f.watch(); const card = current(f).permissions[0];
    assert.deepEqual(card.decisions, ['reject']);
    await assert.rejects(f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'once' }));
    await f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'reject' });
    assert.equal(pending.result.value, 'rejected'); assert.equal(f.calls.length, 1);
  }
});

test('dsh approval missing, malformed, oversized or ambiguous input cannot allow but can reject', async t => {
  for (const mode of ['missing', 'malformed', 'oversize', 'duplicate']) {
    const f = await fixture(t, { running: true });
    const pending = mode === 'missing' ? f.addPending('approval/request', { toolName: 'bash', callId: 'missing' }) : approval(f, mode === 'malformed' ? 'not json' : mode === 'oversize' ? JSON.stringify({ text: '界'.repeat(132000) }) : '{"command":"safe"}');
    if (mode === 'duplicate') f.event('tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'bash', arguments: '{"command":"different"}' });
    await f.watch(); const card = current(f).permissions[0]; assert.deepEqual(card.decisions, ['reject'], mode);
    await assert.rejects(f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'once' }));
    await f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'reject' }); assert.equal(pending.result.value, 'rejected');
  }
});

test('dsh PTC approval indexes subCallId from dispatch-start before execution', async t => {
  const f = await fixture(t, { running: true }); f.event('step/start', { turn: 1, step: 2 });
  f.event('tool/ptc-dispatch-start', { subCallId: 'ptc-a', rootCallId: 'root', parentCallId: 'root', name: 'bash', arguments: { command: 'printf ptc' } });
  const pending = f.addPending('approval/request', { toolName: 'bash', callId: 'ptc-a' }); await f.watch();
  const card = current(f).permissions[0]; assert.deepEqual(card.decisions, ['once', 'reject']);
  await f.adapter.respondPermission(f.id, card.id, { ...operation(current(f)), decision: 'once' }); assert.equal(pending.result.value, 'allowed-once');
});

test('dsh desktop-first, cancellation and request changes reject old mobile cards', async t => {
  for (const mode of ['desktop', 'abort', 'change', 'turn', 'owner']) {
    const f = await fixture(t, { running: true }); const control = new AbortController();
    const pending = f.addPending('user-questions/request', { questions: [question()], signal: control.signal }); await f.watch();
    const card = current(f).questions[0], input = { ...operation(current(f)), answers: [['继续']] };
    if (mode === 'desktop') f.ctx.typertGateway.settleRemoteEvent(pending, { kind: 'result', value: { answers: [] } });
    if (mode === 'abort') control.abort();
    if (mode === 'change') pending.source.request.questions[0] = { ...question(), detail: '改变的计划' };
    if (mode === 'turn') f.event('turn/end', { turn: 1 });
    if (mode === 'owner') f.agents.set(f.agent.id, { ...f.agent });
    await assert.rejects(f.adapter.respondQuestion(f.id, card.id, input), undefined, mode);
    assert.equal(f.calls.length, mode === 'desktop' ? 1 : 0, mode);
  }
});

test('dsh unknown interaction stays locked across re-subscription without replay', async t => {
  const f = await fixture(t, { running: true, throwSettle: true });
  f.addPending('user-questions/request', { questions: [question()] }); const close = await f.watch(); const id = current(f).questions[0].id;
  assert.equal((await f.adapter.respondQuestion(f.id, id, { ...operation(current(f)), answers: [['继续']] })).delivery, 'uncertain');
  close(); await sleep(40); await f.watch();
  assert.equal(current(f).questions[0].status, 'uncertain');
  await assert.rejects(f.adapter.respondQuestion(f.id, id, { ...operation(current(f)), answers: [['继续']] })); assert.equal(f.calls.length, 1);
});

test('dsh native interactions remain answerable while ordinary queued input is uncertain', async t => {
  const f = await fixture(t, { running: true, throwSend: true });
  f.addPending('user-questions/request', { questions: [question()] }); await f.watch();
  await f.adapter.sendMessage(f.id, { ...operation(current(f)), text: 'queued', delivery: 'queue' });
  await until(() => current(f).submission?.delivery === 'uncertain'); const id = current(f).questions[0].id;
  await f.adapter.respondQuestion(f.id, id, { ...operation(current(f)), answers: [['继续']] });
  assert.equal(f.calls.filter(c => c.action === 'interaction').length, 1);
});

test('dsh continued question survives turn end, uses original service and remains locked until admission', async t => {
  const f = await fixture(t, { running: true }); f.continued.push({ callId: 'continued-a', state: 'continued', questions: [question()] });
  const close = await f.watch(); const id = current(f).questions[0].id;
  f.event('turn/end', { turn: 1 }); f.agent.status = 'idle'; await until(() => !current(f).control.canInterrupt);
  assert.equal(current(f).questions[0].id, id);
  assert.equal((await f.adapter.respondQuestion(f.id, id, { ...operation(current(f)), answers: [['自填内容']] })).delivery, 'submitted');
  assert.deepEqual(f.calls[0].value.answers, [{ id: 'direction', selected: [], custom: '自填内容' }]);
  close(); await sleep(40); await f.watch(); assert.equal(current(f).questions[0].status, 'submitted');
  f.continued.length = 0; await until(() => current(f).questions.length === 0);
});

test('dsh unsupported question shapes disable answer without hiding incomplete plan as actionable', async t => {
  const f = await fixture(t); f.addPending('user-questions/request', { questions: [{ ...question(), intent: { kind: 'plan-review', approve: '继续' } }] }); await f.watch();
  const card = current(f).questions[0]; assert.ok(card.unavailableReason); assert.equal(card.questions[0].custom, false);
  await assert.rejects(f.adapter.respondQuestion(f.id, card.id, { ...operation(current(f)), answers: [['继续']] })); assert.equal(f.calls.length, 0);
});

test('dsh other agents and owned children cannot leak or receive root interaction answers', async t => {
  const f = await fixture(t, { running: true });
  const other = { ...f.agent, id: 'other-live', session: { header: { cwd: directory } } }; f.agents.set(other.id, other);
  f.addPending('approval/request', { agent: other, toolName: 'bash' }); f.addPending('user-questions/request', { agent: other, questions: [question()] }); await f.watch();
  assert.equal(current(f).questions.length, 0); assert.equal(current(f).permissions.length, 0); assert.equal(f.calls.length, 0);
});

test('dsh unknown host seam disables cards and approval capability', async t => {
  const f = await fixture(t, { running: true }); approval(f);
  f.ctx.typertGateway.settleRemoteEvent = () => { assert.fail('unvetted host method must not run'); };
  await f.watch(); assert.equal(current(f).permissions.length, 0); assert.equal((await f.adapter.probe()).capabilities.approve, false);
});

test('dsh answer validation rejects multiple single choices and duplicate values before host settlement', async t => {
  const f = await fixture(t); f.addPending('user-questions/request', { questions: [question()] }); await f.watch();
  for (const answers of [[['继续', '暂停']], [['继续', '继续']], [[]], [], [[' ']]]) {
    // Direct bridge preflight avoids the adapter's deliberate disconnect on definite HTTP errors.
    const res = await fetch(`${f.config.url}sessions/${f.id}/questions/${current(f).questions[0].id}/respond`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...operation(current(f)), answers }),
    });
    assert.equal(res.status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('dsh request snapshot total remains bounded and overflow cannot be allowed via forged once', async t => {
  const f = await fixture(t, { running: true });
  for (let i = 0; i < 16; i++) f.addPending('user-questions/request', { questions: [{ id: `q${i}`, question: '界'.repeat(40000) }] });
  await f.watch(); assert.ok(Buffer.byteLength(JSON.stringify(current(f))) < 800000);
  assert.ok(current(f).questions.some(q => q.unavailableReason));
});

test('dsh adapter retains uncertain pre-host transport submission across reconnect', async () => {
  const id = randomUUID(), requestId = randomUUID(); let writes = 0;
  const snapshot = { agentId: 'deepseek', session: { id, directory, title: 'synthetic', updatedAt: new Date().toISOString() }, connected: true,
    updatedAt: new Date().toISOString(), status: 'running', activity: 'working', messages: [], permissions: [],
    questions: [{ id: requestId, status: 'pending', questions: [{ question: 'test', options: [], header: '', custom: true, multiple: false }] }],
    control: { token: randomUUID(), canSend: true, canSteer: true, canInterrupt: true }, submission: null, historyCursor: null, partialText: true };
  const client = { config: { directory }, stop() {}, json(route) { if (route === '/info') return Promise.resolve({ protocol: 1, harnessVersion: '0.2.1-rc.2' }); writes++; throw new Error('transport lost before host'); },
    events(_id, receive) { receive(structuredClone(snapshot)); return Promise.resolve(() => {}); } };
  const adapter = new DeepSeekAdapter(client), values = [];
  const close = await adapter.watchSession(id, value => values.push(value), () => {});
  assert.equal((await adapter.respondQuestion(id, requestId, { ...operation(values.at(-1)), answers: [['test']] })).delivery, 'uncertain');
  close(); await adapter.watchSession(id, value => values.push(value), () => {});
  assert.equal(values.at(-1).questions[0].status, 'uncertain');
  await assert.rejects(adapter.respondQuestion(id, requestId, { ...operation(values.at(-1)), answers: [['test']] })); assert.equal(writes, 1); await adapter.stop();
});


test('dsh an earlier step approval cannot borrow a reused call id from the next step', async t => {
  const f = await fixture(t, { running: true }); approval(f); await f.watch();
  const card = current(f).permissions[0], input = { ...operation(current(f)), decision: 'once' };
  f.event('step/start', { turn: 1, step: 2 });
  f.event('tool/call', { turn: 1, step: 2, callId: 'call-a', name: 'bash', arguments: '{"command":"different step"}' });
  await assert.rejects(f.adapter.respondPermission(f.id, card.id, input)); assert.equal(f.calls.length, 0);
});

test('dsh projects progress and stream with turn identity, then promotes only its successful final step', async t => {
  const f = await fixture(t); await f.watch();
  const assistant = (id, content, extra = {}) => ({ turn: 8, step: 1, message: { id, role: 'assistant', content }, ...extra });
  f.agent.status = 'running'; f.event('turn/start', { turn: 8 });
  f.event('step/start', { turn: 8, step: 1 });
  f.event('assistant/message', assistant('progress', [{ type: 'text', text: '正在检查' }, { type: 'tool-call', name: 'bash', arguments: 'private' }]));
  f.event('step/start', { turn: 8, step: 2 });
  f.emit('agent/assistant-stream', { agent: f.agent, frame: { type: 'start', attemptId: 'phase-fixture', revision: 1, turn: 8, step: 2 } });
  f.emit('agent/assistant-stream', { agent: f.agent, frame: { type: 'chunk', attemptId: 'phase-fixture', revision: 2, index: 0, time: 5000, chunk: { type: 'text-delta', index: 0, text: '最终结果' } } });
  await until(() => current(f).messages.some(message => message.text === '最终结果'));
  assert.deepEqual(current(f).messages.map(message => [message.id, message.phase, message.turnId]), [['message-progress', 'commentary', '8'], [current(f).messages.at(-1).id, 'commentary', '8']]);
  f.event('assistant/message', assistant('final', [{ type: 'text', text: '最终结果' }], { step: 2 }));
  f.event('step/end', { turn: 8, step: 2 }); f.event('turn/end', { turn: 8, reason: { kind: 'completed' } });
  await until(() => current(f).messages.at(-1)?.phase === 'final_answer');
  assert.deepEqual(current(f).messages.map(message => [message.id, message.phase, message.turnId]), [['message-progress', 'commentary', '8'], ['message-final', 'final_answer', '8']]);
  assert.equal(JSON.stringify(current(f)).includes('private'), false);
});

for (const kind of ['aborted', 'error', 'max-tokens', 'blocked']) test(`dsh ${kind} preserves partial output as progress instead of claiming a final`, async t => {
  const f = await fixture(t); await f.watch();
  f.event('turn/start', { turn: 3 }); f.event('step/start', { turn: 3, step: 1 });
  f.event('assistant/message', { turn: 3, step: 1, message: { id: 'partial', role: 'assistant', content: [{ type: 'text', text: '尚未完成' }] }, ...(kind === 'aborted' ? { interrupted: true } : {}) });
  f.event('turn/end', { turn: 3, reason: { kind } }); f.emit('agent/status', { agent: f.agent });
  await until(() => current(f).messages.length === (kind === 'error' ? 2 : 1));
  assert.equal(current(f).messages[0].phase, 'commentary');
  assert.ok(current(f).messages.every(message => message.phase !== 'final_answer'));
  if (kind === 'error') assert.match(current(f).messages[1].text, /运行提示.*执行失败/);
});

test('dsh successful empty or tool-only later step cannot relabel an earlier answer, including after reconnect', async t => {
  const f = await fixture(t); let close = await f.watch();
  f.event('turn/start', { turn: 4 }); f.event('step/start', { turn: 4, step: 1 });
  f.event('assistant/message', { turn: 4, step: 1, message: { id: 'earlier', role: 'assistant', content: [{ type: 'text', text: '继续工作' }] } });
  f.event('step/start', { turn: 4, step: 2 }); f.event('turn/end', { turn: 4, reason: { kind: 'completed' } });
  await until(() => current(f).messages.length === 1); assert.equal(current(f).messages[0].phase, 'commentary');
  close(); await sleep(30); close = await f.watch();
  assert.equal(current(f).messages[0].phase, 'commentary'); close();
});
