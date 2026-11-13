import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once, EventEmitter } from 'node:events';
import { DesktopIpcClient } from '../dist/desktop/desktopIpcClient.js';
import { DesktopControl } from '../dist/desktop/desktopControl.js';
import { desktopQuestionCandidates, validateQuestionAnswers, conversationTurns } from '../dist/desktop/desktopQuestions.js';
import { LiveTurnController } from '../dist/codex/liveTurnController.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const threadId = 'synthetic-thread';
const question = { id: 'q', header: '方案', question: '先优化哪一项？', options: [{ label: '实时连接', description: '改善远程同步' }, { label: '界面', description: '优化布局' }], isOther: true, isSecret: false };
const syncState = () => ({ id: threadId, hostId: 'local', turns: [{ turnId: 'turn', status: 'inProgress', items: [] }], requests: [{ id: 7, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn', questions: [structuredClone(question)] } }] });
const asyncState = () => ({ id: threadId, hostId: 'local', turns: [{ turnId: 'turn', status: 'inProgress', items: [{ type: 'agentMessage', id: 'item-1', text: '请选择', questions: [{ title: '先做什么？', options: ['实时连接', '界面'] }, { title: '补充要求', options: [] }] }] }], requests: [] });
const frame = value => { const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header, body]); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 3000; while (!predicate()) { if (Date.now() > end) assert.fail('synthetic state did not arrive'); await sleep(5); } }

async function fixture(t, state = syncState()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcq-'));
  const pipePath = path.join(root, 'ipc.sock');
  const sockets = new Set(), controls = [], broadcasts = [];
  const f = { state, owner: 'synthetic-desktop', revision: 1, ackOnly: false, error: false, hold: false };
  let connected;
  const emit = change => connected?.write(frame({ type: 'broadcast', sourceClientId: f.owner, method: 'thread-stream-state-changed', version: 11, params: { conversationId: threadId, hostId: 'local', change } }));
  f.snapshot = () => emit({ type: 'snapshot', revision: ++f.revision, conversationState: f.state });
  f.raw = value => connected.write(frame(value));
  f.disconnect = () => connected.destroy();
  f.patch = (patches, baseRevision = f.revision) => emit({ type: 'patches', revision: ++f.revision, baseRevision, patches });
  const server = net.createServer(socket => {
    connected = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const size = buffer.readUInt32LE(0); const m = JSON.parse(buffer.subarray(4, 4 + size)); buffer = buffer.subarray(4 + size);
        if (m.type === 'broadcast') {
          broadcasts.push(m);
          if (m.method === 'thread-stream-following-changed' && m.params.following) f.snapshot();
          continue;
        }
        if (m.type !== 'request') continue;
        const reply = (result, extra = {}) => socket.write(frame({ type: 'response', requestId: m.requestId, method: m.method, resultType: 'success', handledByClientId: f.owner, result, ...extra }));
        if (m.method === 'initialize') reply({ clientId: 'synthetic-phone-bridge' });
        else if (m.method === 'thread-owner-discovery') reply({ supportsUntrustedAppInput: true });
        else {
          controls.push(m);
          if (f.hold) continue;
          if (f.error) { reply(undefined, { resultType: 'error', error: 'sensitive-upstream-detail' }); continue; }
          if (f.beforeReply) f.beforeReply(m);
          reply(m.method === 'thread-follower-submit-user-input' ? { ok: true } : m.method === 'thread-follower-start-turn' ? { result: { turn: { id: 'next-turn' } } } : { result: { turnId: 'turn' } }, f.responseExtra);
          if (f.ackOnly) continue;
          if (m.method === 'thread-follower-submit-user-input') f.state.requests = [];
          else if (m.method === 'thread-follower-steer-turn') f.state.turns[0].items.push({ type: 'steeringUserMessage', id: m.params.clientUserMessageId, clientUserMessageId: m.params.clientUserMessageId, status: 'accepted', input: m.params.input });
          else if (m.method === 'thread-follower-start-turn') f.state.turns.push({ turnId: 'next-turn', status: 'inProgress', params: m.params.turnStart.request, items: [] });
          f.snapshot();
        }
      }
    });
  });
  server.listen(pipePath); await once(server, 'listening');
  const client = new DesktopIpcClient({ clientType: 'synthetic', pipePath, requestTimeoutMs: 100 });
  const store = { getThreadSummary: async () => null, getActiveDesktopThread: async () => null, close() {} };
  const control = new DesktopControl(store, { client, transport: 'native', confirmationMs: 30 });
  t.after(async () => { await control.stop(); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return Object.assign(f, { control, client, controls, broadcasts, root, store, async follow() { const release = control.followThread(threadId); await until(() => control.getStreamSnapshot(threadId)?.interactionsAvailable); return release; }, input() { return control.getStreamSnapshot(threadId).userInputs[0]; } });
}

test('canonical history follows island order and restores asynchronous questions', () => {
  const a = asyncState(); const turn = a.turns[0];
  a.turns = [];
  a.turnHistory = { kind: 'canonical', history: { entitiesByKey: { later: turn, older: { turnId: 'older', status: 'completed', items: [] } }, islands: [{ entries: [{ value: 'older' }, { value: 'later' }] }] } };
  assert.deepEqual(conversationTurns(a).map(t => t.turnId), ['older', 'turn']);
  const c = desktopQuestionCandidates(threadId, a)[0];
  assert.equal(c.kind, 'desktop-async'); assert.equal(c.questions.length, 2);
  assert.equal(c.questions[0].id, '["request_user_input_async","item-1",0]');
  assert.equal(c.questions[1].allowOther, true);
});

test('only accepted asynchronous replies resolve questions, including after normal completion', () => {
  const a = asyncState();
  const reply = { type: 'steeringUserMessage', status: 'pending', input: [{ type: 'text', text: '<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"item-1\\",0]","question":"先做什么？","answer":"实时连接"}]\n</send_user_message_question_reply>' }] };
  a.turns[0].items.push(reply);
  assert.equal(desktopQuestionCandidates(threadId, a)[0].questions.length, 2);
  reply.status = 'accepted'; assert.equal(desktopQuestionCandidates(threadId, a)[0].questions.length, 1);
  a.turns[0].status = 'completed'; assert.equal(desktopQuestionCandidates(threadId, a)[0].questions.length, 1);
});

test('latest completed asynchronous questions keep their binding and canonical order', () => {
  const state = asyncState(), active = desktopQuestionCandidates(threadId, state);
  state.turns[0].status = 'completed';
  assert.deepEqual(desktopQuestionCandidates(threadId, state), active);
  const latest = { turnId: 'newer', status: 'completed', items: [] };
  state.turnHistory = { kind: 'canonical', history: { entitiesByKey: { latest, old: state.turns[0] }, islands: [{ entries: [{ value: 'old' }, { value: 'latest' }] }] } };
  assert.deepEqual(desktopQuestionCandidates(threadId, state), []);
});

for (const status of ['interrupted', 'failed']) test(`${status} turns cannot retain asynchronous questions`, () => {
  const state = asyncState(); state.turns[0].status = status;
  assert.deepEqual(desktopQuestionCandidates(threadId, state), []);
});

test('completed synchronous requests stay inactive', () => {
  const state = syncState(); state.turns[0].status = 'completed';
  assert.deepEqual(desktopQuestionCandidates(threadId, state), []);
});

test('sync decoder preserves options and secrets while rejecting wrong thread/duplicate IDs', () => {
  const state = syncState(); state.requests[0].params.questions[0].isSecret = true;
  assert.equal(desktopQuestionCandidates(threadId, state)[0].questions[0].secret, true);
  assert.deepEqual(desktopQuestionCandidates('wrong-thread', state), []);
  state.requests[0].params.questions.push(question);
  assert.deepEqual(desktopQuestionCandidates(threadId, state), []);
});

test('answers enforce all question IDs and custom-input permission', () => {
  const request = { questions: [{ ...question, allowOther: false }] };
  assert.deepEqual(validateQuestionAnswers(request, { q: ['实时连接'] }), { q: ['实时连接'] });
  for (const answers of [{}, { q: ['unlisted'] }, { q: ['实时连接'], other: ['x'] }, { q: ['实时连接', '界面'] }]) assert.throws(() => validateQuestionAnswers(request, answers), { statusCode: 400 });
});

test('native subscription is selected, shared and released with its final SSE consumer', async t => {
  const f = await fixture(t); const a = await f.follow(), b = await f.follow();
  assert.equal(f.broadcasts.filter(m => m.params.following).length, 1);
  assert.deepEqual(f.broadcasts[0].targetClientIds, [f.owner]);
  assert.equal(f.input().questions[0].options[0].description, '改善远程同步');
  a(); assert.equal(f.control.getStreamSnapshot(threadId).interactionsAvailable, true);
  b(); await until(() => f.broadcasts.some(m => m.params.following === false));
  assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
});

test('sync reply targets its owner and original request; canonical removal confirms success', async t => {
  const f = await fixture(t); await f.follow(); const input = f.input();
  assert.deepEqual(await f.control.respondUserInput(threadId, input.id, { q: ['其他要求'] }), { status: 'resolved' });
  assert.equal(f.controls.length, 1);
  assert.equal(f.controls[0].targetClientId, f.owner); assert.equal(f.controls[0].params.requestId, 7);
  assert.deepEqual(f.controls[0].params.response, { answers: { q: { answers: ['其他要求'] } } });
  assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
  await assert.rejects(f.control.respondUserInput(threadId, input.id, { q: ['repeat'] }), { statusCode: 409 });
});

test('async reply uses its original question IDs and steer only, never starts a substitute turn', async t => {
  const f = await fixture(t, asyncState()); await f.follow(); const input = f.input();
  const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
  assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'resolved' });
  assert.equal(f.controls.length, 1); const m = f.controls[0];
  assert.equal(m.method, 'thread-follower-steer-turn'); assert.equal(m.params.conversationId, threadId);
  assert.deepEqual(m.params.restoreMessage, { cwd: null, context: { workspaceRoots: [], collaborationMode: null, commentAttachments: [] }, responsesapiClientMetadata: null });
  const replies = JSON.parse(m.params.input[0].text.split('\n')[1]);
  assert.equal(replies[0].questionItemId, input.questions[0].id);
  assert.equal(replies[0].question, '先做什么？');
});

