import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DesktopIpcClient } from '../dist/desktop/desktopIpcClient.js';
import { DesktopControl } from '../dist/desktop/desktopControl.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const threadId = 'synthetic-native-thread';
const frame = value => { const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header, body]); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 2000; while (!predicate()) { if (Date.now() > end) assert.fail('synthetic native state timed out'); await sleep(5); } }
const state = active => ({ id: threadId, hostId: 'local', cwd: '/synthetic/project', requests: [],
  turnHistory: { kind: 'canonical', history: { entitiesByKey: { initial: { turnId: 'initial-turn', status: active ? 'inProgress' : 'completed', params: {}, items: [] } }, islands: [{ entries: [{ value: 'initial' }] }] } } });
const turns = f => f.state.turnHistory.history.entitiesByKey;

async function fixture(t, active = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcn-'));
  const pipePath = path.join(root, 'ipc.sock');
  const sockets = new Set(), controls = [];
  let connected;
  const f = { state: state(active), owner: 'synthetic-owner', revision: 0, behavior: 'confirm' };
  f.snapshot = () => connected?.write(frame({ type: 'broadcast', sourceClientId: f.owner, version: 11, method: 'thread-stream-state-changed', params: { conversationId: threadId, hostId: 'local', change: { type: 'snapshot', revision: ++f.revision, conversationState: f.state } } }));
  f.disconnect = () => connected.destroy();
  f.accept = m => {
    if (m.method === 'thread-follower-start-turn') {
      turns(f).next = { turnId: 'next-turn', status: 'inProgress', params: m.params.turnStart.request, items: [] };
      f.state.turnHistory.history.islands[0].entries.push({ value: 'next' });
    } else if (m.method === 'thread-follower-steer-turn') {
      turns(f).initial.items.push({ type: 'steeringUserMessage', id: 'owner-created-item', clientUserMessageId: m.params.clientUserMessageId, status: 'accepted', input: m.params.input });
    } else turns(f).initial.status = f.behavior === 'complete' ? 'completed' : 'interrupted';
    f.snapshot();
  };
  const server = net.createServer(socket => {
    connected = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const size = buffer.readUInt32LE(0), m = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
        if (m.type === 'broadcast') { if (m.params.following) f.snapshot(); continue; }
        if (m.type !== 'request') continue;
        const reply = (result, extra = {}) => socket.write(frame({ type: 'response', method: m.method, requestId: m.requestId, resultType: 'success', handledByClientId: f.owner, result, ...extra }));
        if (m.method === 'initialize') { reply({ clientId: 'synthetic-relay' }); continue; }
        if (m.method === 'thread-owner-discovery') { reply({}); continue; }
        controls.push(m);
        // This fixture deliberately requires the installed host's request/context contract.
        const restore = m.params.restoreMessage ?? m.params.turnStart?.context.restoreMessage;
        if (m.method !== 'thread-follower-interrupt-turn') {
          assert.deepEqual(restore, { cwd: '/synthetic/project', context: { workspaceRoots: ['/synthetic/project'], collaborationMode: null, commentAttachments: [] }, responsesapiClientMetadata: null });
          assert.equal(m.params.turnStartParams, undefined);
          if (m.method === 'thread-follower-start-turn') { assert.equal(m.version, 2); assert.equal(m.params.turnStart.request.threadId, threadId); assert.equal(m.params.turnStart.context.inheritThreadSettings, true); }
          else assert.equal(m.version, 1);
        } else { assert.equal(m.version, 4); assert.equal(m.params.mode, 'user-stop'); assert.equal(m.params.expectedTurnId, 'initial-turn'); }
        assert.equal(m.targetClientId, f.owner);
        if (f.behavior === 'hold') continue;
        if (f.behavior === 'disconnect') { socket.destroy(); continue; }
        if (f.behavior === 'error') { reply(null, { resultType: 'error', error: 'cannot steer: sensitive-upstream-error' }); continue; }
        const result = m.method === 'thread-follower-start-turn' ? { result: { turn: { id: 'next-turn' } } }
          : m.method === 'thread-follower-steer-turn' ? { result: { turnId: 'initial-turn' } } : { ok: true, interruptedTurnId: 'initial-turn' };
        reply(result, f.behavior === 'wrong-owner' ? { handledByClientId: 'different-owner' } : f.behavior === 'wrong-method' ? { method: 'wrong-method' } : f.behavior === 'wrong-inner-method' ? { result: { method: 'wrong-method', result: { turnId: 'initial-turn' } } } : f.behavior === 'wrong-turn' ? { result: { turnId: 'different-turn' } } : f.behavior === 'malformed' ? { result: { ok: true } } : {});
        if (['ack', 'wrong-owner', 'wrong-method', 'wrong-inner-method', 'wrong-turn', 'malformed'].includes(f.behavior)) continue;
        f.accept(m);
      }
    });
  });
  server.listen(pipePath); await once(server, 'listening');
  const client = new DesktopIpcClient({ clientType: 'synthetic-native', pipePath, requestTimeoutMs: 60 });
  const store = { getThreadSummary: async () => null, getActiveDesktopThread: async () => null, close() {} };
  const control = new DesktopControl(store, { client, transport: 'native', confirmationMs: 20 });
  t.after(async () => { await control.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  Object.assign(f, { control, controls, store, root, capability: () => control.getStreamSnapshot(threadId)?.control,
    input: (extra = {}) => ({ threadId, message: 'synthetic message', clientMessageId: randomUUID(), controlToken: f.capability()?.token, expectedTurnId: f.capability()?.activeTurnId, ...extra }),
    follow: async () => { const stop = control.followThread(threadId); await until(() => f.capability()?.token); return stop; } });
  return f;
}

test('native start uses canonical history, v2 request/context and confirms a client message identity', async t => {
  const f = await fixture(t); await f.follow(); const input = f.input();
  const r = await f.control.sendMessage(input);
  assert.equal(r.delivery, 'confirmed'); assert.equal(r.action, 'start-turn'); assert.equal(r.turnStatus, 'inProgress');
  assert.equal(f.controls[0].params.turnStart.request.clientUserMessageId, input.clientMessageId);
  assert.equal(f.capability().activeTurnId, 'next-turn'); assert.equal(f.capability().canSend, true);
  assert.equal(f.capability().submission.clientMessageId, input.clientMessageId);
  const projected = f.control.getStreamSnapshot(threadId).messages.find(message => message.text === input.message);
  assert.equal(projected?.role, 'user');
  assert.equal(projected?.clientMessageId, input.clientMessageId, 'fallback turn input retains its submission identity');
});

test('native steer requires restore context and accepted client identity, with no start fallback', async t => {
  const f = await fixture(t, true); await f.follow(); const input = f.input();
  const r = await f.control.sendMessage(input);
  assert.equal(r.delivery, 'confirmed'); assert.equal(r.action, 'steer-turn');
  assert.equal(f.controls.length, 1); assert.equal(f.controls[0].params.clientUserMessageId, input.clientMessageId);
  const projected = f.control.getStreamSnapshot(threadId).messages.find(message => message.text === input.message);
  assert.equal(projected?.role, 'user', 'accepted native steering is visible as user input');
  assert.equal(projected?.clientMessageId, input.clientMessageId);
  assert.equal(projected?.turnId, 'initial-turn', 'accepted steering carries the real target turn, not a text or time guess');
});

test('canonical user items retain only their own identity; pending and rejected steering are not confirmed messages', async t => {
  const f = await fixture(t, true); await f.follow();
  turns(f).initial.items = [
    { type: 'userMessage', id: 'initial-user', clientId: 'canonical-client', content: [{ type: 'text', text: 'canonical user' }] },
    ...['pending', 'rejected', 'accepted'].map(status => ({ type: 'steeringUserMessage', id: `steer-${status}`, status, clientUserMessageId: `client-${status}`, input: [{ type: 'text', text: `input-${status}` }] })),
  ];
  f.snapshot();
  await until(() => f.control.getStreamSnapshot(threadId)?.messages.some(message => message.text === 'canonical user'));
  const messages = f.control.getStreamSnapshot(threadId).messages;
  assert.deepEqual(messages.filter(message => message.role === 'user').map(message => [message.text, message.clientMessageId]),
    [['canonical user', 'canonical-client'], ['input-accepted', 'client-accepted']]);
});

test('writes require a current owner subscription, generation token, message identity and expected turn', async t => {
  const f = await fixture(t, true);
  await assert.rejects(f.control.sendMessage(f.input()), /desktop_control_refresh_required/);
  await f.follow();
  for (const extra of [{ controlToken: randomUUID() }, { expectedTurnId: null }, { expectedTurnId: undefined }, { clientMessageId: undefined }, { threadId: 'different-thread' }]) await assert.rejects(f.control.sendMessage(f.input(extra)), { statusCode: 409 });
  assert.equal(f.controls.length, 0);
});

test('a turn change, mismatched mode and pending turn without server identity are not submitted', async t => {
  const f = await fixture(t); await f.follow(); const stale = f.input();
  turns(f).initial.status = 'inProgress'; f.snapshot(); await until(() => f.capability().activeTurnId === 'initial-turn');
  await assert.rejects(f.control.sendMessage(stale), /desktop_turn_changed/);
  await assert.rejects(f.control.sendMessage(f.input({ mode: 'start' })), /desktop_turn_changed/);
  turns(f).initial.turnId = null; f.snapshot(); await until(() => !f.capability().canSend);
  await assert.rejects(f.control.sendMessage(f.input()), { statusCode: 409 });
  assert.equal(f.controls.length, 0);
});

test('per-thread reservation rejects concurrent control; acknowledgement cannot confirm delivery', async t => {
  const f = await fixture(t, true); await f.follow(); f.behavior = 'ack';
  const input = f.input(), first = f.control.sendMessage(input);
  await until(() => f.controls.length === 1);
  await assert.rejects(f.control.sendMessage(f.input()), /desktop_submission_pending/);
  assert.equal((await first).delivery, 'submitted'); assert.equal(f.capability().canSend, false);
  f.accept(f.controls[0]); await until(() => f.capability().canSend);
  assert.equal(f.capability().submission.delivery, 'confirmed');
});

for (const behavior of ['error', 'hold', 'disconnect', 'wrong-owner', 'wrong-method', 'wrong-inner-method', 'wrong-turn', 'malformed']) test(`${behavior} stays uncertain without replay, fallback or sensitive errors`, async t => {
  const f = await fixture(t, true); await f.follow(); f.behavior = behavior;
  const r = await f.control.sendMessage(f.input());
  assert.equal(r.delivery, 'uncertain'); assert.equal(r.ok, false); assert.equal(f.controls.length, 1);
  assert.ok(!JSON.stringify(r).includes('sensitive-upstream-error'));
  assert.equal(f.capability().canSend, false);
});

test('pending and unconfirmed optimistic items do not count as delivery', async t => {
  const f = await fixture(t, true); await f.follow(); f.behavior = 'ack'; const input = f.input();
  assert.equal((await f.control.sendMessage(input)).delivery, 'submitted');
  turns(f).initial.items.push({ type: 'steeringUserMessage', clientUserMessageId: input.clientMessageId, status: 'pending' });
  f.snapshot(); await sleep(10); assert.equal(f.capability().canSend, false);
  turns(f).initial.items[0].status = 'accepted';
  f.state.unconfirmedTurnSubmissions = [{ clientUserMessageId: input.clientMessageId }];
  f.snapshot(); await sleep(10); assert.equal(f.capability().canSend, false);
  f.state.unconfirmedTurnSubmissions = []; f.snapshot(); await until(() => f.capability().canSend);
});

for (const behavior of ['confirm', 'complete', 'ack']) test(`guarded interrupt ${behavior} reflects the authoritative original turn status`, async t => {
  const f = await fixture(t, true); await f.follow(); f.behavior = behavior;
  const input = f.input(); const result = await f.control.interruptThread(threadId, input);
  assert.equal(result.delivery, behavior === 'ack' ? 'submitted' : 'confirmed');
  assert.equal(result.turnStatus, behavior === 'ack' ? undefined : behavior === 'confirm' ? 'interrupted' : 'completed');
  assert.equal(f.controls.length, 1);
});

test('released subscriptions invalidate old control tokens without writing', async t => {
  const f = await fixture(t, true); const release = await f.follow(); const stale = f.input();
  release(); assert.equal(f.capability().token, null);
  await f.follow(); assert.notEqual(f.capability().token, stale.controlToken);
  await assert.rejects(f.control.sendMessage(stale), /desktop_control_refresh_required/);
  assert.equal(f.controls.length, 0);
});

async function httpFixture(t, f) {
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-token', codexHome: f.root, defaultCwd: f.root }, services: {
    store: f.store, desktopControl: f.control, live: { stop() {} }, liveTurns: { stop() {} }, uploads: {}, agentGateway: { stop() {} },
  } });
  t.after(() => app.close());
  return app;
}

