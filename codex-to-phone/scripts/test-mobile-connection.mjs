import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { ordinaryPrompts, contextEnvelopes } from './fixtures/user-prompts.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-connection-test-'));
async function moduleFrom(file) {
  const outputPath = path.join(temp, file.replaceAll('/', '__').replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [new URL(`../apps/mobile/src/${file}`, import.meta.url).pathname], outfile: outputPath, bundle: true, format: 'esm', platform: 'node', target: 'es2022', define: { 'import.meta.env': '{}' } });
  return import(pathToFileURL(outputPath).href);
}
const { subscribeEvents } = await moduleFrom('features/connection/subscription.ts');
const { saveThreadRuntimeCache, loadThreadRuntimeCache, readThreadMessageCacheForDiagnostics, defaultRuntime, turnProgressPatch, desktopSendControl, desktopRejectedSendPatch, desktopControlPatch, desktopControlOfflinePatch, desktopControlResponsePatch, desktopMessageReceived, desktopInterruptResponsePatch, desktopApprovalsPatch, approvalResponsePatch } = await moduleFrom('features/chat/runtime.ts');
const { makeMessageDiagnostics } = await moduleFrom('features/chat/messageDiagnostics.ts');
const { offlineAgent, agentDelivery, agentHistoryWindow, reconcileAgentDraft, verifyAgentSnapshot, loadAgentDrafts, saveAgentDrafts } = await moduleFrom('features/agents/runtime.ts');
const { groupByProject, projectGroupKey, sessionInRange, retainCodexThread } = await moduleFrom('features/threads/model.ts');
const { loadProjectGroups, saveProjectGroups } = await moduleFrom('features/threads/projectPreferences.ts');
const { groupMessageProcesses } = await moduleFrom('features/chat/processGroups.ts');
const { reconcileMessages } = await moduleFrom('features/chat/messageReconciliation.ts');
const originalMessageStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: () => null };
let messagesForRender;
try { ({ messagesForRender } = await moduleFrom('features/chat/messages.ts')); } finally { globalThis.localStorage = originalMessageStorage; }
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

const processMessage = (id, phase, extra = {}) => ({ id, role: 'assistant', text: id, phase, kind: 'agent_message', timestamp: '2026-10-23T06:00:00Z', ...extra });
test('ordinary role prompts remain visible in local, native and history messages', () => {
  for (const [prefix, kind] of [['local-', 'user_message'], ['desktop-', 'userMessage'], ['log-', 'message']]) {
    const input = ordinaryPrompts.map((text, index) => ({ id: `${prefix}${index}`, role: 'user', text, kind, timestamp: `2026-10-29T00:00:0${index}Z` }));
    assert.deepEqual(messagesForRender(input), input);
  }
});

test('explicit roles, hook items and legacy context envelopes stay outside user bubbles', () => {
  const hidden = contextEnvelopes.map((text, index) => ({ id: `context-${index}`, role: 'user', text, kind: 'message', timestamp: '' }));
  hidden.push(...['system', 'developer'].map(role => ({ id: role, role, text: ordinaryPrompts[0], kind: 'message', timestamp: '' })),
    { id: 'hook', role: 'tool', kind: 'hookPrompt', text: 'synthetic hook', timestamp: '' });
  assert.deepEqual(messagesForRender(hidden), []);
});

test('ordinary role prompts survive cache reopen and keep distinct same-text submissions', () => {
  const original = globalThis.localStorage, values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try {
    const input = [...ordinaryPrompts, ordinaryPrompts[0]].map((text, index) => ({ id: `log-${index}`, sourceItemId: `source-${index}`, turnId: `turn-${index}`, role: 'user', text, kind: 'message', timestamp: `2026-10-29T00:00:0${index}Z` }));
    const question = { id: 'question', role: 'user', text: contextEnvelopes.at(-1), kind: 'message', timestamp: '' };
    saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: '未发送草稿', messages: [...input, question] } }, 'prompt-visibility');
    const restored = loadThreadRuntimeCache('prompt-visibility').thread;
    assert.equal(restored.draft, '未发送草稿');
    assert.deepEqual(messagesForRender(restored.messages).map(m => [m.sourceItemId, m.text]), input.map(m => [m.sourceItemId, m.text]));
    assert.equal(restored.messages.some(m => m.id === question.id), false);
  } finally { globalThis.localStorage = original; }
});