test('completed async question replies start once in the same conversation with original question IDs', async t => {
  const state = asyncState(); state.turns[0].status = 'completed'; state.cwd = '/synthetic/project';
  const f = await fixture(t, state); await f.follow(); const input = f.input();
  assert.ok(input, 'unanswered card survives the end of assistant output');
  const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
  assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'resolved' });
  assert.equal(f.controls.length, 1);
  const m = f.controls[0];
  assert.equal(m.method, 'thread-follower-start-turn'); assert.equal(m.version, 2);
  assert.equal(m.params.conversationId, threadId); assert.equal(m.params.turnStart.request.threadId, threadId);
  assert.equal(m.params.turnStart.context.inheritThreadSettings, true);
  assert.equal(m.params.turnStart.context.restoreMessage.cwd, state.cwd);
  assert.deepEqual(JSON.parse(m.params.turnStart.request.input[0].text.split('\n')[1]).map(q => q.questionItemId), input.questions.map(q => q.id));
  assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
  await assert.rejects(f.control.respondUserInput(threadId, input.id, answers), { statusCode: 409 });
  assert.equal(f.control.getStreamSnapshot(threadId).control.canSend, true);
});

test('unconfirmed async answer stays locked through completion and resubscription', async t => {
  const f = await fixture(t, asyncState()); f.ackOnly = true; const release = await f.follow(); const input = f.input();
  const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
  assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'submitted' });
  f.state.turns[0].status = 'completed'; f.snapshot();
  await until(() => f.control.getStreamSnapshot(threadId).status === 'completed');
  assert.equal(f.input()?.id, input.id); assert.equal(f.input().status, 'submitted');
  release(); await f.follow(); assert.equal(f.input().status, 'uncertain');
  await assert.rejects(f.control.respondUserInput(threadId, f.input().id, answers), { statusCode: 409 });
  assert.equal(f.controls.length, 1);
});