test('default native HTTP factory restores its private queue and applies device validity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-queue-factory-'));
  const file = path.join(root, '.mobile-codex', 'desktop-queue.json');
  await fs.mkdir(path.dirname(file));
  const record = (status, owner) => ({ threadId, clientMessageId: randomUUID(), owner, text: 'synthetic pending work', fingerprint: 'a'.repeat(64), createdAt: Date.now(), status });
  await fs.writeFile(file, JSON.stringify([record('waiting', 'admin'), record('waiting', 'revoked-device'), record('sending', 'revoked-device')]));
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-token', codexHome: root, defaultCwd: root, desktopTransport: 'native' }, services: {
    store: { close() {} }, live: { stop() {} }, liveTurns: { stop() {} }, uploads: {}, agentGateway: { stop() {} },
  } });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const restored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(restored.map(entry => entry.status), ['waiting', 'cancelled', 'uncertain']);
  assert.equal(restored[1].text, '');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('authenticated HTTP sends are idempotent and preserve native guards', async t => {
  const f = await fixture(t); await f.follow(); const app = await httpFixture(t, f);
  const input = f.input(); const { threadId: ignored, ...payload } = input;
  const request = { method: 'POST', url: `/api/desktop/control/threads/${threadId}/messages`, payload, headers: { authorization: 'Bearer synthetic-token' } };
  const unauthorized = await app.inject({ ...request, headers: {} }); assert.equal(unauthorized.statusCode, 401);
  const [first, repeat] = await Promise.all([app.inject(request), app.inject(request)]);
  assert.equal(first.statusCode, 200); assert.equal(first.json().submission.state, 'confirmed'); assert.deepEqual(repeat.json(), first.json());
  assert.equal(f.controls.length, 1);
  assert.equal((await app.inject({ ...request, payload: { ...payload, message: 'different' } })).statusCode, 409);
  assert.equal((await app.inject({ ...request, payload: { message: 'missing guards', clientMessageId: randomUUID() } })).statusCode, 409);
});

