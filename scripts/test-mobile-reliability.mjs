import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

// Import the production sync module; keep actual App effect bodies for lifecycle integration.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.join(root, 'apps/mobile/src');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-reliability-'));
const source = await fs.readFile(path.join(mobile, 'app/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = new Map();
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
    const callback = node.arguments[0]?.getText(ast) ?? '';
    if (callback.includes('await watchDesktopDelta(')) effects.set('desktopPoll', callback);
    if (callback.includes('await pollLiveTurn(')) effects.set('livePoll', callback);
    if (callback.includes('const unsubscribe = subscribeEvents(')) effects.set(callback.includes('scheduleSnapshot') ? 'liveStream' : 'desktopStream', callback);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(effects.size, 4, 'actual polling and subscription effects must be covered');
const entry = `
import { createPollScope } from ${JSON.stringify(path.join(mobile, 'features/chat/sync.ts'))};
import { defaultRuntime, desktopControlOfflinePatch, saveThreadRuntimeCache, loadThreadRuntimeCache, threadCacheSaveNotice } from ${JSON.stringify(path.join(mobile, 'features/chat/runtime.ts'))};
import { createSnapshotReducer } from ${JSON.stringify(path.join(mobile, 'features/connection/snapshotPatch.ts'))};
export { defaultRuntime, saveThreadRuntimeCache, loadThreadRuntimeCache, threadCacheSaveNotice };
import { createRuntimeSync } from ${JSON.stringify(path.join(mobile, 'features/chat/runtimeSync.ts'))};
export function driver(seed = defaultRuntime()) {
 let state = seed, response, queueUpdates = false;
 const updates = [], requests = [], subscriptions = [], timers = new Map(), listeners = new Set();
 let nextTimer = 0;
 const document = { hidden: false, addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn) };
 const window = { setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) };
 const selected = { id: 'thread' }, selectedRef = { current: selected }, activeThreadKey = 'thread';
 const desktopPollRef = { current: null }, livePollRef = { current: null };
 const diagnosticJournalRef = { current: { subscribe: () => () => {} } };
 const streamState = 'recovering', liveStreamFallbackTurnId = seed.activeTurnId;
 const canUseEventSource = () => true;
 const desktopPollActiveMs = 1, desktopPollIdleMs = 1, livePollFallbackMs = 1, liveSnapshotThrottleMs = 1;
 const setStreamState = () => {}, setLiveStreamFallbackTurnId = () => {}, setConnectionState = () => {};
 const subscribeEvents = options => { subscriptions.push(options); return () => {}; };
 const requestPost = async () => ({ streamToken: 'synthetic' });
 const endpoint = 'http://synthetic.invalid', token = 'synthetic';
 const scopeAbortRef = { current: new AbortController() };
 const apiGet = (_url, _auth, signal) => { requests.push(signal); return response; }, buildUrl = (base, route) => base + route;
 const statuses = [], setStatus = value => statuses.push(value), loadThreads = async () => {};
 const activeRuntimeRef = { get current() { return state; } };
 function updateRuntime(_key, fn) { if (queueUpdates) updates.push(fn); else state = fn(state); }
 function patchRuntime(key, patch) { updateRuntime(key, runtime => ({ ...runtime, ...patch })); }
 const { applyLiveTurnSnapshot, applyDesktopStreamSnapshot, applyDesktopDelta, watchDesktopDelta, pollLiveTurn } = createRuntimeSync({
   getRuntime: () => activeRuntimeRef.current, getSignal: () => scopeAbortRef.current.signal, updateRuntime,
   read: (route, signal) => apiGet(route, token, signal),
 });
 return { state: () => state, statuses, requests, subscriptions, timers, listeners,
 queue: () => { queueUpdates = true; }, flush: () => { queueUpdates = false; for (const fn of updates.splice(0)) state = fn(state); },
 patch: patch => patchRuntime('thread', patch), disposeScope: () => scopeAbortRef.current.abort(),
 ${[...effects].map(([name, callback]) => `${name}: () => { const activeRuntime = state; return (${callback})(); },`).join('\n')}
 response: value => { response = value; },
 live: value => applyLiveTurnSnapshot('thread', value), desktop: value => applyDesktopStreamSnapshot('thread', value),
 delta: value => applyDesktopDelta('thread', value), poll: (id, signal) => pollLiveTurn('thread', id, signal),
 watch: (cursor, signal) => watchDesktopDelta('thread', cursor, signal) };
}
`;
await build({ stdin: { contents: entry, loader: 'ts', resolveDir: root }, outfile: path.join(temp, 'driver.mjs'), bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' } });
const previousStorage = globalThis.localStorage;
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const { driver, defaultRuntime, saveThreadRuntimeCache, loadThreadRuntimeCache, threadCacheSaveNotice } = await import(pathToFileURL(path.join(temp, 'driver.mjs')));
const turn = (turnId, status) => ({ turnId, threadId: 'thread', status, messages: [], approvals: [], eventCount: 1 });
const delta = (cursor, turnStatus, generation = 'generation', reset = false) => ({ messages: [], cursor, generation, turnStatus, reset });
function deferred(d) {
 let resolve, reject;
 d.response(new Promise((yes, no) => { resolve = yes; reject = no; }));
 return { resolve, reject };
}

test('late old-turn completion cannot clear a new active turn', async () => {
 const d = driver(); d.live(turn('old', 'inProgress'));
 const pending = deferred(d), wait = d.poll('old');
 d.live(turn('new', 'inProgress'));
 pending.resolve({ turn: turn('old', 'completed') }); await wait;
 assert.equal(d.state().activeTurnId, 'new');
 assert.equal(d.state().turnStatus, 'inProgress');
 assert.deepEqual(d.statuses, []);
});

test('late delta cannot regress cursor or lifecycle after a newer update', async () => {
 const d = driver(); d.delta(delta(100, 'completed'));
 const pending = deferred(d), wait = d.watch(100);
 d.delta(delta(300, 'inProgress'));
 pending.resolve(delta(200, 'completed')); await wait;
 assert.equal(d.state().cursor, 300);
 assert.equal(d.state().turnStatus, 'inProgress');
});

test('cancelled polling ignores a successful native-style response', async () => {
 for (const kind of ['live', 'desktop']) {
   const d = driver(); d.live(turn('old', 'inProgress'));
   const controller = new AbortController(), pending = deferred(d);
   const wait = kind === 'live' ? d.poll('old', controller.signal) : d.watch(0, controller.signal);
   const before = d.state(); controller.abort();
   pending.resolve(kind === 'live' ? { turn: turn('old', 'completed') } : delta(200, 'completed'));
   await wait;
   assert.deepEqual(d.state(), before);
   assert.deepEqual(d.statuses, []);
 }
});

test('new desktop snapshots invalidate a poll even when the log cursor is unchanged', async () => {
 const d = driver(); d.delta(delta(100, 'completed'));
 const pending = deferred(d), wait = d.watch(100);
 d.desktop({ threadId: 'thread', status: 'inProgress', eventCount: 20, messages: [] });
 pending.resolve(delta(100, 'completed')); await wait;
 assert.equal(d.state().turnStatus, 'inProgress');
});

test('sync guards run inside queued React state updaters', async () => {
 const d = driver(); d.delta(delta(100, 'completed'));
 const pending = deferred(d), wait = d.watch(100);
 d.queue(); d.desktop({ threadId: 'thread', status: 'inProgress', eventCount: 20, messages: [] });
 pending.resolve(delta(200, 'completed')); await wait; d.flush();
 assert.equal(d.state().turnStatus, 'inProgress');
 assert.equal(d.state().cursor, 100);
 const live = driver(); live.live(turn('old', 'inProgress'));
 const late = deferred(live), liveWait = live.poll('old');
 live.queue(); live.live(turn('new', 'inProgress'));
 late.resolve({ turn: turn('old', 'completed') }); await liveWait; live.flush();
 assert.equal(live.state().activeTurnId, 'new');
 assert.deepEqual(live.statuses, [], 'a discarded snapshot must not announce completion outside the updater');
});

test('current poll keeps working after unrelated draft edits; invalid identities are ignored', async () => {
 const d = driver(); d.live(turn('current', 'inProgress'));
 const pending = deferred(d), wait = d.poll('current');
 d.patch({ draft: 'new edit' }); pending.resolve({ turn: turn('current', 'completed') }); await wait;
 assert.equal(d.state().turnStatus, 'completed'); assert.equal(d.state().draft, 'new edit');
 for (const invalid of [{ ...turn('current', 'completed'), threadId: 'other' }, turn('other', 'completed')]) {
   const next = driver(); next.live(turn('current', 'inProgress'));
   next.response(Promise.resolve({ turn: invalid })); await next.poll('current');
   assert.equal(next.state().activeTurnId, 'current');
 }
});

test('delta cursor is monotonic except for explicit file rotation or truncation resets', () => {
 const d = driver(); d.delta(delta(300, 'inProgress'));
 d.delta(delta(200, 'completed')); assert.equal(d.state().cursor, 300);
 d.delta(delta(400, 'completed', 'other')); assert.equal(d.state().cursor, 300);
 d.delta(delta(10, 'completed', 'other', true)); assert.equal(d.state().cursor, 10);
 d.delta(delta(5, 'inProgress', 'other', true)); assert.equal(d.state().cursor, 5);
 d.delta(delta(20, 'completed', 'other')); assert.equal(d.state().cursor, 20);
});

test('late reset and late errors cannot overwrite a newer state', async () => {
 for (const rejected of [false, true]) {
   const d = driver(); d.delta(delta(300, 'inProgress'));
   const pending = deferred(d), wait = d.watch(300);
   d.delta(delta(500, 'inProgress')); const before = d.state();
   if (rejected) pending.reject(new Error('old request failed')); else pending.resolve(delta(0, 'completed', 'other', true));
   await wait; assert.deepEqual(d.state(), before);
 }
 const d = driver(); d.live(turn('old', 'inProgress'));
 const pending = deferred(d), wait = d.poll('old');
 d.live(turn('new', 'inProgress')); const before = d.state();
 pending.reject(new Error('old turn failed')); await wait; assert.deepEqual(d.state(), before);
});

test('actual poll effect cleanup and workspace abort discard late successes and failures', async () => {
 for (const kind of ['desktop', 'live']) for (const outcome of ['resolve', 'reject']) for (const disposeScope of [false, true]) {
   const d = driver({ ...defaultRuntime(), watchMode: kind === 'desktop' ? 'desktop-tail' : 'none', activeTurnId: kind === 'live' ? 'current' : null, turnStatus: 'inProgress' });
   const pending = deferred(d), cleanup = d[`${kind}Poll`]();
   assert.equal(d.requests.length, 1);
   if (disposeScope) d.disposeScope(); else cleanup();
   assert.equal(d.requests[0].aborted, true);
   const before = d.state();
   if (outcome === 'reject') pending.reject(new Error('late failure'));
   else pending.resolve(kind === 'desktop' ? delta(100, 'completed') : { turn: turn('current', 'completed') });
   await new Promise(resolve => setImmediate(resolve));
   assert.deepEqual(d.state(), before); assert.deepEqual(d.statuses, []);
   assert.equal(d.timers.size, 0);
   cleanup(); assert.equal(d.listeners.size, 0);
 }
});

test('actual SSE online callbacks abort in-flight fallback polls before React cleanup', async () => {
 for (const kind of ['desktop', 'live']) {
   const d = driver({ ...defaultRuntime(), watchMode: kind === 'desktop' ? 'desktop-tail' : 'none', activeTurnId: kind === 'live' ? 'current' : null, turnStatus: 'inProgress' });
   const pending = deferred(d), cleanupPoll = d[`${kind}Poll`](), cleanupStream = d[`${kind}Stream`]();
   d.subscriptions[0].onState('online');
   assert.equal(d.requests[0].aborted, true);
   const before = d.state();
   pending.resolve(kind === 'desktop' ? delta(100, 'completed') : { turn: turn('current', 'completed') });
   await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(d.state(), before);
   cleanupStream(); cleanupPoll();
 }
});

test('active stream delivers successive batched deltas; disposed stream callbacks do nothing', () => {
 const d = driver({ ...defaultRuntime(), watchMode: 'desktop-tail' }), cleanup = d.desktopStream();
 const stream = d.subscriptions[0];
 d.queue(); stream.events.delta(delta(100, 'inProgress')); stream.events.delta(delta(200, 'completed')); d.flush();
 assert.equal(d.state().cursor, 200); assert.equal(d.state().turnStatus, 'completed');
 cleanup(); const before = d.state(); stream.events.delta(delta(300, 'inProgress')); stream.onState('recovering');
 assert.deepEqual(d.state(), before);
});

test('throttled live snapshots and disposed live callbacks cannot update a new turn', () => {
 const d = driver({ ...defaultRuntime(), activeTurnId: 'current', turnStatus: 'inProgress' }), cleanup = d.liveStream();
 const stream = d.subscriptions[0];
 stream.events.turn({ ...turn('current', 'inProgress'), eventCount: 10 });
 d.live(turn('new', 'inProgress'));
 for (const callback of [...d.timers.values()]) callback();
 assert.equal(d.state().activeTurnId, 'new');
 cleanup(); const before = d.state();
 stream.events.turn(turn('current', 'completed')); stream.onState('recovering');
 assert.deepEqual(d.state(), before);
});

test('25 drafts and pending identities survive the body thread limit', () => {
 const state = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`thread-${i}`, { ...defaultRuntime(), draft: `draft-${i}`, pendingMessageId: `client-${i}`, pendingMessageText: `pending-${i}` }]));
 saveThreadRuntimeCache(state, 'many-drafts');
 const loaded = loadThreadRuntimeCache('many-drafts');
 for (const [id, value] of Object.entries(state)) {
   assert.equal(loaded[id]?.draft, value.draft);
   assert.equal(loaded[id]?.pendingMessageId, value.pendingMessageId);
 }
});

test('large history cannot prevent new drafts from being saved', () => {
 const original = globalThis.localStorage.setItem;
 globalThis.localStorage.setItem = (key, value) => {
   const total = [...values].filter(([id]) => id !== key).reduce((sum, [id, text]) => sum + id.length + text.length, key.length + value.length);
   if (total > 5 * 1024 * 1024) throw new DOMException('quota', 'QuotaExceededError');
   values.set(key, value);
 };
 try {
   saveThreadRuntimeCache({ old: { ...defaultRuntime(), draft: 'old' } }, 'large');
   const state = Object.fromEntries(Array.from({ length: 6 }, (_, t) => [`thread-${t}`, { ...defaultRuntime(), draft: `new-draft-${t}`, messages: Array.from({ length: 120 }, (_, i) => ({ id: `message-${t}-${i}`, role: 'assistant', kind: 'message', timestamp: '2026-10-29', text: `${t}-${i}:` + 'x'.repeat(8192) })) }]));
   saveThreadRuntimeCache(state, 'large');
   const loaded = loadThreadRuntimeCache('large');
   for (const id of Object.keys(state)) assert.equal(loaded[id]?.draft, state[id].draft);
 } finally { globalThis.localStorage.setItem = original; }
});

const bodyKey = scope => `mobileCodexThreadRuntimeCacheV2:${scope}`;
const inputKey = scope => `mobileCodexThreadInputCacheV1:${scope}`;
const message = (id, text = '正文') => ({ id, sourceItemId: id, role: 'user', kind: 'message', timestamp: '2026-10-29', text });

test('independent input snapshot overrides stale legacy fields after clear, including failed body writes', () => {
 const scope = 'clear-input';
 const old = { ...defaultRuntime(), messageIdentityVersion: 3, draft: 'old', pendingMessageId: 'old-client', pendingMessageText: 'old pending', messages: [{ ...message('local-old'), sourceItemId: undefined, kind: 'local' }, message('accepted')] };
 values.set(bodyKey(scope), JSON.stringify({ thread: old }));
 assert.equal(loadThreadRuntimeCache(scope).thread.pendingMessageId, 'old-client');
 const original = globalThis.localStorage;
 globalThis.localStorage = { ...original,
   setItem: (key, value) => { if (key === bodyKey(scope)) throw new DOMException('quota', 'QuotaExceededError'); original.setItem(key, value); },
   removeItem: () => { throw new Error('cannot remove old body'); },
 };
 try {
   assert.equal(saveThreadRuntimeCache({ thread: { ...defaultRuntime(), messages: [message('accepted')] } }, scope).status, 'history-reduced');
   const loaded = loadThreadRuntimeCache(scope).thread;
   assert.equal(loaded.draft, ''); assert.equal(loaded.pendingMessageId, undefined);
   assert.deepEqual(loaded.messages.map(item => item.id), ['accepted']);
 } finally { globalThis.localStorage = original; }
});

test('input write failure is visible and retains the last saved inputs; retry recovers', () => {
 const scope = 'write-failure';
 saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: 'saved', pendingMessageId: 'saved-client' } }, scope);
 const original = globalThis.localStorage.setItem;
 const state = { thread: { ...defaultRuntime(), draft: 'new', pendingMessageId: 'same-client', pendingMessageText: 'uncertain' } };
 globalThis.localStorage.setItem = () => { throw new DOMException('disabled', 'SecurityError'); };
 try {
   const result = saveThreadRuntimeCache(state, scope);
   assert.equal(result.status, 'input-failed'); assert.match(threadCacheSaveNotice(result), /尚未保存/);
   assert.equal(loadThreadRuntimeCache(scope).thread.draft, 'saved');
   assert.equal(state.thread.draft, 'new');
 } finally { globalThis.localStorage.setItem = original; }
 assert.equal(saveThreadRuntimeCache(state, scope).status, 'saved');
 assert.equal(loadThreadRuntimeCache(scope).thread.pendingMessageId, 'same-client');
 assert.equal(threadCacheSaveNotice({ status: 'saved' }), '');
});

