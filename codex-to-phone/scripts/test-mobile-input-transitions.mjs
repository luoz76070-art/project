import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Import production state updaters directly, together with shared cache/render functions.
// Only synthetic messages/storage are used. No HTTP, native IPC, or model tasks.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.join(root, 'apps/mobile/src');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-input-transitions-'));
const driverSource = `
import { createRuntimeSync } from ${JSON.stringify(path.join(mobile, 'features/chat/runtimeSync.ts'))};
import { capMessages, mergeMessagesById, messagesForRender } from ${JSON.stringify(path.join(mobile, 'features/chat/messages.ts'))};
import { defaultRuntime, saveThreadRuntimeCache, loadThreadRuntimeCache } from ${JSON.stringify(path.join(mobile, 'features/chat/runtime.ts'))};
import { reconcileMessages, messageDisplayKey } from ${JSON.stringify(path.join(mobile, 'features/chat/messageReconciliation.ts'))};
import { createSnapshotReducer } from ${JSON.stringify(path.join(mobile, 'features/connection/snapshotPatch.ts'))};
import { groupMessageProcesses } from ${JSON.stringify(path.join(mobile, 'features/chat/processGroups.ts'))};
export { defaultRuntime, messagesForRender, groupMessageProcesses, createSnapshotReducer, saveThreadRuntimeCache, loadThreadRuntimeCache, reconcileMessages, messageDisplayKey };
export function makeDriver(seed = defaultRuntime()) {
  let state = seed;
  function updateRuntime(_key, updater) { state = updater(state); }
  const signal = new AbortController().signal;
  const { applyDesktopStreamSnapshot, applyDesktopDelta } = createRuntimeSync({
    getRuntime: () => state, getSignal: () => signal, updateRuntime,
    read: async () => { throw new Error('unexpected HTTP in state transition tests'); },
  });
  return {
    state: () => state,
    snapshot: input => { applyDesktopStreamSnapshot('thread', input); return state; },
    delta: input => { applyDesktopDelta('thread', input); return state; },
    receipt: message => { state = { ...state, messages: capMessages(mergeMessagesById(state.messages, [message]), state) }; return state; },
  };
}
`;
await build({ stdin: { contents: driverSource, resolveDir: root, sourcefile: 'input-transition-driver.ts', loader: 'ts' }, outfile: path.join(temp, 'driver.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'es2022', define: { 'import.meta.env': '{}' } });
const previousStorage = globalThis.localStorage;
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const { makeDriver, defaultRuntime, messagesForRender, groupMessageProcesses, createSnapshotReducer, saveThreadRuntimeCache, loadThreadRuntimeCache, reconcileMessages, messageDisplayKey } = await import(pathToFileURL(path.join(temp, 'driver.mjs')).href);
const turnId = '00000000-0000-4000-8000-000000000101';
const base = { role: 'user', text: '合成输入：只回复开始', turnId };
const provisional = { ...base, id: `${turnId}-input`, kind: 'userMessage', timestamp: '2026-10-23T12:00:00.000Z' };
const native = { ...base, id: `desktop-${turnId}-initial-user`, kind: 'userMessage', timestamp: provisional.timestamp, clientMessageId: 'client-one', replacesMessageId: provisional.id };
const history = { ...base, id: 'log-synthetic-one', kind: 'message', timestamp: '2026-10-23T12:00:00.070Z', sourceItemId: 'history-one' };
const started = { id: 'log-synthetic-started', role: 'tool', kind: 'task_started', text: 'Codex turn started', turnId, timestamp: '2026-10-23T12:00:00.056Z' };
const receipt = { ...base, id: 'desktop-local-client-one', kind: 'local', clientMessageId: 'client-one', timestamp: '2026-10-23T11:59:59.950Z', attachments: [{ id: 'upload-one', path: '/synthetic/upload.txt', fileName: 'upload.txt', mimeType: 'text/plain', size: 1 }] };
const snap = messages => ({ threadId: 'thread', status: 'inProgress', eventCount: messages.length, messages, interactionsAvailable: false });
const users = driver => messagesForRender(driver.state().messages).filter(message => message.role === 'user');
function permutations(items) { return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest])) : [[]]; }
const orders = permutations(['provisional', 'native', 'history', 'receipt']).filter(order => order.indexOf('provisional') < order.indexOf('native'));

