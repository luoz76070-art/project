import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(path.join(root, 'apps/mobile/src/app/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let sender, desktopSender, ordinarySender;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'sendHandoffMessage') sender = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'sendDesktopMessage') desktopSender = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'submitMessage') ordinarySender = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(sender, 'exercise the actual App handoff send function');
assert.ok(desktopSender, 'exercise the actual shared Desktop HTTP send function');
const temp = await mkdtemp(path.join(tmpdir(), 'mobile-handoff-'));
await build({ stdin: { contents: `
export * from './apps/mobile/src/features/product/handoff';
export { defaultRuntime, desktopControlResponsePatch, desktopControlPatch, saveThreadRuntimeCache, loadThreadRuntimeCache } from './apps/mobile/src/features/chat/runtime';
import { desktopSendControl, desktopControlResponsePatch, desktopRejectedSendPatch, desktopMessageReceived, getRuntime } from './apps/mobile/src/features/chat/runtime';
import { composeMessageWithAttachments } from './apps/mobile/src/features/chat/attachments';
import { capMessages, mergeMessagesById, desktopActionText } from './apps/mobile/src/features/chat/messages';
import { buildUrl, toFriendlyFetchError } from './apps/mobile/src/features/connection/http';
import { isDesktopSource } from './apps/mobile/src/features/threads/model';
export function makeSender(context) {
  const { selectedRef, activeRuntimeRef, relayStatus, sendLockRef, scopeAbortRef, setSubmittingMessage, patchRuntime, sendDesktopMessage } = context;
  ${sender}
  return sendHandoffMessage;
}
export function makeDesktopSender(context) {
  const { selected, selectedRef, activeRuntime, activeRuntimeRef, relayStatus, scopeAbortRef, sending, patchRuntime,
    updateRuntime, forceBottomRef, setStatus, apiPost, endpoint, token } = context;
  // F1: starting the notification service is a native side effect; the sender only has to call it.
  const attentionAfterSend = context.attentionAfterSend ?? (async () => undefined);
  ${desktopSender}
  return sendDesktopMessage;
}
export function makeOrdinarySubmit(context) {
  const { activeThreadKey, threadState, setStatus, patchRuntime } = context;
  ${ordinarySender}
  return submitMessage;
}`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'handoff.mjs'), define: { 'import.meta.env': '{}' } });
globalThis.localStorage = storage();
const m = await import(pathToFileURL(path.join(temp, 'handoff.mjs')));
test.after(() => rm(temp, { recursive: true, force: true }));
const target = { id: '12345678-1234-4234-8234-123456789abc', threadName: '合成目标', source: 'vscode', cwd: '/fixture/project' };
const seed = () => ({ revision: 1, id: '22345678-1234-4234-8234-123456789abc', status: 'draft', text: '只交接选中内容', createdAt: 1 });
const draft = () => ({ id: seed().id, text: seed().text, scope: 'fixture', targetId: target.id, attachments: [] });
const attachment = () => ({ id: 'file-one', fileName: 'sample.txt', path: '/fixture/upload/sample.txt', relativePath: 'sample.txt', size: 5, createdAt: '', mimeType: 'text/plain', previewUrl: 'blob:never-restore' });
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function bridge() {
  let state = seed(); const calls = [];
  return { calls, read: () => structuredClone(state), async handoff(input) {
    calls.push(structuredClone(input));
    if (input.id !== state.id || (input.action === 'submit' && state.status !== 'draft')) throw new Error('native reservation rejected');
    if (input.action === 'submit') state = { ...state, status: 'uncertain', target: input.target, message: input.message, clientMessageId: input.id };
    else if (input.action === 'confirm') state = { ...state, status: 'confirmed', acceptance: input.acceptance };
    return { handoff: structuredClone(state) };
  } };
}
function options(overrides = {}) {
  return { handoff: seed(), draft: draft(), scope: 'fixture', target, ready: true, host: bridge(), persist() {}, changed() {}, send: async () => 'confirmed', ...overrides };
}
test('handoff draft survives recreation without preview blobs, credentials or control fields', () => {
  const store = storage();
  m.saveHandoffDraft({ ...draft(), attachments: [attachment()], controlToken: 'never-persist', token: 'never-persist' }, store);
  const restored = m.loadHandoffDraft(seed(), 'other-profile', store);
  assert.equal(restored.scope, 'fixture');
  assert.equal(restored.text, seed().text);
  assert.deepEqual(restored.attachments, [{ ...attachment(), previewUrl: null }]);
  assert.equal([...store.values.values()].join('').includes('never-persist'), false);
  assert.equal(m.loadHandoffDraft({ ...seed(), id: 'different-id' }, 'other', store).scope, 'other');
});
test('bad storage and oversized or unavailable attachments fail explicitly', () => {
  const store = storage(); store.setItem('mobileCodexProductHandoffV1', '{broken');
  assert.throws(() => m.loadHandoffDraft(seed(), 'fixture', store), /无法读取/);
  assert.throws(() => m.saveHandoffDraft({ ...draft(), text: '中'.repeat(22000) }, store), /内容过大/);
  assert.throws(() => m.saveHandoffDraft({ ...draft(), attachments: [{ ...attachment(), size: -1 }] }, store), /附件不可用/);
  assert.throws(() => m.saveHandoffDraft(draft(), { setItem() { throw new Error('quota'); } }), /保存失败/);
});
test('confirmation durably reserves the exact target and full attachment message before one send', async () => {
  const order = []; const host = bridge(); const changed = [];
  const pending = { ...draft(), attachments: [attachment()] };
  await m.submitProductHandoff(options({ host: { async handoff(input) { order.push('native-' + input.action); return host.handoff(input); } }, draft: pending,
    persist(value) { assert.equal(value, pending); order.push('save'); }, changed(value) { changed.push(value); order.push(value.status); },
    async send(message, id, threadId) {
      order.push('send'); assert.equal(host.read().status, 'uncertain'); assert.equal(id, seed().id); assert.equal(threadId, target.id);
      assert.equal(message, `${seed().text}\n\n已上传附件：\n- sample.txt | /fixture/upload/sample.txt`);
      return 'confirmed';
    } }));
  assert.deepEqual(order, ['save', 'native-submit', 'uncertain', 'send', 'native-confirm', 'confirmed']);
  assert.equal(changed.at(-1).acceptance, 'desktop');
});
test('a confirmed queue receipt is distinguished from Desktop execution', async () => {
  const host = bridge();
  await m.submitProductHandoff(options({ host, send: async () => 'queued' }));
  assert.equal(host.read().status, 'confirmed'); assert.equal(host.read().acceptance, 'queue');
});
test('duplicate clicks and stale reopened drafts cannot submit a second request', async () => {
  const host = bridge(); let sends = 0, release;
  const first = m.submitProductHandoff(options({ host, send: async () => { sends++; await new Promise(resolve => { release = resolve; }); return 'uncertain'; } }));
  await Promise.resolve(); await Promise.resolve();
  await assert.rejects(m.submitProductHandoff(options({ host })), /勿重复发送/);
  release(); await first;
  await assert.rejects(m.submitProductHandoff(options({ host, send: async () => { sends++; return 'confirmed'; } })), /reservation rejected/);
  assert.equal(sends, 1); assert.equal(host.read().status, 'uncertain');
});
test('scope, target, Desktop ownership and readiness are checked before reservation', async () => {
  for (const change of [{ scope: 'changed' }, { draft: { ...draft(), targetId: 'different' } }, { target: { ...target, source: 'appServer' } }, { ready: false }]) {
    const host = bridge();
    await assert.rejects(m.submitProductHandoff(options({ ...change, host })), /已改变/);
    assert.equal(host.calls.length, 0);
  }
});
test('failed draft persistence or a mismatched native binding prevents all HTTP writes', async () => {
  let sends = 0; const host = bridge();
  await assert.rejects(m.submitProductHandoff(options({ host, persist() { throw new Error('quota'); }, send: async () => { sends++; return 'confirmed'; } })), /quota/);
  assert.equal(host.calls.length, 0);
  await assert.rejects(m.submitProductHandoff(options({ host: { handoff: async () => ({ handoff: { ...seed(), status: 'uncertain', clientMessageId: seed().id, target: { scope: 'fixture', threadId: 'wrong' } } }) }, send: async () => { sends++; return 'confirmed'; } })), /身份未能确认/);
  assert.equal(sends, 0);
});
test('transport exceptions preserve the native unknown lock and restoring does not send', async () => {
  const host = bridge();
  await assert.rejects(m.submitProductHandoff(options({ host, send: async () => { throw new Error('timeout'); } })), /timeout/);
  assert.equal(host.read().status, 'uncertain');
  m.loadHandoffDraft(host.read(), 'fixture', storage());
  assert.equal(host.calls.length, 1);
});
test('late receipts cannot confirm another connection, thread or handoff identity', () => {
  const handoff = { ...seed(), status: 'uncertain', clientMessageId: seed().id, target: { scope: 'fixture', threadId: target.id } };
  assert.equal(m.handoffMatchesReceipt(handoff, 'fixture', target.id, seed().id), true);
  assert.equal(m.handoffMatchesReceipt(handoff, 'changed', target.id, seed().id), false);
  assert.equal(m.handoffMatchesReceipt(handoff, 'fixture', 'other', seed().id), false);
  assert.equal(m.handoffMatchesReceipt(handoff, 'fixture', target.id, 'old-id'), false);
});
test('matching live queue state recovers a lost HTTP receipt without claiming Desktop execution', () => {
  const handoff = { ...seed(), status: 'uncertain', clientMessageId: seed().id, target: { scope: 'fixture', threadId: target.id } };
  const control = { transport: 'native', queue: { available: true, items: [{ clientMessageId: seed().id, status: 'waiting' }] } };
  assert.equal(m.handoffReceiptAcceptance(handoff, 'fixture', target.id, control), 'queue');
  assert.equal(m.handoffReceiptAcceptance(handoff, 'other', target.id, control), null);
  assert.equal(m.handoffReceiptAcceptance(handoff, 'fixture', 'other', control), null);
  assert.equal(m.handoffReceiptAcceptance(handoff, 'fixture', target.id, { ...control, queue: { items: [{ clientMessageId: 'other' }] } }), null);
  assert.equal(m.handoffReceiptAcceptance(handoff, 'fixture', target.id, { ...control, submission: { clientMessageId: seed().id, delivery: 'submitted' } }), 'queue');
  assert.equal(m.handoffReceiptAcceptance(handoff, 'fixture', target.id, { ...control, submission: { clientMessageId: seed().id, delivery: 'confirmed' } }), 'desktop');
});
function senderFixture() {
  const runtime = { ...m.defaultRuntime(), draft: '原远控草稿', attachments: [attachment()], desktopControl: { transport: 'native', token: 'ephemeral', canSend: true, activeTurnId: null } };
  const activeRuntimeRef = { current: runtime }, calls = [], patches = [];
  const context = { activeRuntimeRef, selectedRef: { current: target }, relayStatus: { desktopControl: { mode: 'desktop-ipc-follower-control' } },
    sendLockRef: { current: false }, scopeAbortRef: { current: new AbortController() }, setSubmittingMessage(value) { calls.push(value); },
    patchRuntime(id, patch) { patches.push({ id, patch }); activeRuntimeRef.current = { ...activeRuntimeRef.current, ...patch }; },
    async sendDesktopMessage(...args) { calls.push(args); return 'confirmed'; } };
  return { context, calls, patches, send: m.makeSender(context) };
}
test('the actual App send path keeps ordinary drafts and uses the frozen target, ID and native guard', async () => {
  const f = senderFixture();
  assert.equal(await f.send('交接任务', seed().id, target.id), 'confirmed');
  const args = f.calls.find(Array.isArray);
  assert.equal(args[0], target.id); assert.equal(args[1], '交接任务'); assert.equal(args[4], seed().id); assert.equal(args[5], 'start');
  assert.deepEqual(args[6], { controlToken: 'ephemeral', expectedTurnId: null }); assert.equal(args[7], true);
  const runtime = f.context.activeRuntimeRef.current;
  const accepted = { ...runtime, ...m.desktopControlResponsePatch(runtime, { action: 'start-turn', delivery: 'confirmed' }, seed().id) };
  assert.equal(accepted.draft, '原远控草稿'); assert.equal(accepted.attachments.length, 1); assert.equal(accepted.pendingMessageId, undefined);
});
test('handoff confirmation cannot clear an identical ordinary draft, including after recreation', async () => {
  const f = senderFixture();
  f.context.activeRuntimeRef.current = { ...f.context.activeRuntimeRef.current, draft: '同文草稿', attachments: [] };
  await f.send('同文草稿', seed().id, target.id);
  const runtime = f.context.activeRuntimeRef.current;
  assert.equal(runtime.pendingMessageSource, 'handoff');
  assert.equal(m.saveThreadRuntimeCache({ [target.id]: runtime }, 'identical-handoff').status, 'saved');
  const restored = m.loadThreadRuntimeCache('identical-handoff')[target.id];
  assert.equal(restored.pendingMessageSource, 'handoff');
  for (const accepted of [
    m.desktopControlResponsePatch(restored, { action: 'start-turn', delivery: 'confirmed' }, seed().id),
    m.desktopControlPatch(restored, { transport: 'native', submission: { clientMessageId: seed().id, action: 'start-turn', delivery: 'confirmed' } }),
    m.desktopControlPatch(restored, { transport: 'native', queue: { available: true, items: [{ clientMessageId: seed().id, status: 'waiting' }] } }),
  ]) {
    assert.equal(accepted.draft, undefined); assert.equal(accepted.attachments, undefined);
    assert.equal(accepted.pendingMessageId, undefined); assert.equal(accepted.pendingMessageSource, undefined);
    assert.equal({ ...restored, ...accepted }.draft, '同文草稿');
  }
});
test('ordinary submit cannot reuse the pending handoff ID after recreation even with the same text', async () => {
  const notices = [];
  const runtime = { ...m.defaultRuntime(), draft: '同文草稿', pendingMessageId: seed().id, pendingMessageText: '同文草稿', pendingMessageSource: 'handoff' };
  const send = m.makeOrdinarySubmit({ activeThreadKey: target.id, threadState: { [target.id]: runtime }, setStatus: value => notices.push(value),
    patchRuntime() { assert.fail('must not reserve or send an ordinary input while the handoff is unknown'); } });
  await send(); assert.match(notices[0], /交接结果待确认/);
});
test('the actual App path rejects a changed target, legacy transport, aborted scope or another pending input', async () => {
  for (const mode of ['target', 'legacy', 'aborted', 'pending']) {
    const f = senderFixture();
    if (mode === 'target') f.context.selectedRef.current = { ...target, id: 'other' };
    if (mode === 'legacy') f.context.activeRuntimeRef.current.desktopControl = { transport: 'legacy' };
    if (mode === 'aborted') f.context.scopeAbortRef.current.abort();
    if (mode === 'pending') f.context.activeRuntimeRef.current.pendingMessageId = 'other';
    assert.equal(await f.send('任务', seed().id, target.id), 'rejected');
    assert.equal(f.calls.length, 0); assert.equal(f.patches.length, 0);
  }
});

function desktopFixture(response) {
  const f = senderFixture();
  const ref = f.context.activeRuntimeRef;
  ref.current = { ...ref.current, pendingMessageId: seed().id, pendingMessageText: '交接任务' };
  const requests = [];
  const context = { ...f.context, selected: { ...target }, activeRuntime: ref.current, sending: false, forceBottomRef: { current: false },
    setStatus() {}, endpoint: 'https://fixture.invalid', token: 'synthetic',
    updateRuntime(id, update) { assert.equal(id, target.id); ref.current = update(ref.current); },
    async apiPost(url, token, payload) { requests.push({ url, token, payload }); return typeof response === 'function' ? response(ref) : response; } };
  return { context, requests, send: m.makeDesktopSender(context), runtime: () => ref.current };
}
test('actual HTTP ACK and unknown queue receipts retain the handoff lock and normal drafts', async () => {
  for (const [action, delivery, expected] of [['start-turn', 'submitted', 'uncertain'], ['queue-message', 'uncertain', 'uncertain'], ['queue-message', 'confirmed', 'queued'], ['start-turn', 'confirmed', 'confirmed']]) {
    const f = desktopFixture({ ok: true, action, delivery });
    const result = await f.send(target.id, '交接任务', '原远控草稿', [], seed().id, action === 'queue-message' ? 'queue' : 'start', { controlToken: 'ephemeral', expectedTurnId: null }, true);
    assert.equal(result, expected);
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].url, new RegExp(`/api/desktop/control/threads/${target.id}/messages$`));
    assert.equal(f.requests[0].payload.clientMessageId, seed().id);
    assert.equal(f.runtime().draft, '原远控草稿'); assert.equal(f.runtime().attachments.length, 1);
    if (delivery !== 'confirmed') assert.equal(f.runtime().pendingMessageId, seed().id);
  }
});
test('a matching SSE confirmation wins over a later HTTP error in the actual shared send path', async () => {
  const f = desktopFixture(ref => {
    ref.current = { ...ref.current, desktopControl: { ...ref.current.desktopControl,
      submission: { clientMessageId: seed().id, action: 'start-turn', delivery: 'confirmed' } }, pendingMessageId: undefined };
    throw new Error('synthetic late HTTP failure');
  });
  assert.equal(await f.send(target.id, '交接任务', '原远控草稿', [], seed().id, 'start', { controlToken: 'ephemeral', expectedTurnId: null }, true), 'confirmed');
  assert.equal(f.requests.length, 1); assert.equal(f.runtime().draft, '原远控草稿');
  assert.equal(f.runtime().lastTurnError, '');
});
test('a queued SSE receipt followed by an HTTP failure remains a queue acceptance in the actual sender', async () => {
  const f = desktopFixture(ref => {
    ref.current = { ...ref.current, desktopControl: { ...ref.current.desktopControl,
      queue: { available: true, items: [{ clientMessageId: seed().id, status: 'waiting' }] } } };
    throw new Error('synthetic lost queue receipt');
  });
  assert.equal(await f.send(target.id, '交接任务', '原远控草稿', [], seed().id, 'queue', { controlToken: 'ephemeral', expectedTurnId: 'fixture-turn' }, true), 'queued');
  assert.equal(f.requests.length, 1); assert.equal(f.runtime().draft, '原远控草稿');
});
test('actual shared send never writes to a stale selected closure or legacy fallback for handoffs', async () => {
  for (const mode of ['closure', 'legacy']) {
    const f = desktopFixture({ ok: true });
    if (mode === 'closure') f.context.selected.id = 'stale';
    else f.context.activeRuntimeRef.current.desktopControl = { transport: 'legacy' };
    assert.equal(await f.send('12345678-1234-4234-8234-123456789abc', '任务', '', [], seed().id, 'start', undefined, true), 'rejected');
    assert.equal(f.requests.length, 0);
  }
});