test('a newer user turn expires the completed card without resurrecting older questions', async t => {
  const state = asyncState(); state.turns[0].status = 'completed';
  const f = await fixture(t, state); await f.follow(); const input = f.input(); assert.ok(input);
  f.state.turns.push({ turnId: 'new-user-turn', status: 'inProgress', items: [] }); f.snapshot();
  await until(() => !f.input());
  await assert.rejects(f.control.respondUserInput(threadId, input.id, {}), { statusCode: 409 });
  assert.equal(f.controls.length, 0);
});

for (const firstAction of ['question', 'message']) test(`async answer and ordinary send share the pending lock when ${firstAction} goes first`, async t => {
  const f = await fixture(t, asyncState()); f.ackOnly = true; await f.follow(); const input = f.input();
  const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
  const capability = f.control.getStreamSnapshot(threadId).control;
  const message = { threadId, message: '普通消息', clientMessageId: 'synthetic-client-message', controlToken: capability.token, expectedTurnId: capability.activeTurnId };
  if (firstAction === 'question') {
    const first = f.control.respondUserInput(threadId, input.id, answers);
    await assert.rejects(f.control.sendMessage(message), /desktop_submission_pending/);
    await first;
  } else {
    const first = f.control.sendMessage(message);
    await until(() => f.controls.length === 1);
    await assert.rejects(f.control.respondUserInput(threadId, input.id, answers), /desktop_submission_pending/);
    assert.equal(f.input().status, 'pending'); await first;
  }
  assert.equal(f.controls.length, 1);
});