test('streaming commentary remains expanded until an explicit final answer arrives', () => {
  const input = [processMessage('read', 'commentary'), processMessage('check', 'commentary')];
  const active = groupMessageProcesses(input);
  assert.equal(active.length, 1); assert.equal(active[0].completed, false);
  const final = processMessage('result', 'final_answer');
  const finished = groupMessageProcesses([...input, final]);
  assert.equal(finished[0].completed, true); assert.equal(finished[0].id, active[0].id);
  assert.deepEqual(finished[0].messages, input); assert.equal(finished[1].message, final);
  assert.equal(input.length, 2);
});
test('new user requests and interrupted work without a final never inherit another task final', () => {
  const old = processMessage('unfinished', 'commentary');
  const user = processMessage('next request', undefined, { role: 'user' });
  const next = processMessage('new work', 'commentary');
  const groups = groupMessageProcesses([old, user, next, processMessage('new result', 'final_answer')]);
  assert.equal(groups[0].completed, false); assert.equal(groups[1].message, user);
  assert.equal(groups[2].completed, true);
  const running = groupMessageProcesses([processMessage('old result', 'final_answer'), user, next]);
  assert.equal(running[2].completed, false);
});
test('explicit turn identity associates progress across steering inputs without collapsing another turn', () => {
  const groups = groupMessageProcesses([
    processMessage('first', 'commentary', { turnId: 'current' }),
    processMessage('steering', undefined, { role: 'user', turnId: 'current' }),
    processMessage('continue', 'commentary', { turnId: 'current' }),
    processMessage('unrelated', 'commentary', { turnId: 'other' }),
    processMessage('result', 'final_answer', { turnId: 'current' }),
  ]);
  assert.deepEqual(groups.filter(group => group.kind === 'process').map(group => group.completed), [true, true, false]);
  assert.equal(groups[1].message.text, 'steering');
});
test('legacy output, final-looking prose, user inputs and tool events stay independently visible', () => {
  const plain = [processMessage('legacy result', undefined), processMessage('final_answer in text', undefined, { role: 'user' }), processMessage('approval', 'commentary', { role: 'tool' })];
  assert.deepEqual(groupMessageProcesses(plain).map(group => group.message), plain);
  const noExplicitFinal = groupMessageProcesses([processMessage('progress', 'commentary'), plain[0]]);
  assert.equal(noExplicitFinal[0].completed, false); assert.equal(noExplicitFinal[1].message, plain[0]);
});
test('final answer updates keep progress identity and preserve full text, attachments and order', () => {
  const progress = processMessage('step', 'commentary', { text: 'Original\n  spacing', attachments: [{ id: 'image' }] });
  const final = processMessage('final', 'final_answer', { text: 'Partial' });
  const before = groupMessageProcesses([progress, final]);
  const after = groupMessageProcesses([progress, { ...final, text: 'Partial answer completed' }]);
  assert.equal(before[0].id, after[0].id); assert.equal(after[0].messages[0], progress);
  assert.equal(after[1].message.text, 'Partial answer completed');
});
test('known tool logs join commentary and collapse with the same turn final, while cards remain outside', () => {
  const items = [processMessage('read', 'commentary', { turnId: 'a' }),
    processMessage('command', undefined, { role: 'tool', kind: 'commandExecution', turnId: 'a' }),
    processMessage('output', undefined, { role: 'tool', kind: 'function_call_output' }),
    processMessage('done', 'final_answer', { turnId: 'a' }),
    processMessage('permission', undefined, { role: 'tool', kind: 'approval' })];
  assert.deepEqual(messagesForRender(items).map(item => item.id), items.slice(0, 4).map(item => item.id));
  const groups = groupMessageProcesses(items);
  assert.equal(groups.length, 3); assert.deepEqual(groups[0].messages, items.slice(0, 3));
  assert.equal(groups[0].completed, true); assert.equal(groups[1].message, items[3]); assert.equal(groups[2].message, items[4]);
  assert.equal(groupMessageProcesses(items.slice(0, 3))[0].completed, false);
});
test('DeepSeek phase promotion keeps earlier progress but moves the final text outside its process', () => {
  const first = processMessage('step-1', 'commentary', { turnId: '7' });
  const last = processMessage('step-2', 'commentary', { turnId: '7' });
  const running = groupMessageProcesses([first, last]);
  const done = groupMessageProcesses([first, { ...last, phase: 'final_answer' }]);
  assert.equal(running[0].completed, false); assert.equal(done[0].completed, true);
  assert.equal(running[0].id, done[0].id); assert.equal(done[1].message.text, last.text);
  assert.equal(groupMessageProcesses([{ ...last, phase: 'final_answer' }])[0].kind, 'message');
});

test('both Agent catalogs group by full project path while showing folder names and distinguishing collisions', () => {
  const rows = [{ id: 'a', directory: '/work/app/' }, { id: 'b', directory: '/work/app' }, { id: 'c', directory: '/other/app' }, { id: 'd', directory: null }];
  const groups = groupByProject(rows, row => row.directory);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].items.map(row => row.id), ['a', 'b']);
  assert.equal(groups[0].label, 'app'); assert.equal(groups[1].label, 'app');
  assert.notEqual(groups[0].key, groups[1].key);
  assert.equal(groups[0].detail, '/work/app'); assert.equal(groups[1].detail, '/other/app');
  assert.equal(groups[2].label, '未分类项目');
  assert.equal(projectGroupKey('C:\\work\\app\\'), projectGroupKey('C:/work/app'));
  assert.notEqual(projectGroupKey('/'), projectGroupKey(null));
});

test('recent list hides old cached reads but retains selected, running and unconfirmed work', () => {
  const now = Date.now(), runtime = defaultRuntime(), old = new Date(now - 31 * 86400_000).toISOString();
  assert.equal(sessionInRange(new Date(now - 30 * 86400_000).toISOString(), 'recent', now), true);
  assert.equal(sessionInRange(old, 'recent', now), false); assert.equal(sessionInRange(old, 'all', now), true);
  assert.equal(retainCodexThread('a', null, { ...runtime, loaded: true, messages: [{ id: 'old' }] }), false);
  assert.equal(retainCodexThread('a', 'a', runtime), true);
  for (const extra of [{ sending: true }, { turnStatus: 'inProgress' }, { desktopSubmission: { delivery: 'uncertain' } }, { desktopInterrupt: { delivery: 'submitted' } }, { userInputs: [{ id: 'question' }] }, { approvals: [{ id: 'approval' }] }]) assert.equal(retainCodexThread('a', null, { ...runtime, ...extra }), true);
});

test('project collapse preferences are scoped by endpoint/profile and Agent, and cache no controls', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveProjectGroups('profile-A', 'codex', { '/work/app': true, '/expanded': false, control: { token: 'private-control' } }, storage);
  assert.deepEqual(loadProjectGroups('profile-A', 'codex', storage), { '/work/app': true });
  assert.deepEqual(loadProjectGroups('profile-B', 'codex', storage), {});
  assert.deepEqual(loadProjectGroups('profile-A', 'deepseek', storage), {});
  saveProjectGroups('profile-A', 'deepseek', { '/other/app': true }, storage);
  assert.deepEqual(loadProjectGroups('profile-A', 'codex', storage), { '/work/app': true });
  assert.ok(![...values.values()].join('').includes('private-control'));
  saveProjectGroups('profile-A', 'codex', Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`/p/${i}`, true])), storage);
  assert.equal(Object.keys(loadProjectGroups('profile-A', 'codex', storage)).length, 256);
  assert.deepEqual(loadProjectGroups('corrupt', 'codex', { getItem: () => '[' }), {});
});

test('DeepSeek history keeps paging beyond the render window without dropping the newly requested older page', () => {
  const message = i => ({ id: `message-${i}`, text: String(i) });
  let window = Array.from({ length: 40 }, (_, i) => message(960 + i));
  for (let start = 920; start >= 0; start -= 40) {
    window = agentHistoryWindow(window, Array.from({ length: 40 }, (_, i) => message(start + i)), 240);
    assert.equal(window[0].text, String(start)); assert.ok(window.length <= 240);
    assert.equal(new Set(window.map(value => value.id)).size, window.length);
  }
  assert.equal(window[0].text, '0'); assert.equal(window.at(-1).text, '239');
});