for (const provisionalClient of [false, true]) for (const formalClient of [false, true]) {
  test(`initial replacement keeps one user at every App transition (provisional client=${provisionalClient}, formal client=${formalClient}, 12 orders)`, () => {
    for (const order of orders) {
      const d = makeDriver();
      for (const event of order) {
        if (event === 'provisional') d.snapshot(snap([{ ...provisional, ...(provisionalClient ? { clientMessageId: native.clientMessageId } : {}) }]));
        if (event === 'native') d.snapshot(snap([{ ...native, clientMessageId: formalClient ? native.clientMessageId : undefined }]));
        if (event === 'history') d.delta({ messages: [started, history], cursor: 102 });
        if (event === 'receipt') d.receipt(receipt);
        assert.equal(users(d).length, 1, `${order.join(' -> ')} at ${event}`);
      }
      const message = users(d)[0];
      assert.equal(message.nativeMessageId, native.id);
      assert.equal(message.sourceItemId, history.sourceItemId);
      assert.equal(message.clientMessageId, native.clientMessageId);
      assert.equal(message.replacesMessageId, provisional.id);
      assert.deepEqual(message.attachments, receipt.attachments);
      assert.equal(messageDisplayKey(message), messageDisplayKey(provisional));
    }
  });
}

test('source patch replacement retires a provisional already absorbed into history and stays fixed after a final/reconnect', () => {
  const d = makeDriver(), reduce = createSnapshotReducer();
  d.snapshot(reduce({ ...snap([provisional]), seq: 1 }));
  d.delta({ messages: [started, history], cursor: 102 });
  const displayKey = messageDisplayKey(users(d)[0]);
  assert.equal(users(d)[0].nativeMessageId, provisional.id);
  d.snapshot(reduce({ partial: true, seq: 2, baseSeq: 1, removedIds: [provisional.id], messages: [native] }));
  assert.equal(users(d).length, 1);
  assert.equal(users(d)[0].nativeMessageId, native.id);
  assert.equal(messageDisplayKey(users(d)[0]), displayKey);
  assert.deepEqual(groupMessageProcesses(messagesForRender(d.state().messages)).map(group => group.kind === 'process' ? 'process' : group.message.role), ['process', 'user']);
  const final = { id: `desktop-${turnId}-answer`, role: 'assistant', kind: 'agentMessage', phase: 'final_answer', text: '开始', timestamp: '2026-10-23T12:00:04Z', turnId };
  d.snapshot({ ...snap([native, final]), status: 'completed' });
  d.snapshot(snap([native, final]));
  d.receipt(receipt);
  assert.equal(users(d).length, 1);
  assert.ok(d.state().messages.some(message => message.id === final.id));
});

test('version 3 old cache is repaired by an authoritative replacement while draft, pending input and genuine repeats survive', () => {
  const scope = 'legacy-replacement';
  const { replacesMessageId: omittedRelation, ...oldNative } = native;
  const oldHistory = { ...history, nativeMessageId: provisional.id };
  const repeat = { ...native, id: `desktop-${turnId}-accepted-steer`, clientMessageId: 'client-two', replacesMessageId: undefined };
  const seed = { messageIdentityVersion: 3, messages: [oldHistory, oldNative, started, repeat], cursor: 400, generation: 'generation', historyBefore: 100, draft: '保留草稿', pendingMessageId: 'other-pending', pendingMessageText: '另一条待确认输入' };
  values.set(`mobileCodexThreadRuntimeCacheV2:${scope}`, JSON.stringify({ thread: seed }));
  const restored = loadThreadRuntimeCache(scope).thread;
  assert.equal(restored.messages.filter(message => message.role === 'user').length, 3, 'old data without a replacement relation is not guessed away');
  const d = makeDriver(restored);
  d.snapshot(snap([native, repeat]));
  assert.equal(users(d).length, 2);
  assert.equal(d.state().draft, seed.draft);
  assert.equal(d.state().pendingMessageId, seed.pendingMessageId);
  assert.equal(d.state().pendingMessageText, seed.pendingMessageText);
  assert.equal(d.state().cursor, seed.cursor);
  assert.equal(d.state().generation, seed.generation);
  assert.equal(d.state().historyBefore, seed.historyBefore);
  saveThreadRuntimeCache({ thread: d.state() }, scope);
  const reopened = makeDriver(loadThreadRuntimeCache(scope).thread);
  assert.equal(users(reopened).length, 2);
  reopened.snapshot(snap([native, repeat]));
  assert.equal(users(reopened).length, 2);
  assert.equal(reopened.state().draft, seed.draft);
});

test('cached explicit replacement repairs on load/save and cannot be undone by a late provisional replay', () => {
  const scope = 'replacement-known';
  const seed = { ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id }, native, provisional], draft: 'draft' };
  values.set(`mobileCodexThreadRuntimeCacheV2:${scope}`, JSON.stringify({ thread: { ...seed, messageIdentityVersion: 3 } }));
  const loaded = loadThreadRuntimeCache(scope).thread;
  assert.equal(loaded.messages.filter(message => message.role === 'user').length, 1);
  saveThreadRuntimeCache({ thread: seed }, scope);
  const stored = JSON.parse(values.get(`mobileCodexThreadRuntimeCacheV2:${scope}`)).thread;
  assert.equal(stored.messages.filter(message => message.role === 'user').length, 1);
  const d = makeDriver(loaded);
  d.snapshot(snap([provisional]));
  d.delta({ messages: [history], cursor: 103 });
  assert.equal(users(d).length, 1);
  assert.equal(users(d)[0].nativeMessageId, native.id);
  assert.equal(users(d)[0].replacesMessageId, provisional.id);
});