for (const behavior of ['wrong-method', 'wrong-owner', 'wrong-inner-method', 'malformed', 'negative', 'empty-turn']) test(`completed async question ${behavior} acknowledgement stays uncertain without a fallback`, async t => {
  const state = asyncState(); state.turns[0].status = 'completed';
  const f = await fixture(t, state); f.ackOnly = true;
  f.responseExtra = behavior === 'wrong-method' ? { method: 'another-method' }
    : behavior === 'wrong-owner' ? { handledByClientId: 'another-owner' }
    : behavior === 'wrong-inner-method' ? { result: { method: 'another-method', result: { turn: { id: 'next-turn' } } } }
    : behavior === 'empty-turn' ? { result: { turn: { id: '' } } }
    : { result: behavior === 'negative' ? { ok: false } : {} };
  await f.follow(); const input = f.input(); assert.ok(input);
  const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
  assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'uncertain' });
  assert.equal(f.input().status, 'uncertain');
  await assert.rejects(f.control.respondUserInput(threadId, input.id, answers), { statusCode: 409 });
  assert.equal(f.controls.length, 1);
});

test('acknowledgement alone stays submitted and simultaneous answers send once', async t => {
  const f = await fixture(t); f.ackOnly = true; await f.follow(); const input = f.input();
  const first = f.control.respondUserInput(threadId, input.id, { q: ['实时连接'] });
  await assert.rejects(f.control.respondUserInput(threadId, input.id, { q: ['界面'] }), { statusCode: 409 });
  assert.deepEqual(await first, { status: 'submitted' }); assert.equal(f.controls.length, 1);
  f.snapshot(); await sleep(10); assert.equal(f.input().status, 'submitted');
});