const agentSnapshot = () => ({ agentId: 'opencode', session: { id: 'ses_synthetic' }, connected: true, status: 'running', activity: 'working',
  control: { token: 'synthetic-token', canSend: true, canSteer: true, canInterrupt: true }, submission: null,
  messages: [{ id: 'msg_synthetic', text: 'received live text' }], questions: [{ id: 'question' }], permissions: [{ id: 'permission' }],
});
test('Agent disconnection clears live operations and cards while preserving received messages', () => {
  const previous = agentSnapshot(), next = offlineAgent(previous);
  assert.equal(next.connected, false); assert.equal(next.control, null);
  assert.deepEqual(next.questions, []); assert.deepEqual(next.permissions, []); assert.equal(next.messages, previous.messages);
  assert.equal(previous.control.canSend, true);
});
test('Agent HTTP receipt changes delivery only and never invents task completion', () => {
  const next = agentDelivery(agentSnapshot(), 'submission', 'message', { delivery: 'confirmed' });
  assert.equal(next.submission.delivery, 'confirmed'); assert.equal(next.status, 'running'); assert.equal(next.activity, 'working');
});
test('unknown Agent result disables sending and interrupt; late HTTP cannot downgrade an SSE confirmation', () => {
  const pending = agentDelivery(agentSnapshot(), 'submission', 'message', { delivery: 'uncertain' });
  assert.equal(pending.control.canSend, false); assert.equal(pending.control.canInterrupt, false);
  const confirmed = { ...agentSnapshot(), submission: { clientMessageId: 'submission', action: 'message', delivery: 'confirmed' } };
  assert.equal(agentDelivery(confirmed, 'submission', 'message', { delivery: 'uncertain' }), confirmed);
  assert.equal(agentDelivery(confirmed, 'different-submission', 'interrupt', { delivery: 'submitted' }), confirmed);
});
test('late Agent HTTP cannot restore offline controls, questions or approvals', () => {
  const offline = offlineAgent(agentSnapshot());
  assert.equal(agentDelivery(offline, 'submission', 'message', { delivery: 'confirmed' }), offline);
  assert.equal(agentDelivery(null, 'submission', 'message', { delivery: 'confirmed' }), null);
});
test('authoritative Agent receipt clears only the submitted draft and preserves text edited in flight', () => {
  const pending = { clientMessageId: 'submission', text: 'first draft' }, receipt = { clientMessageId: 'submission', action: 'message', delivery: 'confirmed' };
  assert.deepEqual(reconcileAgentDraft('first draft', pending, { ...receipt, delivery: 'uncertain' }), { draft: 'first draft', pending });
  assert.deepEqual(reconcileAgentDraft('first draft', pending, { ...receipt, clientMessageId: 'another' }), { draft: 'first draft', pending });
  assert.deepEqual(reconcileAgentDraft('first draft', pending, receipt), { draft: '', pending: null });
  const next = reconcileAgentDraft('new draft typed while sending', pending, receipt);
  assert.deepEqual(next, { draft: 'new draft typed while sending', pending: null });
  assert.deepEqual(reconcileAgentDraft('first draft', next.pending, receipt), { draft: 'first draft', pending: null });
});
test('Agent snapshot must match both selected agent and selected session', () => {
  assert.equal(verifyAgentSnapshot(agentSnapshot(), 'opencode', 'ses_synthetic').agentId, 'opencode');
  assert.throws(() => verifyAgentSnapshot(agentSnapshot(), 'codex', 'ses_synthetic'));
  assert.throws(() => verifyAgentSnapshot(agentSnapshot(), 'opencode', 'ses_other'));
  assert.throws(() => verifyAgentSnapshot({ ...agentSnapshot(), control: null }, 'opencode', 'ses_synthetic'));
});
test('Agent draft cache is scoped and saves only bounded draft strings, never control/card objects', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveAgentDrafts('A', { 'opencode:ses_synthetic': 'keep draft', control: { token: 'secret-token' }, questions: [{ answers: 'private-answer' }], 'opencode:ses_too-long': 'x'.repeat(20_001) }, storage);
  assert.deepEqual(loadAgentDrafts('A', storage), { 'opencode:ses_synthetic': 'keep draft' });
  assert.deepEqual(loadAgentDrafts('B', storage), {});
  assert.ok(![...values.values()].join('').includes('secret-token')); assert.ok(![...values.values()].join('').includes('private-answer'));
});

test('Claude drafts use their own agent and UUID key without sharing Codex or OpenCode drafts', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const key = 'claude:11111111-1111-4111-8111-111111111111';
  saveAgentDrafts('A', { [key]: 'Claude draft', 'opencode:ses_synthetic': 'OpenCode draft', 'claude:ses_synthetic': 'invalid', 'codex:11111111-1111-4111-8111-111111111111': 'wrong agent' }, storage);
  assert.deepEqual(loadAgentDrafts('A', storage), { [key]: 'Claude draft', 'opencode:ses_synthetic': 'OpenCode draft' });
  assert.deepEqual(loadAgentDrafts('B', storage), {});
});

test('DeepSeek drafts use lifecycle UUID aliases and stay separate from other agents', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const id = '11111111-1111-4111-8111-111111111111';
  saveAgentDrafts('deepseek-scope', { [`deepseek:${id}`]: 'DeepSeek draft', [`claude:${id}`]: 'Claude draft', 'deepseek:ses_synthetic': 'invalid', 'deepseek:../private': 'invalid' }, storage);
  assert.deepEqual(loadAgentDrafts('deepseek-scope', storage), { [`deepseek:${id}`]: 'DeepSeek draft', [`claude:${id}`]: 'Claude draft' });
  assert.deepEqual(loadAgentDrafts('other-scope', storage), {});
});

test('late Agent HTTP cannot resurrect a submission already rejected or expired by the host', () => {
  for (const code of ['rejected', 'expired']) {
    const snapshot = { ...agentSnapshot(), submission: null, operationError: { clientMessageId: 'rejected-id', code } };
    assert.equal(agentDelivery(snapshot, 'rejected-id', 'message', { delivery: 'submitted' }), snapshot);
    assert.equal(agentDelivery(snapshot, 'different-id', 'message', { delivery: 'submitted' }).submission.clientMessageId, 'different-id');
  }
});

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
  const states = [], diagnosticEvents = [];
  const stop = subscribeEvents({ getToken: async () => ({ streamToken: String(++tokens) }), url: x => x,
    events: { desktop: () => snapshots++ }, onState: x => states.push(x), onDiagnostic: event => diagnosticEvents.push(event), retryBaseMs: 1 });
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
  assert.deepEqual(diagnosticEvents.map(event => [event.generation, event.reason]), [[1, 'start'], [1, 'open'], [1, 'stream-error'], [2, 'retry'], [2, 'open'], [2, 'dispose']]);
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

