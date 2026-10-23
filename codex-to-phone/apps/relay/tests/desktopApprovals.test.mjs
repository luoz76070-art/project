import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { DesktopIpcClient } from '../dist/desktop/desktopIpcClient.js';
import { DesktopControl } from '../dist/desktop/desktopControl.js';
import { desktopApprovalCandidates } from '../dist/desktop/desktopApprovals.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const threadId = 'synthetic-approval-thread';
const methods = {
  command: ['item/commandExecution/requestApproval', 'thread-follower-command-approval-decision'],
  fileChange: ['item/fileChange/requestApproval', 'thread-follower-file-approval-decision'],
  permissions: ['item/permissions/requestApproval', 'thread-follower-permissions-request-approval-response'],
};
const profile = { network: { enabled: true }, fileSystem: { read: ['/synthetic/read'], write: ['/synthetic/write'], globScanMaxDepth: 2, entries: [{ path: { type: 'glob_pattern', pattern: '/synthetic/*.log' }, access: 'read' }] } };
const initial = (kind = 'command') => ({ id: threadId, hostId: 'local', cwd: '/synthetic/project',
  turnHistory: { kind: 'canonical', history: { entitiesByKey: { t: { turnId: 'turn', status: 'inProgress', items: [{ id: 'item', type: 'fileChange', changes: [{ path: '/synthetic/project/a.txt', kind: { type: 'update', move_path: null }, diff: '-before\n+after' }] }] } }, islands: [{ entries: [{ value: 't' }] }] } },
  requests: [{ id: kind === 'fileChange' ? 'opaque-request' : 13, method: methods[kind][0], params: {
    threadId, turnId: 'turn', itemId: 'item', reason: 'synthetic-only',
    ...(kind === 'command' ? { approvalId: 'callback-id', command: 'echo synthetic-only', cwd: '/synthetic/project', availableDecisions: ['accept', 'decline', 'cancel'] }
      : kind === 'fileChange' ? { grantRoot: '/synthetic/project' } : { cwd: '/synthetic/project', permissions: structuredClone(profile) }),
  } }],
});
const turn = f => f.state.turnHistory.history.entitiesByKey.t;
const frame = value => { const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header, body]); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 2000; while (!predicate()) { if (Date.now() > end) assert.fail('synthetic approval timed out'); await sleep(5); } }

async function fixture(t, kind = 'command') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mca-')), sockets = new Set(), controls = [];
  let connected;
  const f = { root, state: initial(kind), owner: 'synthetic-approval-owner', revision: 0, behavior: 'resolve' };
  f.raw = value => connected.write(frame(value));
  f.snapshot = () => f.raw({ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: f.owner, version: 11, params: { conversationId: threadId, hostId: 'local', change: { type: 'snapshot', revision: ++f.revision, conversationState: f.state } } });
  f.patch = (patches, baseRevision = f.revision) => f.raw({ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: f.owner, version: 11, params: { conversationId: threadId, hostId: 'local', change: { type: 'patches', revision: ++f.revision, baseRevision, patches } } });
  f.disconnect = () => connected.destroy();
  const server = net.createServer(socket => {
    connected = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const size = buffer.readUInt32LE(0), message = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
        if (message.type === 'broadcast') { if (message.params.following) f.snapshot(); continue; }
        if (message.type !== 'request') continue;
        const reply = (result, extra = {}) => socket.write(frame({ type: 'response', method: message.method, requestId: message.requestId, handledByClientId: f.owner, resultType: 'success', result, ...extra }));
        if (message.method === 'initialize') { reply({ clientId: 'synthetic-relay' }); continue; }
        if (message.method === 'thread-owner-discovery') { reply({}); continue; }
        controls.push(message);
        assert.equal(message.method, methods[kind][1]); assert.equal(message.version, 1);
        assert.equal(message.targetClientId, f.owner); assert.equal(message.params.conversationId, threadId);
        assert.equal(message.params.requestId, f.state.requests[0].id);
        if (f.behavior === 'hold') continue;
        if (f.behavior === 'disconnect') { socket.destroy(); continue; }
        reply({ method: message.method, result: { ok: true } }, f.behavior === 'error' ? { resultType: 'error', error: 'sensitive-upstream-error' }
          : f.behavior === 'wrong-owner' ? { handledByClientId: 'other-owner' }
          : f.behavior === 'wrong-method' ? { method: 'other-method' }
          : f.behavior === 'malformed' ? { result: {} }
          : f.behavior === 'wrong-inner-method' ? { result: { method: 'other-method', result: { ok: true } } }
          : f.behavior === 'flat-ack' ? { result: { ok: true } } : {});
        if (f.behavior !== 'resolve') continue;
        f.state.requests = []; f.snapshot();
      }
    });
  });
  const pipePath = path.join(root, 'ipc.sock'); server.listen(pipePath); await once(server, 'listening');
  const client = new DesktopIpcClient({ clientType: 'synthetic-approvals', pipePath, requestTimeoutMs: 70 });
  const store = { close() {}, getThreadSummary: async () => null, getActiveDesktopThread: async () => null };
  const control = new DesktopControl(store, { client, confirmationMs: 25 });
  t.after(async () => { await control.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return Object.assign(f, { control, controls, store,
    snapshotView: () => control.getStreamSnapshot(threadId),
    approval: () => control.getStreamSnapshot(threadId)?.approvals?.[0],
    follow: async () => { const release = control.followThread(threadId); await until(() => f.approval()); return release; },
  });
}

test('decoder binds canonical active task and includes command, reason, directory and exact permissions', () => {
  const state = initial(); state.requests[0].params.additionalPermissions = profile;
  const c = desktopApprovalCandidates(threadId, state)[0];
  assert.equal(c.command, 'echo synthetic-only'); assert.equal(c.cwd, '/synthetic/project'); assert.equal(c.reason, 'synthetic-only');
  assert.match(c.preview, /\/synthetic\/write/); assert.equal(c.requestId, 13);
  assert.deepEqual(desktopApprovalCandidates('other-thread', state), []);
  state.requests[0].params.turnId = 'other-turn'; assert.deepEqual(desktopApprovalCandidates(threadId, state), []);
});

test('explicit empty and complex-only decisions never produce generic approval buttons', () => {
  for (const availableDecisions of [[], [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: ['echo'] } }], 'invalid']) {
    const state = initial(); state.requests[0].params.availableDecisions = availableDecisions;
    const c = desktopApprovalCandidates(threadId, state)[0]; assert.deepEqual(c.availableDecisions, []); assert.ok(c.unavailableReason);
  }
  const state = initial(); state.requests[0].params.availableDecisions = [{ applyNetworkPolicyAmendment: {} }, 'decline'];
  assert.deepEqual(desktopApprovalCandidates(threadId, state)[0].availableDecisions, ['decline']);
});