test('quota retry compacts only this scope and never removes unmigrated saved inputs', () => {
 const scope = 'migration-full';
 values.set(bodyKey(scope), JSON.stringify({ thread: { messageIdentityVersion: 3, draft: 'legacy saved', pendingMessageId: 'legacy-client', messages: [message('large', 'x'.repeat(50000))] } }));
 values.set(bodyKey('unrelated'), 'unrelated-byte-for-byte');
 const original = globalThis.localStorage.setItem;
 globalThis.localStorage.setItem = (key, value) => { if (key === inputKey(scope)) throw new DOMException('quota', 'QuotaExceededError'); original(key, value); };
 try {
   assert.equal(saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: 'edited' } }, scope).status, 'input-failed');
   const recovered = loadThreadRuntimeCache(scope).thread;
   assert.equal(recovered.draft, 'legacy saved'); assert.equal(recovered.pendingMessageId, 'legacy-client');
   assert.equal(values.get(bodyKey('unrelated')), 'unrelated-byte-for-byte');
 } finally { globalThis.localStorage.setItem = original; }
});

test('freeing owned history permits input retry without deleting other scopes', () => {
 const scope = 'retry-quota';
 saveThreadRuntimeCache({ thread: { ...defaultRuntime(), messages: [message('old', 'x'.repeat(6000))], draft: 'saved' } }, scope);
 const original = globalThis.localStorage.setItem;
 let rejected = false;
 globalThis.localStorage.setItem = (key, value) => {
   if (key === inputKey(scope) && values.has(bodyKey(scope))) { rejected = true; throw new DOMException('quota', 'QuotaExceededError'); }
   original(key, value);
 };
 try {
   const result = saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: 'new', pendingMessageId: 'retry-client' } }, scope);
   assert.equal(rejected, true); assert.equal(result.status, 'history-reduced');
   assert.equal(loadThreadRuntimeCache(scope).thread.draft, 'new');
   assert.equal(loadThreadRuntimeCache(scope).thread.pendingMessageId, 'retry-client');
 } finally { globalThis.localStorage.setItem = original; }
});