test('HTTP interrupt binds the original turn, deduplicates and never widens its stop scope', async t => {
  const f = await fixture(t, true); await f.follow(); const app = await httpFixture(t, f);
  const { controlToken, expectedTurnId, clientMessageId } = f.input();
  const request = { method: 'POST', url: `/api/desktop/control/threads/${threadId}/interrupt`, payload: { controlToken, expectedTurnId, clientMessageId }, headers: { authorization: 'Bearer synthetic-token' } };
  const [first, second] = await Promise.all([app.inject(request), app.inject(request)]);
  assert.equal(first.json().delivery, 'confirmed'); assert.deepEqual(first.json(), second.json()); assert.equal(f.controls.length, 1);
  assert.equal(first.json().turnStatus, 'interrupted');
  assert.equal((await app.inject({ ...request, payload: {} })).statusCode, 409);
  assert.equal((await app.inject({ ...request, payload: { ...request.payload, expectedTurnId: 'different-turn' } })).statusCode, 409);
  assert.equal(f.controls.length, 1);
});

test('HTTP uncertainty is retained for retries while later native snapshots can confirm it', async t => {
  const f = await fixture(t, true); await f.follow(); const app = await httpFixture(t, f); f.behavior = 'hold';
  const { threadId: ignored, ...payload } = f.input();
  const request = { method: 'POST', url: `/api/desktop/control/threads/${threadId}/messages`, payload, headers: { authorization: 'Bearer synthetic-token' } };
  const first = await app.inject(request), repeated = await app.inject(request);
  assert.equal(first.json().submission.state, 'unknown'); assert.deepEqual(repeated.json(), first.json()); assert.equal(f.controls.length, 1);
  await assert.rejects(f.control.sendMessage(f.input()), /desktop_submission_pending/);
  f.accept(f.controls[0]); await until(() => f.capability().submission.delivery === 'confirmed');
  assert.equal(f.capability().submission.clientMessageId, payload.clientMessageId);
  assert.equal(f.controls.length, 1);
});