test('identity-only snapshot repairs an old cache even when the initial input has left the 120-message tail', () => {
  const { replacesMessageId: omitted, ...oldNative } = native;
  const d = makeDriver({ ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id }, oldNative], draft: '草稿保持' });
  const inputReplacements = [{ turnId, replacesMessageId: provisional.id, nativeMessageId: native.id, clientMessageId: native.clientMessageId }];
  const reduce = createSnapshotReducer();
  d.snapshot(reduce({ ...snap([started]), seq: 1 }));
  assert.equal(users(d).length, 2);
  d.snapshot(reduce({ partial: true, seq: 2, baseSeq: 1, messages: [], inputReplacements }));
  assert.equal(users(d).length, 1);
  assert.equal(users(d)[0].nativeMessageId, native.id);
  assert.equal(users(d)[0].sourceItemId, history.sourceItemId);
  assert.equal(users(d)[0].replacesMessageId, provisional.id);
  const onlyAlias = makeDriver({ ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id }] });
  onlyAlias.snapshot({ ...snap([started]), inputReplacements });
  onlyAlias.snapshot(snap([provisional]));
  assert.equal(users(onlyAlias).length, 1);
  assert.equal(users(onlyAlias)[0].nativeMessageId, native.id);
  const conflict = makeDriver({ ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id, clientMessageId: 'other-client' }, oldNative] });
  conflict.snapshot({ ...snap([started]), inputReplacements });
  assert.equal(users(conflict).length, 2);
  const ambiguous = makeDriver({ ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id }, oldNative] });
  ambiguous.snapshot({ ...snap([started]), inputReplacements: [...inputReplacements, { ...inputReplacements[0], nativeMessageId: `desktop-${turnId}-other` }] });
  assert.equal(users(ambiguous).length, 2);
  const nativeConflict = makeDriver({ ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id }, { ...oldNative, clientMessageId: 'conflicting-native-client' }] });
  nativeConflict.snapshot({ ...snap([started]), inputReplacements });
  assert.equal(users(nativeConflict).length, 2);
  const malformed = makeDriver({ ...defaultRuntime(), messages: [{ ...history, nativeMessageId: provisional.id }, oldNative] });
  malformed.snapshot({ ...snap([started]), inputReplacements: [null, {}, { turnId, replacesMessageId: provisional.id }] });
  assert.equal(users(malformed).length, 2);
});

test('replacement requires the exact predecessor, full body and compatible identities; ambiguous claims stay separate', () => {
  const incompatible = [
    { ...native, replacesMessageId: 'unrelated-input', clientMessageId: undefined },
    { ...native, turnId: 'other-turn', clientMessageId: undefined },
    { ...native, text: '不同正文', clientMessageId: undefined },
    { ...native, clientMessageId: 'different-client' },
  ];
  for (const message of incompatible) {
    const result = reconcileMessages([{ ...provisional, clientMessageId: native.clientMessageId }], [message]);
    assert.equal(result.length, 2);
  }
  const anotherClaim = { ...native, id: `desktop-${turnId}-different-initial`, clientMessageId: 'client-two' };
  assert.equal(reconcileMessages([provisional], [native, anotherClaim]).length, 3, 'conflicting replacement claims are not assigned by text');
  const twoNative = [native, { ...native, id: `desktop-${turnId}-accepted-steer`, clientMessageId: 'client-two', replacesMessageId: undefined }];
  const twoHistory = [history, { ...history, id: 'log-synthetic-two', sourceItemId: 'history-two', timestamp: '2026-10-23T12:00:01Z' }];
  assert.equal(reconcileMessages([provisional], [...twoNative, ...twoHistory]).length, 2);
  assert.equal(reconcileMessages(twoNative, [history]).length, 3, 'partial history with two real same-text occurrences remains conservative');
});

// Phone evidence: an initial turn without a server ID was projected as turn-N.
// Its client/native alias became canonical, but its id and turnId stayed indexed.
const indexedInput = { ...provisional, id: 'turn-48-input', turnId: 'turn-48', clientMessageId: native.clientMessageId };
const gap = Array.from({ length: 12 }, (_, index) => ({ ...started, id: `synthetic-gap-${index}`, text: `Synthetic tool step ${index}`, timestamp: provisional.timestamp }));
const stuckIndexedInput = { ...indexedInput, nativeMessageId: native.id, replacesMessageId: provisional.id };