test('missing command, missing file diff, unknown fields and unknown permission profiles disable positive decisions', () => {
  const cases = [initial(), initial('fileChange'), initial('permissions'), initial('permissions')];
  delete cases[0].requests[0].params.command;
  cases[1].turnHistory.history.entitiesByKey.t.items = [];
  cases[2].requests[0].params.permissions.network.extraAccess = true;
  cases[3].requests[0].params.newGrant = '/unreviewed';
  for (const state of cases) {
    const c = desktopApprovalCandidates(threadId, state)[0];
    assert.deepEqual(c.availableDecisions, ['decline', 'cancel']); assert.ok(c.unavailableReason);
  }
});

test('file change preview contains paths, diff and session root; duplicate raw identities are not actionable', () => {
  const state = initial('fileChange'), c = desktopApprovalCandidates(threadId, state)[0];
  assert.match(c.preview, /a\.txt\n-before\n\+after/); assert.match(c.detail, /会话写入范围/);
  state.requests.push(structuredClone(state.requests[0])); assert.deepEqual(desktopApprovalCandidates(threadId, state), []);
});

for (const kind of ['command', 'fileChange', 'permissions']) test(`${kind} response targets the original owner and opaque request, then waits for removal`, async t => {
  const f = await fixture(t, kind); await f.follow(); const a = f.approval();
  assert.equal(a.source, 'desktop'); assert.equal(a.requestId, undefined);
  assert.deepEqual(await f.control.respondApproval(threadId, a.id, 'accept'), { status: 'resolved' });
  assert.equal(f.controls.length, 1); assert.deepEqual(f.snapshotView().approvals, []);
  const params = f.controls[0].params;
  if (kind === 'permissions') assert.deepEqual(params.response, { permissions: profile, scope: 'turn', strictAutoReview: false });
  else assert.equal(params.decision, 'accept');
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'accept'), { statusCode: 409 });
});

for (const decision of ['acceptForSession', 'decline', 'cancel']) test(`permissions ${decision} grants only the original profile at its explicit scope`, async t => {
  const f = await fixture(t, 'permissions'); await f.follow();
  await f.control.respondApproval(threadId, f.approval().id, decision);
  assert.deepEqual(f.controls[0].params.response, { permissions: decision === 'acceptForSession' ? profile : {}, scope: decision === 'acceptForSession' ? 'session' : 'turn', strictAutoReview: decision !== 'acceptForSession' });
});

test('ACK and duplicate submissions stay locked; a later authoritative patch resolves the card', async t => {
  const f = await fixture(t); f.behavior = 'ack'; await f.follow(); const a = f.approval();
  const result = f.control.respondApproval(threadId, a.id, 'accept');
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'decline'), /approval_already_submitted/);
  assert.deepEqual(await result, { status: 'submitted' }); assert.equal(f.approval().status, 'submitted');
  f.snapshot(); await sleep(10); assert.equal(f.approval().status, 'submitted'); assert.equal(f.controls.length, 1);
  f.patch([{ op: 'replace', path: ['requests'], value: [] }]); await until(() => !f.approval());
});