test('native assistant projection retains source identity and phase despite turn timestamp fallback', async t => {
  const f = await fixture(t); await f.follow();
  turns(f).initial.turnStartedAtMs = Date.parse('2026-10-22T18:52:02.622Z');
  turns(f).initial.items = [{ type: 'agentMessage', id: 'msg_fixture_final', phase: 'final_answer', text: '同一条回复' }];
  f.snapshot(); await until(() => f.control.getStreamSnapshot(threadId)?.messages.length === 1);
  const message = f.control.getStreamSnapshot(threadId).messages[0];
  assert.equal(message.sourceItemId, 'msg_fixture_final'); assert.equal(message.phase, 'final_answer');
  assert.equal(message.turnId, turns(f).initial.turnId);
  assert.equal(message.timestamp, '2026-10-22T18:52:02.622Z');
});


test('queue HTTP validates guards, stays separate from steer and survives phone unfollow', async t => {
  const f = await fixture(t, true); const unfollow = await f.follow(); const app = await httpFixture(t, f);
  const { threadId: ignored, ...payload } = f.input({ mode: 'queue' });
  const request = { method: 'POST', url: `/api/desktop/control/threads/${threadId}/messages`, payload, headers: { authorization: 'Bearer synthetic-token' } };
  assert.equal((await app.inject({ ...request, headers: {} })).statusCode, 401);
  assert.equal((await app.inject({ ...request, payload: { ...payload, controlToken: randomUUID() } })).statusCode, 409);
  // A rejected ID is retained by SubmissionRegistry, so the valid attempt gets its own ID.
  payload.clientMessageId = randomUUID();
  const first = await app.inject(request), repeat = await app.inject(request);
  assert.equal(first.json().action, 'queue-message'); assert.equal(first.json().delivery, 'confirmed'); assert.deepEqual(repeat.json(), first.json());
  assert.equal(f.controls.length, 0); assert.equal(f.capability().queue.items.length, 1);
  unfollow(); turns(f).initial.status = 'completed'; f.snapshot();
  await until(() => f.controls.length === 1 && f.control.messageQueue.snapshot(threadId).items.length === 0);
  assert.equal(f.controls[0].method, 'thread-follower-start-turn');
  assert.equal(f.controls[0].params.turnStart.request.clientUserMessageId, payload.clientMessageId);
  assert.equal(f.controls.some(m => m.method === 'thread-follower-steer-turn'), false);
});