for (const kind of ['sync', 'async']) {
  for (const behavior of ['wrong-method', 'wrong-owner', 'wrong-inner-method', 'malformed', 'negative', ...(kind === 'async' ? ['wrong-turn'] : [])]) {
    test(`${kind} question ${behavior} response remains uncertain and is never replayed`, async t => {
      const f = await fixture(t, kind === 'sync' ? syncState() : asyncState());
      f.ackOnly = true;
      const method = kind === 'sync' ? 'thread-follower-submit-user-input' : 'thread-follower-steer-turn';
      f.responseExtra = behavior === 'wrong-method' ? { method: 'another-method' }
        : behavior === 'wrong-owner' ? { handledByClientId: 'another-owner' }
        : behavior === 'wrong-inner-method' ? { result: { method: 'another-method', result: kind === 'sync' ? { ok: true } : { turnId: 'turn' } } }
        : behavior === 'malformed' ? { result: {} }
        : behavior === 'negative' ? { result: { method, result: { ok: false } } }
        : { result: { result: { turnId: 'another-turn' } } };
      await f.follow(); const input = f.input();
      const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
      assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'uncertain' });
      assert.equal(f.input().status, 'uncertain');
      await assert.rejects(f.control.respondUserInput(threadId, input.id, answers), { statusCode: 409 });
      assert.equal(f.controls.length, 1);
      f.snapshot(); await sleep(10);
      assert.equal(f.input().status, 'uncertain');
    });
  }

  for (const format of ['flat', 'wrapped']) test(`${kind} question accepts a matching ${format} acknowledgement without resolving the original request`, async t => {
    const f = await fixture(t, kind === 'sync' ? syncState() : asyncState());
    f.ackOnly = true;
    const method = kind === 'sync' ? 'thread-follower-submit-user-input' : 'thread-follower-steer-turn';
    if (format === 'wrapped') f.responseExtra = { result: { method, result: kind === 'sync' ? { ok: true } : { turnId: 'turn' } } };
    await f.follow(); const input = f.input();
    const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
    assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'submitted' });
    assert.equal(f.input().status, 'submitted'); assert.equal(f.controls.length, 1);
  });

  test(`${kind} question authoritative removal wins over a later invalid acknowledgement`, async t => {
    const f = await fixture(t, kind === 'sync' ? syncState() : asyncState());
    f.ackOnly = true; f.responseExtra = { method: 'another-method', result: {} };
    f.beforeReply = m => {
      if (kind === 'sync') f.state.requests = [];
      else f.state.turns[0].items.push({ type: 'steeringUserMessage', status: 'accepted', input: m.params.input });
      f.snapshot();
    };
    await f.follow(); const input = f.input();
    const answers = Object.fromEntries(input.questions.map(q => [q.id, ['来自手机的回答']]));
    assert.deepEqual(await f.control.respondUserInput(threadId, input.id, answers), { status: 'resolved' });
    assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
    assert.equal(f.controls.length, 1);
  });
}

for (const kind of ['error', 'hold']) test(`native ${kind} leaves an uncertain result without replay or raw errors`, async t => {
  const f = await fixture(t); f[kind] = true; await f.follow(); const input = f.input();
  const result = await f.control.respondUserInput(threadId, input.id, { q: ['实时连接'] });
  assert.deepEqual(result, { status: 'uncertain' }); assert.equal(f.input().status, 'uncertain');
  assert.ok(!JSON.stringify(f.control.getStreamSnapshot(threadId)).includes('sensitive-upstream-detail'));
  await assert.rejects(f.control.respondUserInput(threadId, input.id, { q: ['实时连接'] }), { statusCode: 409 });
  assert.equal(f.controls.length, 1);
});

test('wrong owner, remote host and obsolete stream version cannot introduce or resolve a question', async t => {
  const f = await fixture(t); await f.follow(); const old = f.input();
  const broadcast = { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'another-desktop', params: { conversationId: threadId, hostId: 'local', change: { type: 'snapshot', revision: 100, conversationState: { ...f.state, requests: [] } } } };
  f.raw(broadcast); f.raw({ ...broadcast, sourceClientId: f.owner, version: 1 }); f.raw({ ...broadcast, sourceClientId: f.owner, params: { ...broadcast.params, hostId: 'remote' } });
  await sleep(10); assert.equal(f.input().id, old.id);
  await assert.rejects(f.control.respondUserInput('another-thread', old.id, { q: ['实时连接'] }), { statusCode: 409 });
  assert.equal(f.controls.length, 0);
});