test('question forms and private replies never become an actionable persistent cache', () => {
  const values = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const messages = [
      { id: 'normal', text: 'normal conversation', kind: 'agentMessage', role: 'assistant' },
      { id: 'reply', text: '<send_user_message_question_reply>private form answer</send_user_message_question_reply>', kind: 'userMessage', role: 'user' },
      { id: 'secret', text: 'secret synchronous answer', kind: 'userInputResponse', role: 'tool' },
    ];
    saveThreadRuntimeCache({ thread: { ...defaultRuntime(), messages, userInputs: [{ id: 'active-question', status: 'pending', questions: [{ answer: 'private draft' }] }] } }, 'question-cache');
    const saved = [...values.values()][0];
    assert.ok(!saved.includes('private') && !saved.includes('secret') && !saved.includes('active-question'));
    const restored = loadThreadRuntimeCache('question-cache').thread;
    assert.deepEqual(restored.userInputs, []);
    assert.deepEqual(restored.messages.map(m => m.id), ['normal']);
  } finally { globalThis.localStorage = original; }
});

test('native acknowledgement keeps its message pending without inventing a running or stopped turn', () => {
  const runtime = { ...defaultRuntime(), pendingMessageId: 'message', pendingMessageText: 'input', turnStatus: 'completed' };
  const patch = desktopControlResponsePatch(runtime, { delivery: 'submitted' }, 'message');
  const next = { ...runtime, ...patch };
  assert.equal(next.pendingMessageId, 'message'); assert.equal(next.desktopSubmission.delivery, 'submitted');
  assert.equal(next.turnStatus, 'completed'); assert.equal(next.sending, false);
});

test('native Desktop never sends before a live capability, including after cached startup or stream loss', () => {
  const runtime = { ...defaultRuntime(), draft: 'keep draft', pendingMessageId: 'keep-id' };
  const mode = 'desktop-ipc-follower-control';
  assert.equal(desktopSendControl(runtime, mode).ready, false);
  assert.equal(desktopSendControl(runtime).ready, false);
  const control = { transport: 'native', token: 'live-token', canSend: true, canInterrupt: false, activeTurnId: null, submission: null };
  const idle = { ...runtime, desktopControl: control };
  assert.deepEqual(desktopSendControl(idle, mode), { native: true, ready: true, guard: { controlToken: 'live-token', expectedTurnId: null } });
  const running = { ...idle, desktopControl: { ...control, activeTurnId: 'live-turn' } };
  assert.equal(desktopSendControl(running, mode).guard.expectedTurnId, 'live-turn');
  assert.equal(desktopSendControl({ ...idle, ...desktopControlOfflinePatch(idle) }, mode).ready, false);
  assert.equal(desktopSendControl({ ...idle, desktopSubmission: { delivery: 'uncertain' } }, mode).ready, false);
  assert.equal(runtime.draft, 'keep draft'); assert.equal(runtime.pendingMessageId, 'keep-id');
  assert.equal(desktopSendControl(runtime, 'macos-ui-injector-control').ready, true);
  assert.equal(desktopSendControl({ ...runtime, desktopControl: { ...control, transport: 'legacy' } }, mode).ready, false);
});

test('only an explicit rejection before dispatch releases the matching pending identity for a manual retry', () => {
  const runtime = { ...defaultRuntime(), draft: 'keep draft', pendingMessageId: 'rejected-id', pendingMessageText: 'input' };
  for (const code of ['desktop_control_refresh_required', 'desktop_turn_changed']) {
    const next = { ...runtime, ...desktopRejectedSendPatch(runtime, code, 'rejected-id') };
    assert.equal(next.pendingMessageId, undefined); assert.equal(next.draft, 'keep draft');
  }
  for (const code of [undefined, 'desktop_submission_pending', 'clientMessageId reused with different content']) assert.deepEqual(desktopRejectedSendPatch(runtime, code, 'rejected-id'), {});
  assert.deepEqual(desktopRejectedSendPatch(runtime, 'desktop_turn_changed', 'other-id'), {});
  assert.deepEqual(desktopRejectedSendPatch({ ...runtime, desktopSubmission: { clientMessageId: 'rejected-id', delivery: 'uncertain' } }, 'desktop_turn_changed', 'rejected-id'), {});
  assert.deepEqual(desktopRejectedSendPatch({ ...runtime, desktopControl: { submission: { clientMessageId: 'rejected-id', delivery: 'confirmed' } } }, 'desktop_turn_changed', 'rejected-id'), {});
});

test('authoritative confirmation wins over a late HTTP uncertainty and preserves terminal status', () => {
  let runtime = { ...defaultRuntime(), pendingMessageId: 'message', pendingMessageText: 'input', desktopSubmission: { clientMessageId: 'message', delivery: 'uncertain' }, turnStatus: 'interrupted' };
  const control = { transport: 'native', token: 'connection', canSend: true, canInterrupt: false, activeTurnId: null, submission: { clientMessageId: 'message', delivery: 'confirmed' } };
  runtime = { ...runtime, ...desktopControlPatch(runtime, control) };
  runtime = { ...runtime, ...desktopControlResponsePatch(runtime, { delivery: 'uncertain' }, 'message') };
  assert.equal(runtime.pendingMessageId, undefined); assert.equal(runtime.desktopSubmission, undefined);
  assert.equal(runtime.turnStatus, 'interrupted'); assert.equal(runtime.sending, false);
});

test('losing a stream invalidates control tokens and forms while retaining unconfirmed message identity', () => {
  const runtime = { ...defaultRuntime(), pendingMessageId: 'message', userInputs: [{ id: 'question' }], desktopControl: { token: 'connection', transport: 'native', canSend: true, canInterrupt: true, activeTurnId: 'turn', submission: null } };
  const next = { ...runtime, ...desktopControlOfflinePatch(runtime) };
  assert.equal(next.desktopControl.token, null); assert.equal(next.desktopControl.canSend, false); assert.equal(next.desktopControl.canInterrupt, false);
  assert.deepEqual(next.userInputs, []); assert.equal(next.pendingMessageId, 'message');
});