test('queue cancel is authenticated, idempotent and never touches the running task', async t => {
  const f = await fixture(t, true); await f.follow(); const app = await httpFixture(t, f);
  const input = f.input({ mode: 'queue' }); await f.control.sendMessage(input);
  const request = { method: 'POST', url: `/api/desktop/control/threads/${threadId}/queue/${input.clientMessageId}/cancel`, payload: {}, headers: { authorization: 'Bearer synthetic-token' } };
  assert.equal((await app.inject({ ...request, headers: {} })).statusCode, 401);
  assert.equal((await app.inject(request)).statusCode, 200); assert.equal((await app.inject(request)).statusCode, 200);
  assert.equal(f.capability().queue.items.length, 0); assert.equal(f.controls.length, 0); assert.equal(turns(f).initial.status, 'inProgress');
});

test('explicit steer delivers to the running turn while existing queued work remains waiting', async t => {
  const f = await fixture(t, true); await f.follow(); const app = await httpFixture(t, f);
  const queued = f.input({ mode: 'queue', message: 'synthetic later task' });
  await f.control.sendMessage(queued);
  const { threadId: ignored, ...payload } = f.input({ mode: 'steer', message: 'synthetic guide for current turn' });
  const request = { method: 'POST', url: `/api/desktop/control/threads/${threadId}/messages`, payload, headers: { authorization: 'Bearer synthetic-token' } };
  const first = await app.inject(request), duplicate = await app.inject(request);
  assert.equal(first.statusCode, 200); assert.deepEqual(duplicate.json(), first.json());
  assert.equal(first.json().action, 'steer-turn'); assert.equal(first.json().delivery, 'confirmed');
  assert.equal(f.controls.length, 1); assert.equal(f.controls[0].method, 'thread-follower-steer-turn');
  assert.deepEqual(f.controls[0].params.input, [{ type: 'text', text: payload.message, text_elements: [] }]);
  assert.equal(f.controls[0].params.clientUserMessageId, payload.clientMessageId);
  assert.deepEqual(f.capability().queue.items.map(item => [item.clientMessageId, item.status]), [[queued.clientMessageId, 'waiting']]);
  assert.equal(turns(f).initial.status, 'inProgress');
});