test('indexed pending turn is promoted before history pairing through real App updates (six orders)', () => {
  for (const order of permutations(['native', 'history', 'receipt'])) {
    const d = makeDriver();
    d.snapshot(snap([indexedInput, ...gap]));
    for (const event of order) {
      if (event === 'native') d.snapshot(snap([native, ...gap]));
      if (event === 'history') d.delta({ messages: [history], cursor: 103 });
      if (event === 'receipt') d.receipt(receipt);
    }
    assert.equal(users(d).length, 1, order.join(' -> '));
    assert.equal(users(d)[0].turnId, turnId);
    assert.equal(users(d)[0].nativeMessageId, native.id);
    assert.equal(users(d)[0].sourceItemId, history.sourceItemId);
    assert.notEqual(users(d)[0].id, indexedInput.id);
    assert.deepEqual(users(d)[0].attachments, receipt.attachments);
    d.snapshot(snap([indexedInput, ...gap]));
    assert.equal(users(d).length, 1, 'a late pre-admission snapshot cannot restore the indexed turn');
  }
});

test('cached indexed input with a formal alias repairs offline and survives finish, reconnect and a genuine same-text steer', () => {
  const scope = 'indexed-turn-cache';
  const seed = { messageIdentityVersion: 3, messages: [stuckIndexedInput, ...gap, history], cursor: 400, generation: 'generation', historyBefore: 100, draft: '保留草稿', pendingMessageId: 'other-pending', pendingMessageText: '另一条待确认输入' };
  values.set(`mobileCodexThreadRuntimeCacheV2:${scope}`, JSON.stringify({ thread: seed }));
  const loaded = loadThreadRuntimeCache(scope).thread;
  const d = makeDriver(loaded);
  assert.equal(users(d).length, 1);
  assert.equal(users(d)[0].turnId, turnId);
  assert.equal(loaded.draft, seed.draft);
  assert.equal(loaded.pendingMessageId, seed.pendingMessageId);
  assert.equal(loaded.cursor, seed.cursor);
  assert.equal(loaded.generation, seed.generation);
  assert.equal(loaded.historyBefore, seed.historyBefore);
  saveThreadRuntimeCache({ thread: loaded }, scope);
  assert.equal(loadThreadRuntimeCache(scope).thread.messages.filter(m => m.role === 'user').length, 1);
  const final = { ...started, id: 'synthetic-indexed-final', role: 'assistant', kind: 'agentMessage', phase: 'final_answer', text: '完成', timestamp: '2026-10-23T12:00:03Z' };
  d.snapshot({ ...snap([native, final]), status: 'completed' });
  d.snapshot(snap([indexedInput]));
  d.snapshot({ ...snap([final]), inputReplacements: [{ turnId, replacesMessageId: provisional.id, nativeMessageId: native.id, clientMessageId: native.clientMessageId }] });
  d.delta({ messages: [history], cursor: 401 });
  assert.equal(users(d).length, 1);
  const steer = { ...native, id: `desktop-${turnId}-genuine-steer`, clientMessageId: 'second-client', replacesMessageId: undefined, timestamp: '2026-10-23T12:00:04Z' };
  const steerHistory = { ...history, id: 'log-second-real-input', sourceItemId: 'source-second-real-input', timestamp: '2026-10-23T12:00:04.070Z' };
  d.snapshot(snap([native, steer]));
  d.delta({ messages: [steerHistory], cursor: 402 });
  assert.equal(users(d).length, 2, 'a distinct accepted input stays separate');
});

test('indexed turn promotion requires its own explicit formal alias, not body, time or another real turn', () => {
  const invalid = [
    { ...indexedInput },
    { ...stuckIndexedInput, nativeMessageId: 'desktop-unrelated-input' },
    { ...stuckIndexedInput, replacesMessageId: undefined },
    { ...stuckIndexedInput, id: 'other-original-input' },
    { ...stuckIndexedInput, id: 'real-other-turn-input', turnId: 'real-other-turn' },
  ];
  for (const item of invalid) {
    const result = reconcileMessages([item, ...gap], [history]);
    assert.equal(result.filter(m => m.role === 'user').length, 2, JSON.stringify(item));
    assert.equal(result.find(m => m.id === item.id)?.turnId, item.turnId);
  }
  const unrelated = { ...indexedInput, clientMessageId: 'different-submission' };
  assert.equal(reconcileMessages([unrelated, ...gap], [native, history]).filter(m => m.role === 'user').length, 2);
});

test.after(async () => { globalThis.localStorage = previousStorage; await fs.rm(temp, { recursive: true, force: true }); });