test('a different client message receipt cannot clear a pending submission', () => {
  const runtime = { ...defaultRuntime(), pendingMessageId: 'mine', pendingMessageText: 'input' };
  const next = { ...runtime, ...desktopControlPatch(runtime, { submission: { clientMessageId: 'other', delivery: 'confirmed' } }) };
  assert.equal(next.pendingMessageId, 'mine'); assert.equal(next.pendingMessageText, 'input');
});

test('desktop control capabilities and generation tokens are never restored from disk', () => {
  const values = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  try {
    saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: 'draft', desktopControl: { token: 'private-control-token', canSend: true }, desktopSubmission: { delivery: 'uncertain' } } }, 'native-control');
    assert.ok(![...values.values()][0].includes('private-control-token'));
    const restored = loadThreadRuntimeCache('native-control').thread;
    assert.equal(restored.desktopControl, undefined); assert.equal(restored.desktopSubmission, undefined);
  } finally { globalThis.localStorage = previous; }
});

test('interrupt acknowledgement stays visible and cannot invent interruption; a later terminal snapshot clears it', () => {
  let runtime = { ...defaultRuntime(), sending: true, turnStatus: 'inProgress' };
  runtime = { ...runtime, ...desktopInterruptResponsePatch(runtime, { delivery: 'submitted' }, 'stop-id') };
  assert.equal(runtime.desktopInterrupt.delivery, 'submitted'); assert.equal(runtime.sending, true); assert.equal(runtime.turnStatus, 'inProgress');
  const control = { transport: 'native', submission: { action: 'interrupt-turn', clientMessageId: 'stop-id', delivery: 'confirmed', turnStatus: 'completed' } };
  runtime = { ...runtime, turnStatus: 'completed', sending: false, ...desktopControlPatch(runtime, control) };
  runtime = { ...runtime, ...desktopInterruptResponsePatch(runtime, { delivery: 'uncertain' }, 'stop-id') };
  assert.equal(runtime.desktopInterrupt, undefined); assert.equal(runtime.turnStatus, 'completed'); assert.equal(runtime.status, '桌面任务已结束');
});

test('a new subscriber restores pending interruption from native metadata without disk state', () => {
  const control = { transport: 'native', submission: { action: 'interrupt-turn', clientMessageId: 'stop-id', delivery: 'uncertain' } };
  const next = { ...defaultRuntime(), ...desktopControlPatch(defaultRuntime(), control) };
  assert.equal(next.desktopInterrupt.clientMessageId, 'stop-id'); assert.equal(next.desktopSubmission, undefined);
});

test('desktop approval reservation survives a racing pending snapshot without inventing turn completion', () => {
  const a = { id: 'approval', source: 'desktop', status: 'pending' };
  let runtime = { ...defaultRuntime(), approvals: [a], sending: true, turnStatus: 'inProgress' };
  runtime = { ...runtime, ...approvalResponsePatch(runtime, a.id, 'submitting') };
  runtime = { ...runtime, ...desktopApprovalsPatch(runtime, [a], true) };
  assert.equal(runtime.approvals[0].status, 'submitting');
  runtime = { ...runtime, ...approvalResponsePatch(runtime, a.id, 'uncertain') };
  runtime = { ...runtime, ...approvalResponsePatch(runtime, a.id, 'submitted') };
  assert.equal(runtime.approvals[0].status, 'uncertain');
  assert.equal(runtime.turnStatus, 'inProgress'); assert.equal(runtime.sending, true);
});

test('late approval HTTP results cannot resurrect a removed card or affect its replacement', () => {
  const runtime = { ...defaultRuntime(), approvals: [{ id: 'new-token', source: 'desktop', status: 'pending' }], turnStatus: 'completed' };
  for (const status of ['submitting', 'submitted', 'uncertain', 'resolved']) {
    const next = { ...runtime, ...approvalResponsePatch(runtime, 'old-token', status) };
    assert.deepEqual(next.approvals, runtime.approvals); assert.equal(next.turnStatus, 'completed');
  }
});

test('desktop approval authority clears on disconnect and requires a fresh snapshot', () => {
  const runtime = { ...defaultRuntime(), approvals: [{ id: 'desktop', source: 'desktop', status: 'pending' }] };
  assert.deepEqual(desktopControlOfflinePatch(runtime).approvals, []);
  assert.deepEqual(desktopApprovalsPatch(runtime, runtime.approvals, false).approvals, []);
  assert.deepEqual(desktopApprovalsPatch(runtime, [], true).approvals, []);
  const next = desktopApprovalsPatch(defaultRuntime(), [{ id: 'fresh-token', source: 'desktop', status: 'uncertain' }], true);
  assert.equal(next.approvals[0].status, 'uncertain');
});

test('approval tokens, commands and permission profiles are never restored from disk', () => {
  const values = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  try {
    saveThreadRuntimeCache({ thread: { ...defaultRuntime(), draft: 'draft', approvals: [{ id: 'approval-token', source: 'desktop', command: 'private-command', preview: 'private-permissions' }] } }, 'desktop-approvals');
    const saved = [...values.values()][0];
    for (const secret of ['approval-token', 'private-command', 'private-permissions']) assert.ok(!saved.includes(secret));
    assert.deepEqual(loadThreadRuntimeCache('desktop-approvals').thread.approvals, []);
  } finally { globalThis.localStorage = previous; }
});

test('pre-identity message caches refresh once while drafts and pending local inputs survive', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const local = { id: 'desktop-local-pending', role: 'user', kind: 'local', text: '等待确认', timestamp: '2026-10-22T18:52:02Z' };
  const stale = { id: 'old-log-final', role: 'assistant', kind: 'message', text: '旧重复缓存', timestamp: '2026-10-22T18:52:19Z' };
  for (const messageIdentityVersion of [undefined, 1, 2]) {
    values.set('mobileCodexThreadRuntimeCacheV2:migration-test', JSON.stringify({ thread: { messageIdentityVersion, messages: [local, stale], cursor: 400, generation: 'old-generation', historyBefore: 100, draft: '保留我的草稿', pendingMessageId: 'pending', pendingMessageText: '等待确认' } }));
    const migrated = loadThreadRuntimeCache('migration-test').thread;
    assert.deepEqual(migrated.messages, [local]); assert.equal(migrated.draft, '保留我的草稿');
    assert.equal(migrated.pendingMessageId, 'pending'); assert.equal(migrated.pendingMessageText, '等待确认');
    assert.equal(migrated.cursor, 0); assert.equal(migrated.generation, undefined); assert.equal(migrated.historyBefore, undefined);
    saveThreadRuntimeCache({ thread: { ...migrated, messages: [local, { ...stale, sourceItemId: 'original' }] } }, 'migration-test');
    assert.equal(loadThreadRuntimeCache('migration-test').thread.messages.length, 2, 'new caches remain usable offline after the one-time refresh');
  }
});

