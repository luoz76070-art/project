import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-connection-test-'));
test.after(() => fs.rm(temp, { recursive: true, force: true }));
async function moduleFrom(file) {
  const source = await fs.readFile(new URL(`../apps/mobile/src/${file}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const outputPath = path.join(temp, path.basename(file).replace(/\.ts$/, '.mjs'));
  await fs.writeFile(outputPath, output.outputText);
  return import(pathToFileURL(outputPath).href);
}
const { subscribeEvents } = await moduleFrom('features/connection/subscription.ts');
const { saveThreadRuntimeCache, loadThreadRuntimeCache, defaultRuntime, turnProgressPatch } = await moduleFrom('features/chat/runtime.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('joining a running turn restores activity and phase-only deltas keep it active', () => {
  let runtime = { ...defaultRuntime(), lastTurnError: 'old send failure' };
  runtime = { ...runtime, ...turnProgressPatch(runtime, { turnStatus: 'inProgress', activity: 'thinking' }) };
  assert.equal(runtime.sending, true);
  assert.equal(runtime.lastTurnError, '');
  assert.equal(runtime.messages.length, 0);
  for (const activity of ['working', 'outputting', 'thinking']) {
    runtime = { ...runtime, ...turnProgressPatch(runtime, { activity }) };
    assert.equal(runtime.turnStatus, 'inProgress');
    assert.equal(runtime.activity, activity);
    assert.equal(runtime.sending, true);
  }
});

test('explicit terminal status ends activity even with no assistant message', () => {
  for (const turnStatus of ['completed', 'interrupted', 'failed']) {
    let runtime = { ...defaultRuntime(), turnStatus: 'inProgress', activity: 'working', sending: true, activeTurnId: 'turn' };
    runtime = { ...runtime, ...turnProgressPatch(runtime, { turnStatus }) };
    assert.equal(runtime.sending, false);
    assert.equal(runtime.activity, undefined);
    assert.equal(runtime.activeTurnId, null);
    assert.equal(turnProgressPatch(runtime, { activity: 'outputting' }).activity, undefined);
  }
});

test('older relays without progress preserve pending state and drafts', () => {
  const runtime = { ...defaultRuntime(), sending: true, turnStatus: 'starting', draft: 'keep draft' };
  const next = { ...runtime, ...turnProgressPatch(runtime, {}) };
  assert.equal(next.turnStatus, 'starting');
  assert.equal(next.sending, true);
  assert.equal(next.draft, 'keep draft');
});

function environment(t) {
  const document = new EventTarget(); document.hidden = false;
  const window = new EventTarget();
  const sources = [];
  class FakeSource extends EventTarget {
    closed = false;
    constructor(url) { super(); this.url = url; sources.push(this); }
    close() { this.closed = true; }
    emit(name, data) { this.dispatchEvent(Object.assign(new Event(name), { data: JSON.stringify(data) })); }
  }
  const originals = { document: globalThis.document, window: globalThis.window, EventSource: globalThis.EventSource };
  Object.assign(globalThis, { document, window, EventSource: FakeSource });
  const cleanups = [];
  t.after(() => { for (const cleanup of cleanups) cleanup(); Object.assign(globalThis, originals); });
  return { document, window, sources, own: (cleanup) => cleanups.push(cleanup) };
}

test('stream error obtains a fresh token, resumes, and disposal ignores late frames', async t => {
  const { sources, own } = environment(t);
  let tokens = 0, snapshots = 0;
  const states = [];
  const stop = subscribeEvents({ getToken: async () => ({ streamToken: String(++tokens) }), url: x => x,
    events: { desktop: () => snapshots++ }, onState: x => states.push(x), retryBaseMs: 1 });
  own(stop);
  await tick(); sources[0].onopen(); sources[0].onerror();
  await tick();
  assert.equal(tokens, 2);
  assert.equal(sources[0].closed, true);
  sources[0].emit('desktop', {});
  assert.equal(snapshots, 0);
  sources[1].onopen(); sources[1].emit('desktop', {});
  assert.equal(snapshots, 1);
  stop(); sources[1].emit('desktop', {});
  assert.equal(snapshots, 1);
  assert.ok(states.includes('recovering') && states.includes('online'));
});

test('hidden tabs close streams; foreground resumes with a new token', async t => {
  const { sources, document, own } = environment(t);
  let tokens = 0;
  const stop = subscribeEvents({ getToken: async () => ({ streamToken: String(++tokens) }), url: x => x, events: {}, onState() {} });
  own(stop);
  await tick(); document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(sources[0].closed, true);
  await tick(); assert.equal(tokens, 1);
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  await tick(); assert.equal(tokens, 2);
});

test('401 stops retries even after online and focus events', async t => {
  const { window, own } = environment(t);
  let attempts = 0;
  const states = [];
  const stop = subscribeEvents({ getToken: async () => { attempts++; throw Object.assign(new Error('auth'), { status: 401 }); },
    url: x => x, events: {}, onState: x => states.push(x), retryBaseMs: 1 });
  own(stop);
  await tick(); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'));
  await tick(); assert.equal(attempts, 1); assert.equal(states.at(-1), 'unauthorized');
});

test('silent streams expire on heartbeat deadline and reconnect', async t => {
  const { sources, own } = environment(t);
  const stop = subscribeEvents({ getToken: async () => ({ streamToken: 'token' }), url: x => x, events: {}, onState() {}, heartbeatMs: 15, retryBaseMs: 1 });
  own(stop);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(sources.length >= 2);
  assert.equal(sources[0].closed, true);
});

test('cache and drafts are isolated by applied connection scope', () => {
  const data = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  try {
    saveThreadRuntimeCache({ sameThread: { ...defaultRuntime(), draft: 'draft A', messages: [{ id: 'one', role: 'user', text: 'A', timestamp: '2026-10-20' }] } }, 'A');
    saveThreadRuntimeCache({ sameThread: { ...defaultRuntime(), draft: 'draft B' } }, 'B');
    assert.equal(loadThreadRuntimeCache('A').sameThread.messages[0].text, 'A');
    assert.equal(loadThreadRuntimeCache('B').sameThread.draft, 'draft B');
    assert.equal(loadThreadRuntimeCache('B').sameThread.messages.length, 0);
    assert.deepEqual(loadThreadRuntimeCache('C'), {});
  } finally { globalThis.localStorage = original; }
});

const { createSnapshotReducer } = await moduleFrom('features/connection/snapshotPatch.ts');
test('snapshot patches append text and reject sequence gaps for a fresh reconnect', () => {
 const reduce = createSnapshotReducer();
 reduce({ messages: [{ id: 'one', text: 'first' }], seq: 1 });
 assert.equal(reduce({ messages: [], textDeltas: [{ id: 'one', append: ' second' }], baseSeq: 1, seq: 2, partial: true }).messages[0].text, 'first second');
 assert.throws(() => reduce({ messages: [], baseSeq: 3, seq: 4, partial: true }), /sequence gap/);
 assert.equal(reduce({ messages: [{ id: 'one', text: 'reset' }], seq: 1, partial: false }).messages[0].text, 'reset');
});


test('drafts take priority over disposable message caches', () => {
  const values = new Map();
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const state = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`thread-${i}`, { ...defaultRuntime(), messages: [{ id: String(i), role: 'assistant', text: 'cached', timestamp: '2026-10-20' }] }]));
    state.draft = { ...defaultRuntime(), draft: 'must survive' };
    saveThreadRuntimeCache(state, 'draft-priority');
    assert.equal(loadThreadRuntimeCache('draft-priority').draft.draft, 'must survive');
  } finally { globalThis.localStorage = oldStorage; }
});

test('snapshot patches remove messages removed by the source', async () => {
  const { createSnapshotReducer } = await moduleFrom('features/connection/snapshotPatch.ts');
  const reduce = createSnapshotReducer();
  reduce({ messages: [{ id: 'removed', text: 'old' }, { id: 'kept', text: 'text' }], seq: 1 });
  const next = reduce({ messages: [], removedIds: ['removed'], baseSeq: 1, seq: 2, partial: true });
  assert.deepEqual(next.messages.map(message => message.id), ['kept']);
});


test('workspace metadata restores selected thread without waiting for network and stays scoped', async () => {
  const { loadWorkspaceCache, saveWorkspaceCache } = await moduleFrom('features/threads/cache.ts');
  const values = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    saveWorkspaceCache('a', { threads: [{ id: 'selected', threadName: 'cached selected' }], selectedId: 'selected', isNewThread: false });
    assert.equal(loadWorkspaceCache('a').threads[0].id, 'selected');
    assert.equal(loadWorkspaceCache('a').selectedId, 'selected');
    assert.equal(loadWorkspaceCache('b').selectedId, null);
  } finally { globalThis.localStorage = previous; }
});