test('critical input limit reports failure rather than truncating drafts or pending text', () => {
 const scope = 'input-limit';
 saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: 'saved' } }, scope);
 const before = values.get(inputKey(scope));
 const text = '长'.repeat(600000);
 assert.equal(saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: text } }, scope).status, 'input-failed');
 assert.equal(values.get(inputKey(scope)), before);
});

test('damaged history and history browsing cannot suppress independent inputs', () => {
 const scope = 'damaged-body';
 const pending = { ...message('desktop-local-client', 'pending'), kind: 'local', sourceItemId: undefined, clientMessageId: 'client' };
 saveThreadRuntimeCache({ thread: { ...defaultRuntime(), historyBrowsing: true, messages: [message('old-page'), pending], draft: 'edit', pendingMessageId: 'client', pendingMessageText: 'pending' } }, scope);
 assert.deepEqual(loadThreadRuntimeCache(scope).thread.messages.map(item => item.id), [pending.id]);
 values.set(bodyKey(scope), 'invalid json');
 const loaded = loadThreadRuntimeCache(scope).thread;
 assert.equal(loaded.draft, 'edit'); assert.equal(loaded.pendingMessageId, 'client');
 assert.deepEqual(loaded.messages.map(item => item.id), [pending.id]);
 assert.deepEqual(loadThreadRuntimeCache('different-scope'), {});
});

test('body budget and recent access bound history without merging genuine repeats', () => {
 const scope = 'body-access';
 const state = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`thread-${i}`, { ...defaultRuntime(), lastAccessedAt: i, messages: [message(`repeat-${i}-1`), message(`repeat-${i}-2`)] }]));
 state['thread-0'].lastAccessedAt = 100;
 saveThreadRuntimeCache(state, scope);
 const saved = JSON.parse(values.get(bodyKey(scope)));
 assert.equal(Object.keys(saved).length, 24); assert.ok(saved['thread-0']); assert.equal(saved['thread-1'], undefined);
 assert.ok(values.get(bodyKey(scope)).length * 2 <= 2 * 1024 * 1024);
 assert.equal(loadThreadRuntimeCache(scope)['thread-0'].messages.length, 2);
});

test.after(async () => { globalThis.localStorage = previousStorage; await fs.rm(temp, { recursive: true, force: true }); });