test('current caches retain native aliases for identity-free replay while leaving genuine repeats intact', () => {
  const values = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const native = { id: 'desktop-synthetic-turn-first', turnId: 'synthetic-turn', role: 'user', text: '只发一次', kind: 'userMessage', timestamp: '2026-10-23T08:23:30.882Z' };
    const history = { ...native, id: 'log-synthetic-first', kind: 'message', sourceItemId: 'msg_first', timestamp: '2026-10-23T08:23:30.957Z' };
    const messages = reconcileMessages([native], [history]);
    saveThreadRuntimeCache({ thread: { ...defaultRuntime(), messages, cursor: 400, generation: 'generation', draft: '草稿保留' } }, 'alias-test');
    const restored = loadThreadRuntimeCache('alias-test').thread;
    assert.equal(restored.cursor, 400); assert.equal(restored.draft, '草稿保留');
    assert.equal(restored.messages[0].nativeMessageId, native.id);
    assert.equal(reconcileMessages(restored.messages, [native]).length, 1);
    assert.equal(reconcileMessages(restored.messages, [{ ...native, id: 'desktop-synthetic-turn-second' }]).length, 2);
  } finally { globalThis.localStorage = previous; }
});

test('version 3 cache and render repair HTTP-linked history followed by an early native item', () => {
  const values = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const native = { id: 'desktop-tri-turn-first', turnId: 'tri-turn', role: 'user', text: '合成三路输入', kind: 'userMessage', timestamp: '2026-10-23T10:21:19.174Z' };
    const history = { ...native, id: 'log-tri-first', kind: 'message', sourceItemId: 'msg_tri_first', clientMessageId: 'tri-client', timestamp: '2026-10-23T10:21:19.247Z' };
    const started = { id: 'log-tri-started', role: 'tool', kind: 'task_started', text: 'Codex turn started', timestamp: '2026-10-23T10:21:19.200Z' };
    const pending = { id: 'desktop-local-next', clientMessageId: 'next', role: 'user', kind: 'local', text: '另一条待确认输入', timestamp: '2026-10-23T10:22:00Z' };
    saveThreadRuntimeCache({ thread: { ...defaultRuntime(), messages: [native, started, history, pending], cursor: 500, generation: 'tri-generation', draft: '正在编辑的草稿', pendingMessageId: 'next', pendingMessageText: pending.text } }, 'tri-source');
    const restored = loadThreadRuntimeCache('tri-source').thread;
    assert.equal(restored.cursor, 500); assert.equal(restored.generation, 'tri-generation');
    assert.equal(restored.draft, '正在编辑的草稿'); assert.equal(restored.pendingMessageId, 'next');
    const visible = messagesForRender(restored.messages);
    assert.equal(visible.filter(message => message.text === native.text).length, 1, 'cached duplicates are repaired without invalidating current caches');
    assert.equal(visible.filter(message => message.kind === 'task_started').length, 1);
    assert.ok(visible.some(message => message.id === pending.id));
    const merged = reconcileMessages(restored.messages, [native, history]);
    const input = merged.find(message => message.sourceItemId === history.sourceItemId);
    assert.equal(input.nativeMessageId, native.id); assert.equal(input.clientMessageId, history.clientMessageId);
    assert.equal(desktopMessageReceived({ ...restored, messages: merged }, history.clientMessageId), true);
    const final = { id: 'tri-final', turnId: native.turnId, role: 'assistant', kind: 'agentMessage', phase: 'final_answer', text: '合成完成', timestamp: '2026-10-23T10:21:20Z' };
    const groups = groupMessageProcesses(messagesForRender([...merged, final]));
    assert.equal(groups.filter(group => group.kind === 'message' && group.message.text === native.text).length, 1);
    assert.ok(groups.some(group => group.kind === 'process' && group.messages.some(message => message.id === started.id)));
    assert.ok(groups.some(group => group.kind === 'message' && group.message.id === final.id));
  } finally { globalThis.localStorage = previous; }
});

test('a persisted user message linked to native input remains confirmation evidence after reconciliation', () => {
  const message = { id: 'log-synthetic-user', role: 'user', kind: 'message', sourceItemId: 'msg-synthetic-user', clientMessageId: 'confirmed-input', turnId: 'synthetic-turn', text: '只引导一次', timestamp: '2026-10-23T05:52:09Z' };
  for (const kind of ['message', 'user_message']) assert.equal(desktopMessageReceived({ ...defaultRuntime(), messages: [{ ...message, kind }] }, 'confirmed-input'), true);
  assert.equal(desktopMessageReceived({ ...defaultRuntime(), messages: [{ ...message, kind: 'local' }] }, 'confirmed-input'), false);
  assert.equal(desktopMessageReceived({ ...defaultRuntime(), messages: [message] }, 'different-input'), false);
});

test('queue receipt clears matching pending identity without changing turn lifecycle or newer draft', () => {
  const runtime = { ...defaultRuntime(), draft: '新输入', turnStatus: 'inProgress', sending: true, pendingMessageId: 'mine', pendingMessageText: '旧输入', desktopSubmission: { clientMessageId: 'mine', delivery: 'uncertain' } };
  const control = { transport: 'native', token: 'epoch', canSend: true, submission: null, queue: { available: true, items: [{ clientMessageId: 'mine', text: '旧输入', status: 'waiting' }] } };
  const next = { ...runtime, ...desktopControlPatch(runtime, control) };
  assert.equal(next.pendingMessageId, undefined); assert.equal(next.desktopSubmission, undefined);
  assert.equal(next.draft, '新输入'); assert.equal(next.turnStatus, 'inProgress'); assert.equal(next.sending, true);
  assert.equal(retainCodexThread('old', 'other', { ...defaultRuntime(), desktopControl: control }), true);
  const other = { ...runtime, ...desktopControlPatch(runtime, { ...control, queue: { available: true, items: [{ clientMessageId: 'different' }] } }) };
  assert.equal(other.pendingMessageId, 'mine'); assert.equal(other.desktopSubmission.clientMessageId, 'mine');
});