test('revision gaps expire old forms and require a fresh authoritative snapshot', async t => {
  const f = await fixture(t); await f.follow(); const old = f.input();
  f.patch([{ op: 'replace', path: ['requests'], value: [] }], -1);
  await until(() => f.input()?.id !== old.id);
  await until(() => f.input());
  await assert.rejects(f.control.respondUserInput(threadId, old.id, { q: ['实时连接'] }), { statusCode: 409 });
  assert.equal(f.controls.length, 0);
});

test('desktop resolves and interrupts pending requests through patches', async t => {
  const f = await fixture(t); await f.follow(); const old = f.input();
  f.patch([{ op: 'replace', path: ['requests'], value: [] }]);
  await until(() => !f.control.getStreamSnapshot(threadId).userInputs.length);
  await assert.rejects(f.control.respondUserInput(threadId, old.id, { q: ['实时连接'] }), { statusCode: 409 });
  f.state = asyncState(); f.snapshot(); await until(() => f.input());
  f.patch([{ op: 'replace', path: ['turns', 0, 'status'], value: 'interrupted' }]);
  await until(() => f.control.getStreamSnapshot(threadId).status === 'interrupted');
  assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
});

test('IPC loss clears actionable cards and late responses never resurrect them', async t => {
  const f = await fixture(t); f.hold = true; await f.follow(); const input = f.input();
  const result = f.control.respondUserInput(threadId, input.id, { q: ['实时连接'] });
  await until(() => f.controls.length === 1); f.disconnect();
  assert.deepEqual(await result, { status: 'uncertain' });
  assert.equal(f.control.getStreamSnapshot(threadId).interactionsAvailable, false);
  assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
});

for (const kind of ['ipc-loss', 'resubscribe', 'revision-gap']) test(`unconfirmed question stays locked after ${kind}`, async t => {
  const f = await fixture(t); f.ackOnly = true;
  const release = await f.follow(); const original = f.input();
  assert.deepEqual(await f.control.respondUserInput(threadId, original.id, { q: ['实时连接'] }), { status: 'submitted' });
  if (kind === 'ipc-loss') f.disconnect();
  else if (kind === 'revision-gap') f.patch([], -1);
  else { release(); await f.follow(); }
  await until(() => f.input() && f.input().id !== original.id);
  const refreshed = f.input();
  assert.equal(refreshed.status, 'uncertain');
  await assert.rejects(f.control.respondUserInput(threadId, refreshed.id, { q: ['界面'] }), { statusCode: 409 });
  assert.equal(f.controls.length, 1);
  f.state.requests = []; f.snapshot();
  await until(() => !f.input());
  f.state = syncState(); f.snapshot();
  await until(() => f.input());
  assert.equal(f.input().status, 'pending');
});

test('changed question gets a new binding while the uncertain original stays unanswerable', async t => {
  const f = await fixture(t); f.error = true; const release = await f.follow(); const original = f.input();
  assert.deepEqual(await f.control.respondUserInput(threadId, original.id, { q: ['实时连接'] }), { status: 'uncertain' });
  release(); await f.follow();
  assert.equal(f.input().status, 'uncertain');
  f.state.requests[0].params.questions[0].question = '现在优先优化哪一项？'; f.snapshot();
  await until(() => f.input()?.questions[0].question === '现在优先优化哪一项？');
  assert.equal(f.input().status, 'pending');
  await assert.rejects(f.control.respondUserInput(threadId, original.id, { q: ['界面'] }), { statusCode: 409 });
  f.error = false;
  assert.deepEqual(await f.control.respondUserInput(threadId, f.input().id, { q: ['界面'] }), { status: 'resolved' });
  assert.equal(f.controls.length, 2);
});