for (const behavior of ['error', 'hold', 'disconnect', 'wrong-owner', 'wrong-method', 'wrong-inner-method', 'malformed']) test(`${behavior} cannot claim approval success or replay the response`, async t => {
  const f = await fixture(t); f.behavior = behavior; await f.follow(); const a = f.approval();
  assert.deepEqual(await f.control.respondApproval(threadId, a.id, 'accept'), { status: 'uncertain' });
  assert.equal(f.controls.length, 1); assert.ok(!JSON.stringify(f.snapshotView()).includes('sensitive-upstream-error'));
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'accept'), { statusCode: 409 });
});

test('legacy flat acknowledgements stay submitted until an authoritative state resolves the request', async t => {
  const f = await fixture(t); f.behavior = 'flat-ack'; await f.follow();
  assert.deepEqual(await f.control.respondApproval(threadId, f.approval().id, 'accept'), { status: 'submitted' });
  assert.equal(f.approval().status, 'submitted'); assert.equal(f.controls.length, 1);
});

test('changed raw request content and file preview both invalidate old tokens', async t => {
  const f = await fixture(t, 'fileChange'); await f.follow(); let a = f.approval();
  f.state.requests[0].params.reason = 'changed reason'; f.snapshot(); await until(() => f.approval().id !== a.id);
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'accept'), /approval_expired/);
  a = f.approval(); turn(f).items[0].changes[0].diff = '+changed diff'; f.snapshot(); await until(() => f.approval().id !== a.id);
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'accept'), /approval_expired/); assert.equal(f.controls.length, 0);
});

test('released subscription invalidates tokens and fresh snapshot keeps uncertain same-request locked', async t => {
  const f = await fixture(t); f.behavior = 'ack'; const release = await f.follow(); const a = f.approval();
  await f.control.respondApproval(threadId, a.id, 'accept'); release();
  assert.deepEqual(f.snapshotView().approvals, []); await f.follow();
  assert.notEqual(f.approval().id, a.id); assert.equal(f.approval().status, 'uncertain');
  await assert.rejects(f.control.respondApproval(threadId, f.approval().id, 'accept'), /approval_already_submitted/); assert.equal(f.controls.length, 1);
});

test('wrong host, version or owner cannot introduce or remove approval; turn completion expires it', async t => {
  const f = await fixture(t); await f.follow(); const a = f.approval();
  const m = { type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: 'other', version: 11, params: { conversationId: threadId, hostId: 'local', change: { type: 'snapshot', revision: 1000, conversationState: { ...f.state, requests: [] } } } };
  f.raw(m); f.raw({ ...m, sourceClientId: f.owner, version: 1 }); f.raw({ ...m, sourceClientId: f.owner, params: { ...m.params, hostId: 'remote' } });
  await sleep(10); assert.equal(f.approval().id, a.id);
  await assert.rejects(f.control.respondApproval('another-thread', a.id, 'accept'), /approval_expired/);
  turn(f).status = 'completed'; f.snapshot(); await until(() => !f.approval());
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'accept'), /approval_expired/); assert.equal(f.controls.length, 0);
});

test('revision gaps invalidate old approval tokens before following again', async t => {
  const f = await fixture(t); await f.follow(); const a = f.approval();
  f.patch([], -1); await until(() => f.approval()?.id !== a.id); await until(() => f.approval());
  await assert.rejects(f.control.respondApproval(threadId, a.id, 'accept'), /approval_expired/); assert.equal(f.controls.length, 0);
});

test('HTTP requires authentication, an exact decision and current opaque token; SSE publishes only bound cards', async t => {
  const f = await fixture(t); f.behavior = 'ack';
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-token', codexHome: f.root, defaultCwd: f.root }, services: {
    store: f.store, desktopControl: f.control, live: { stop() {} }, liveTurns: { stop() {} }, uploads: {}, agentGateway: { stop() {} },
  } });
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 }); const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { authorization: 'Bearer synthetic-token' };
  const token = (await app.inject({ method: 'POST', url: `/api/desktop/threads/${threadId}/stream-token`, headers })).json().streamToken;
  const abort = new AbortController(); t.after(() => abort.abort());
  const response = await fetch(`${base}/api/desktop/threads/${threadId}/events?streamToken=${token}`, { signal: abort.signal });
  const reader = response.body.getReader(); t.after(() => reader.cancel().catch(() => {}));
  let body = ''; while (!body.includes('命令执行请求')) body += new TextDecoder().decode((await reader.read()).value);
  assert.ok(body.includes('"source":"desktop"')); assert.ok(!body.includes('"requestId":13'));
  const a = f.approval(); const request = { method: 'POST', url: `/api/desktop/threads/${threadId}/approvals/${a.id}/respond`, headers, payload: { decision: 'accept' } };
  assert.equal((await app.inject({ ...request, headers: {} })).statusCode, 401);
  assert.equal((await app.inject({ ...request, payload: { decision: 'accept', permissions: { network: { enabled: true } } } })).statusCode, 400);
  assert.equal((await app.inject({ ...request, payload: { decision: 'acceptForSession' } })).statusCode, 400);
  assert.equal((await app.inject(request)).json().status, 'submitted');
  assert.equal((await app.inject(request)).statusCode, 409); assert.equal(f.controls.length, 1);
});