test('Desktop confirmed receipt clears only the submitted draft, for HTTP and SSE', () => {
  const runtime = { ...defaultRuntime(), draft: '测试发送一次', pendingMessageId: 'mine', pendingMessageText: '测试发送一次', turnStatus: 'inProgress', sending: true };
  const receipt = { clientMessageId: 'mine', action: 'steer-turn', delivery: 'confirmed' };
  for (const patch of [desktopControlResponsePatch(runtime, receipt, 'mine'), desktopControlPatch(runtime, { submission: receipt })]) {
    const next = { ...runtime, ...patch };
    assert.equal(next.draft, ''); assert.equal(next.pendingMessageId, undefined);
    assert.equal(next.turnStatus, 'inProgress'); assert.equal(next.sending, true);
  }
  const newer = { ...runtime, draft: '发送后继续编辑的新输入' };
  assert.equal({ ...newer, ...desktopControlResponsePatch(newer, receipt, 'mine') }.draft, newer.draft);
});

test('Desktop queue confirmation clears the matching draft without showing it as executed', () => {
  const runtime = { ...defaultRuntime(), draft: '等待当前任务结束', pendingMessageId: 'mine', pendingMessageText: '等待当前任务结束', turnStatus: 'inProgress', sending: true };
  const control = { queue: { available: true, items: [{ clientMessageId: 'mine', text: runtime.draft, status: 'waiting' }] }, submission: null };
  for (const patch of [desktopControlPatch(runtime, control), desktopControlResponsePatch(runtime, { action: 'queue-message', delivery: 'confirmed' }, 'mine')]) {
    const next = { ...runtime, ...patch };
    assert.equal(next.draft, ''); assert.equal(next.pendingMessageId, undefined);
    assert.deepEqual(next.messages, []); assert.equal(next.turnStatus, 'inProgress');
  }
});

test('late Desktop confirmation cannot clear another submission or its draft', () => {
  const runtime = { ...defaultRuntime(), draft: '第二条输入', pendingMessageId: 'second', pendingMessageText: '第二条输入', desktopSubmission: { clientMessageId: 'second', delivery: 'submitted' } };
  const next = { ...runtime, ...desktopControlResponsePatch(runtime, { action: 'steer-turn', delivery: 'confirmed' }, 'first') };
  assert.equal(next.draft, runtime.draft); assert.equal(next.pendingMessageId, 'second');
  assert.equal(next.desktopSubmission.clientMessageId, 'second');
});

test('Desktop confirmations compare the complete submitted text and attachments, preserving newer edits', () => {
  const attachment = { id: 'upload', fileName: 'sample.txt', path: '/synthetic/sample.txt' };
  const runtime = { ...defaultRuntime(), draft: '检查附件', attachments: [attachment], pendingMessageId: 'mine', pendingMessageText: '检查附件\n\n已上传附件：\n- sample.txt | /synthetic/sample.txt' };
  const response = { action: 'steer-turn', delivery: 'confirmed' };
  const accepted = { ...runtime, ...desktopControlResponsePatch(runtime, response, 'mine') };
  assert.equal(accepted.draft, ''); assert.deepEqual(accepted.attachments, []);
  for (const edit of [{ draft: '更新的要求' }, { attachments: [attachment, { ...attachment, id: 'second', fileName: 'new.txt', path: '/synthetic/new.txt' }] }]) {
    const current = { ...runtime, ...edit }, next = { ...current, ...desktopControlResponsePatch(current, response, 'mine') };
    assert.equal(next.draft, current.draft); assert.deepEqual(next.attachments, current.attachments);
  }
});

test('Desktop ACK and unknown results retain draft and attachments until an authoritative confirmation', () => {
  for (const delivery of ['submitted', 'uncertain']) {
    const runtime = { ...defaultRuntime(), draft: '需要确认的引导', attachments: [{ id: 'upload' }], pendingMessageId: 'mine', pendingMessageText: '需要确认的引导' };
    const next = { ...runtime, ...desktopControlResponsePatch(runtime, { action: 'steer-turn', delivery }, 'mine') };
    assert.equal(next.draft, runtime.draft); assert.equal(next.attachments, runtime.attachments);
    assert.equal(next.pendingMessageId, 'mine'); assert.equal(next.desktopSubmission.delivery, delivery);
    assert.equal(desktopSendControl(next, 'desktop-ipc-follower-control').ready, false);
  }
});

test('late HTTP uncertainty cannot resurrect a submission after queue admission or canonical projection', () => {
  const receipt = { action: 'steer-turn', delivery: 'uncertain' };
  for (const evidence of [{ desktopControl: { submission: null, queue: { items: [{ clientMessageId: 'mine', text: 'old' }] } } }, { messages: [{ role: 'user', kind: 'userMessage', clientMessageId: 'mine', text: 'old' }] }]) {
    const runtime = { ...defaultRuntime(), draft: '后续新草稿', ...evidence };
    const next = { ...runtime, ...desktopControlResponsePatch(runtime, receipt, 'mine') };
    assert.equal(next.draft, runtime.draft); assert.equal(next.desktopSubmission, undefined);
  }
  const local = { ...defaultRuntime(), messages: [{ role: 'user', kind: 'local', clientMessageId: 'mine' }] };
  assert.equal(desktopControlResponsePatch(local, receipt, 'mine').desktopSubmission.delivery, 'uncertain');
});