test('async questions stay locked across resubscription until canonical acceptance', async t => {
  const f = await fixture(t, asyncState()); f.error = true;
  const release = await f.follow(); const original = f.input();
  const answers = Object.fromEntries(original.questions.map(q => [q.id, ['来自手机的回答']]));
  assert.deepEqual(await f.control.respondUserInput(threadId, original.id, answers), { status: 'uncertain' });
  release(); await f.follow();
  assert.equal(f.input().status, 'uncertain');
  await assert.rejects(f.control.respondUserInput(threadId, f.input().id, answers), { statusCode: 409 });
  f.state.turns[0].items.push({ type: 'steeringUserMessage', id: 'accepted-answer', status: 'accepted', input: f.controls[0].params.input });
  f.snapshot(); await until(() => !f.input());
  assert.equal(f.controls.length, 1);
});

test('unconfirmed question limit refuses new writes without evicting unresolved records', async t => {
  const state = syncState(), request = state.requests[0];
  state.requests = Array.from({ length: 129 }, (_, id) => ({ ...structuredClone(request), id }));
  const f = await fixture(t, state); f.ackOnly = true; await f.follow();
  const inputs = f.control.getStreamSnapshot(threadId).userInputs;
  await Promise.all(inputs.slice(0, 128).map(input => f.control.respondUserInput(threadId, input.id, { q: ['实时连接'] })));
  assert.equal(f.controls.length, 128);
  await assert.rejects(f.control.respondUserInput(threadId, inputs[128].id, { q: ['界面'] }), { statusCode: 429 });
  assert.equal(f.controls.length, 128);
  f.state.requests = [f.state.requests[128]]; f.snapshot();
  await until(() => f.control.getStreamSnapshot(threadId).userInputs.length === 1);
  assert.deepEqual(await f.control.respondUserInput(threadId, inputs[128].id, { q: ['界面'] }), { status: 'submitted' });
  assert.equal(f.controls.length, 129);
});