const diagnosticHash = text => createHash('sha256').update(text).digest('hex');
test('message diagnostics compare raw cache, runtime, actual render input and DOM without exporting content or credentials', async () => {
  const original = globalThis.localStorage;
  const text = '只用于隔离测试的私有正文';
  const native = { id: 'desktop-private-id', role: 'user', kind: 'userMessage', text, timestamp: '2026-10-23T12:09:48.987Z', turnId: 'private-turn', clientMessageId: 'private-client' };
  const history = { ...native, id: 'log-private-id', kind: 'message', sourceItemId: 'private-source', text: text + '\n', timestamp: '2026-10-23T12:09:49.155Z', token: 'secret-message-token' };
  const messages = [native, history];
  const serialized = JSON.stringify({ target: { messages, messageIdentityVersion: 1, draft: 'private-draft', pendingMessageText: 'private-pending', token: 'secret-cache-token' } });
  const reads = [];
  globalThis.localStorage = { getItem(key) { reads.push(key); return key === 'mobileCodexThreadRuntimeCacheV2:private-scope' ? serialized : null; }, setItem() { assert.fail('diagnostics must not write storage'); } };
  try {
    const cache = readThreadMessageCacheForDiagnostics('private-scope', 'target');
    assert.equal(cache.messageIdentityVersion, 1); assert.equal(cache.messages.length, 2);
    assert.deepEqual(reads, ['mobileCodexThreadRuntimeCacheV2:private-scope'], 'diagnostics only inspect the original body cache');
    assert.equal(loadThreadRuntimeCache('private-scope').target.messages.length, 0, 'diagnostic captures original cache before loader migration');
    reads.length = 0;
    const visible = messagesForRender(messages);
    assert.equal(visible.length, 1);
    const before = JSON.stringify({ messages, visible, cache });
    const report = await makeMessageDiagnostics({ threadId: 'private-thread', appVersionCode: 34, runtime: messages, rendered: visible, domUserTexts: [text], cache });
    assert.equal(report.threadSha256, diagnosticHash('private-thread'));
    assert.deepEqual(report.sameTextGroups[0].counts, { runtime: 2, rendered: 1, cache: 2, dom: 1 });
    const record = report.sameTextGroups[0].records.find(record => record.message.origin === 'history').message;
    assert.equal(record.ids.source, diagnosticHash('private-source'));
    assert.equal(record.rawText.trimmedSha256, report.sameTextGroups[0].displaySha256);
    assert.notEqual(record.rawText.sha256, record.rawText.trimmedSha256);
    const output = JSON.stringify(report);
    for (const value of [text, 'private-', 'secret-', 'token', 'pendingMessageText', 'draft']) assert.equal(output.includes(value), false, value);
    assert.equal(JSON.stringify({ messages, visible, cache }), before);
    assert.deepEqual(reads, [], 'report generation must not read unrelated storage');
  } finally { globalThis.localStorage = original; }
});

test('diagnostics retain independent same-text inputs and distinguish text hidden by attachment presentation', async () => {
  const text = 'same input', secretPath = '/private/attachment-secret.png';
  const base = { role: 'user', kind: 'user_message', text, timestamp: '2026-10-23T12:00:00Z' };
  const messages = [{ ...base, id: 'first', sourceItemId: 'source1', clientMessageId: 'client1' },
    { ...base, id: 'second', sourceItemId: 'source2', clientMessageId: 'client2', timestamp: '2026-10-23T12:01:00Z', text: `${text}\n\n已上传附件：\n- secret.png | ${secretPath}` }];
  const visible = messagesForRender(messages);
  assert.equal(visible.length, 2, 'independent submissions stay independent');
  const report = await makeMessageDiagnostics({ threadId: 'thread', appVersionCode: 34, runtime: messages, rendered: visible, domUserTexts: [text, text], cache: { status: 'missing', messageIdentityVersion: null, messages: [], invalidMessageCount: 0 } });
  assert.deepEqual(report.sameTextGroups[0].counts, { runtime: 2, rendered: 2, cache: 0, dom: 2 });
  const records = report.sameTextGroups[0].records.filter(record => record.stage === 'rendered').map(record => record.message);
  assert.notEqual(records[0].ids.client, records[1].ids.client);
  assert.notEqual(records[0].rawText.sha256, records[1].rawText.sha256);
  assert.equal(records[0].display.sha256, records[1].display.sha256);
  assert.equal(records[1].display.attachments, 1);
  assert.equal(JSON.stringify(report).includes(secretPath), false);
});

test('diagnostic snapshots preserve captured values while hashing yields and can expose DOM-only duplication', async () => {
  const message = { id: 'captured', role: 'user', kind: 'userMessage', text: 'captured text', timestamp: '2026-10-23T12:00:00Z' };
  const input = { threadId: 'thread', appVersionCode: 34, runtime: [message], rendered: [message], domUserTexts: [message.text, message.text], cache: { status: 'missing', messageIdentityVersion: null, messages: [], invalidMessageCount: 0 } };
  const promise = makeMessageDiagnostics(input);
  message.text = 'a later update'; message.id = 'a later ID'; input.runtime.length = 0;
  const report = await promise;
  assert.deepEqual(report.sameTextGroups[0].counts, { runtime: 1, rendered: 1, cache: 0, dom: 2 });
  assert.equal(report.recentRendered[0].ids.id, diagnosticHash('captured'));
  assert.equal(report.recentRendered[0].rawText.sha256, diagnosticHash('captured text'));
});

test('diagnostics bound exported records and explicitly report omitted history/groups', async () => {
  const messages = Array.from({ length: 300 }, (_, index) => ({ id: `id${index}`, role: 'user', kind: 'user_message', text: `synthetic-${Math.floor(index / 2)}`, timestamp: '2026-10-23T12:00:00Z', clientMessageId: `client${index}`, sourceItemId: `source${index}` }));
  const report = await makeMessageDiagnostics({ threadId: 'thread', appVersionCode: 34, runtime: messages, rendered: messages, domUserTexts: messages.map(message => message.text), cache: { status: 'available', messageIdentityVersion: 3, messages, invalidMessageCount: 0 } });
  assert.ok(report.stages.every(stage => stage.totalMessages === 300 && stage.omittedMessages === 60 && stage.analyzedUserMessages === 240));
  assert.equal(report.dom.omittedElements, 60);
  assert.equal(report.sameTextGroups.length, 8); assert.equal(report.omittedGroups, 112);
  assert.ok(report.sameTextGroups.reduce((count, group) => count + group.records.length, 0) <= 40);
  assert.ok(report.sameTextGroups.some(group => group.omittedRecords > 0));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 65536);
});

test('diagnostic cache reader reports missing/corrupt data and does not migrate or clear it', () => {
  const original = globalThis.localStorage;
  try {
    for (const [serialized, status, invalid] of [[null, 'missing', 0], ['{', 'unreadable', 0], ['{"target":{"messages":false}}', 'unreadable', 0], ['{"target":{"messages":[null,{}],"messageIdentityVersion":3}}', 'available', 2]]) {
      globalThis.localStorage = { getItem: () => serialized, setItem: () => assert.fail('no writes') };
      const cache = readThreadMessageCacheForDiagnostics('scope', 'target');
      assert.equal(cache.status, status); assert.equal(cache.invalidMessageCount, invalid); assert.deepEqual(cache.messages, []);
    }
  } finally { globalThis.localStorage = original; }
});

test.after(() => fs.rm(temp, { recursive: true, force: true }));