class SyntheticAppServer extends EventEmitter {
  connected = false; responses = [];
  async start() { this.connected = true; }
  isConnected() { return this.connected; }
  async stop() { this.connected = false; }
  async request(method) { if (method === 'turn/start') return { turn: { id: 'turn', status: 'inProgress' } }; return {}; }
  respond(id, result) { this.responses.push({ id, result }); }
}
async function live(t) {
  const client = new SyntheticAppServer(), controller = new LiveTurnController('/synthetic', () => client);
  t.after(() => controller.stop());
  await controller.startTurn({ threadId, message: 'synthetic task' });
  client.emit('notification', { id: 42, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn', questions: [question] } });
  return { client, controller, input: controller.getTurn('turn').userInputs[0] };
}

test('Relay-owned questions have their own model and wait for serverRequest/resolved', async t => {
  const f = await live(t); assert.equal(f.controller.getTurn('turn').approvals.length, 0);
  const result = f.controller.respondUserInput({ threadId, turnId: 'turn', inputId: f.input.id, answers: { q: ['实时连接'] } });
  assert.equal(result.userInputs[0].status, 'submitted'); assert.equal(f.client.responses[0].id, 42);
  assert.throws(() => f.controller.respondUserInput({ threadId, turnId: 'turn', inputId: f.input.id, answers: { q: ['重复'] } }), { statusCode: 409 });
  f.client.emit('notification', { method: 'serverRequest/resolved', params: { threadId, requestId: 42 } });
  assert.equal(f.controller.getTurn('turn').userInputs.length, 0);
});

for (const method of ['turn/completed', 'disconnect']) test(`Relay ${method} invalidates user input without reinitializing for a response`, async t => {
  const f = await live(t);
  if (method === 'disconnect') { f.client.connected = false; f.client.emit('disconnect'); }
  else f.client.emit('notification', { method, params: { threadId, turn: { id: 'turn', status: 'completed' } } });
  assert.equal(f.controller.getTurn('turn').userInputs.length, 0);
  assert.throws(() => f.controller.respondUserInput({ threadId, turnId: 'turn', inputId: f.input.id, answers: { q: ['实时连接'] } }), { statusCode: 409 });
  assert.equal(f.client.responses.length, 0);
});

test('authenticated HTTP + native socket flow answers an original request and rejects stale replay', async t => {
  const f = await fixture(t);
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: f.root, defaultCwd: f.root }, services: { store: f.store, desktopControl: f.control, liveTurns: { stop: async () => {} } } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  await f.follow(); const input = f.input();
  const url = `/api/desktop/threads/${threadId}/user-inputs/${input.id}/respond`;
  assert.equal((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{invalid' })).statusCode, 401);
  const auth = { authorization: 'Bearer synthetic-admin' };
  assert.equal((await app.inject({ method: 'POST', url, headers: auth, payload: { answers: {} } })).statusCode, 400);
  const result = await app.inject({ method: 'POST', url, headers: auth, payload: { answers: { q: ['实时连接'] } } });
  assert.equal(result.statusCode, 200); assert.equal(result.json().status, 'resolved');
  assert.equal((await app.inject({ method: 'POST', url, headers: auth, payload: { answers: { q: ['实时连接'] } } })).statusCode, 409);
  assert.equal(f.controls.length, 1);
});

test('malformed patches cannot leave an old form actionable', async t => {
  const f = await fixture(t); await f.follow(); const old = f.input();
  f.patch([{ op: 'replace', path: ['turns', 9, 'status'], value: 'completed' }]);
  await until(() => f.input()?.id !== old.id); await until(() => f.input());
  await assert.rejects(f.control.respondUserInput(threadId, old.id, { q: ['实时连接'] }), { statusCode: 409 });
  assert.equal(f.controls.length, 0);
});

for (const status of ['inProgress', 'completed']) test(`real HTTP SSE carries ${status} questions and releases its native subscription`, async t => {
  const state = asyncState(); state.turns[0].status = status;
  const f = await fixture(t, state);
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: f.root, defaultCwd: f.root }, services: { store: f.store, desktopControl: f.control, liveTurns: { stop: async () => {} } } });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); app.server.closeAllConnections(); await app.close(); });
  const auth = { authorization: 'Bearer synthetic-admin' };
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code, name: 'synthetic phone' } })).json();
  const headers = { authorization: `Bearer ${device.token}` };
  const streamToken = (await app.inject({ method: 'POST', url: `/api/desktop/threads/${threadId}/stream-token`, headers })).json().streamToken;
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${base}/api/desktop/threads/${threadId}/events?streamToken=${streamToken}&v=1`, { signal: abort.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  async function nextSnapshot() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (event.startsWith('event: desktop')) return JSON.parse(event.split('\ndata: ')[1]);
      } else { const chunk = await reader.read(); assert.equal(chunk.done, false); buffer += decoder.decode(chunk.value, { stream: true }); }
    }
  }
  const snapshot = await nextSnapshot(); assert.equal(snapshot.interactionsAvailable, true); assert.equal(snapshot.userInputs[0].questions.length, 2);
  const input = snapshot.userInputs[0]; const answers = Object.fromEntries(input.questions.map(q => [q.id, ['通过手机选择']]));
  const answer = await app.inject({ method: 'POST', url: `/api/desktop/threads/${threadId}/user-inputs/${input.id}/respond`, headers, payload: { answers } });
  assert.equal(answer.json().status, 'resolved');
  let updated;
  do { updated = await nextSnapshot(); } while (updated.userInputs.length);
  assert.equal(updated.partial, true); assert.equal(f.controls.length, 1);
  assert.equal(f.controls[0].method, status === 'completed' ? 'thread-follower-start-turn' : 'thread-follower-steer-turn');
  await reader.cancel(); abort.abort();
  await until(() => f.broadcasts.some(m => m.params.following === false));
  assert.deepEqual(f.control.getStreamSnapshot(threadId).userInputs, []);
});

test('expired Relay turns and wrong-thread answers fail before sending any response', async t => {
  const f = await live(t);
  for (const params of [{ threadId: 'other-thread', turnId: 'turn' }, { threadId, turnId: 'expired-turn' }]) {
    assert.throws(() => f.controller.respondUserInput({ ...params, inputId: f.input.id, answers: { q: ['实时连接'] } }), { statusCode: 409 });
  }
  assert.equal(f.client.responses.length, 0);
});
