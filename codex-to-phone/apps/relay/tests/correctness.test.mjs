import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { CodexStore } from '../dist/store/codexStore.js';
import { LiveTurnController } from '../dist/codex/liveTurnController.js';
import { turnProgress } from '../dist/store/turnActivity.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { ordinaryPrompts, contextEnvelopes } from '../../../scripts/fixtures/user-prompts.mjs';

const id = '11111111-1111-1111-1111-111111111111';
const record = (text, type = 'agent_message') => JSON.stringify({ type: 'event_msg', timestamp: '2026-10-20T00:00:00Z', payload: { type, message: text } }) + '\n';
async function fixture(t, content) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-correctness-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sessions'));
  await fs.writeFile(path.join(root, 'session_index.jsonl'), '');
  const file = path.join(root, 'sessions', `rollout-${id}.jsonl`);
  await fs.writeFile(file, content);
  return { file, store: new CodexStore(root) };
}

for (const source of ['response_item', 'event_msg']) test(`ordinary role prompts survive ${source} history, delta and reopen`, async t => {
  const input = [...ordinaryPrompts, ordinaryPrompts[0]];
  const line = (text, index) => JSON.stringify({ type: source, timestamp: `2026-10-29T00:00:${String(index).padStart(2, '0')}Z`, payload: source === 'event_msg'
    ? { type: 'user_message', message: text }
    : { type: 'message', id: `source-${index}`, role: 'user', content: [{ type: 'input_text', text }] } }) + '\n';
  const { store, file } = await fixture(t, [...contextEnvelopes, ...input].map(line).join(''));
  t.after(() => store.close());
  for (const page of [await store.readThreadWithCursor(id), await store.readThreadLatest(id), await store.readThreadDelta(id)]) {
    assert.deepEqual(page.messages.map(m => m.text), input);
  }
  assert.equal((await store.getThreadSummary(id)).threadName, input[0]);
  const latest = await store.readThreadLatest(id);
  await fs.appendFile(file, line(input[0], 40));
  assert.deepEqual((await store.readThreadDelta(id, latest.cursor, undefined, latest.generation)).messages.map(m => m.text), [input[0]]);
  const reopened = new CodexStore(path.dirname(path.dirname(file))); t.after(() => reopened.close());
  assert.deepEqual((await reopened.readThreadLatest(id)).messages.map(m => m.text), [...input, input[0]]);
});

test('ordinary role prompt titles from the index are retained over a fallback', async t => {
  const { store, file } = await fixture(t, record('Fallback title', 'user_message')); t.after(() => store.close());
  await fs.writeFile(path.join(path.dirname(path.dirname(file)), 'session_index.jsonl'), JSON.stringify({ id, thread_name: ordinaryPrompts[0] }) + '\n');
  assert.equal((await store.getThreadSummary(id)).threadName, ordinaryPrompts[0]);
});

test('latest cursor preserves an incomplete UTF-8 record for the next delta', async t => {
  const bytes = Buffer.from(record('中文不能丢失'));
  const split = bytes.indexOf(Buffer.from('文')) + 1;
  const first = record('previous');
  const { file, store } = await fixture(t, Buffer.concat([Buffer.from(first), bytes.subarray(0, split)]));
  const latest = await store.readThreadLatest(id);
  assert.equal(latest.cursor, Buffer.byteLength(first));
  assert.deepEqual(latest.messages.map(m => m.text), ['previous']);
  await fs.appendFile(file, bytes.subarray(split));
  const delta = await store.readThreadDelta(id, latest.cursor, undefined, latest.generation);
  assert.deepEqual(delta.messages.map(m => m.text), ['中文不能丢失']);
  assert.equal(delta.cursor, Buffer.byteLength(first) + bytes.length);
});

test('a record larger than 512 KB advances delta and retains subsequent records', async t => {
  const huge = '中'.repeat(220000);
  const { store } = await fixture(t, record(huge) + record('after'));
  const delta = await store.readThreadDelta(id);
  assert.deepEqual(delta.messages.map(m => m.text), [huge, 'after']);
  assert.equal(delta.cursor, delta.fileSize);
});

test('oversize records return an explicit bounded error', async t => {
  const { store } = await fixture(t, record('x'.repeat(8 * 1024 * 1024 + 1)));
  await assert.rejects(store.readThreadDelta(id), { code: 'JSONL_RECORD_TOO_LARGE' });
});

test('tail offsets count bytes, and message IDs stay stable across read modes', async t => {
  const first = record('中文'.repeat(10000));
  const second = record('中文 second');
  const { store } = await fixture(t, first + second + record('last'));
  const latest = await store.readThreadLatest(id, 16384);
  const delta = await store.readThreadDelta(id, Buffer.byteLength(first));
  assert.equal(latest.windowStart, Buffer.byteLength(first));
  assert.deepEqual(latest.messages, delta.messages);
});

test('truncation and file replacement reset the old log baseline', async t => {
  const { store, file } = await fixture(t, record('old'.repeat(300)));
  const first = await store.readThreadLatest(id);
  await fs.writeFile(file, record('short'));
  const truncated = await store.readThreadDelta(id, first.cursor, undefined, first.generation);
  assert.equal(truncated.reset, true);
  assert.equal(truncated.messages[0].text, 'short');
  await fs.rename(file, `${file}.old`);
  await fs.writeFile(file, record('replacement'.repeat(300)));
  const rotated = await store.readThreadDelta(id, truncated.cursor, undefined, truncated.generation);
  assert.equal(rotated.reset, true);
  assert.equal(rotated.messages[0].text, 'replacement'.repeat(300));
});

test('assistant output alone does not mark a turn complete', async t => {
  const { store, file } = await fixture(t, record('still writing'));
  const delta = await store.readThreadDelta(id);
  assert.equal(delta.turnStatus, undefined);
  await fs.appendFile(file, record('', 'task_complete'));
  assert.equal((await store.readThreadDelta(id, delta.cursor)).turnStatus, 'completed');
});

test('opening a running turn restores status past internal records without changing its history page', async t => {
  const noise = JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'x'.repeat(90000) } }) + '\n';
  const { store } = await fixture(t, record('', 'task_started') + record('user request', 'user_message') + noise.repeat(5));
  t.after(() => store.close());
  const page = await store.readThreadLatest(id, 65536);
  assert.equal(page.turnStatus, 'inProgress');
  assert.equal(page.activity, 'thinking');
  assert.deepEqual(page.messages, []);
  assert.ok(page.windowStart > 0);
  assert.equal(page.cursor, page.fileSize);
});

test('modern tool events expose only coarse activity and explicit completion ends the turn', async t => {
  const tool = JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', input: 'private tool arguments' } }) + '\n';
  const { store, file } = await fixture(t, record('', 'task_started') + record('hello', 'user_message') + tool);
  t.after(() => store.close());
  const page = await store.readThreadLatest(id, 65536, 24);
  assert.equal(page.turnStatus, 'inProgress');
  assert.equal(page.activity, 'working');
  assert.ok(!JSON.stringify(page.messages).includes('private tool arguments'));
  await fs.appendFile(file, record('incremental answer'));
  const delta = await store.readThreadDelta(id, page.cursor, undefined, page.generation);
  assert.equal(delta.activity, 'outputting');
  assert.notEqual(delta.turnStatus, 'completed');
  await fs.appendFile(file, record('', 'task_complete'));
  const end = await store.readThreadDelta(id, delta.cursor, undefined, delta.generation);
  assert.equal(end.turnStatus, 'completed');
  const reopened = await store.readThreadLatest(id, 65536, 24);
  assert.equal(reopened.turnStatus, 'completed');
});

test('item lifecycle phases stay coarse and every terminal event clears activity', () => {
  const item = type => ({ value: { type: 'event_msg', payload: { type: 'item_completed', item: { type, text: 'private content' } } } });
  for (const [type, activity] of [['Reasoning', 'thinking'], ['McpToolCall', 'working'], ['CommandExecution', 'working'], ['FileChange', 'working'], ['AgentMessage', 'outputting']]) {
    assert.deepEqual(turnProgress([item(type)]), { activity });
  }
  for (const [type, turnStatus] of [['task_complete', 'completed'], ['task_completed', 'completed'], ['turn_aborted', 'interrupted'], ['task_failed', 'failed'], ['turn_failed', 'failed']]) {
    const progress = turnProgress([item('McpToolCall'), { value: JSON.parse(record('', type)) }]);
    assert.equal(progress.turnStatus, turnStatus);
    assert.equal(progress.activity, undefined);
  }
  assert.deepEqual(turnProgress([item(123), { value: null }]), {});
});

test('HTTP baseline and JSONL SSE deliver thinking, work, output and completion without IPC', { timeout: 8000 }, async t => {
  const { store, file } = await fixture(t, record('', 'task_started'));
  const root = path.dirname(path.dirname(file));
  const secret = 'isolated-activity-test-token';
  const desktop = { status: async () => ({ ok: false }), getStreamSnapshot: () => null, onStreamSnapshot: () => () => {}, stop: async () => {} };
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: secret, codexHome: root, defaultCwd: root }, services: { store, desktopControl: desktop } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = { authorization: `Bearer ${secret}` };
  const page = (await app.inject({ url: `/api/desktop/threads/${id}?latest=true`, headers })).json();
  assert.equal(page.turnStatus, 'inProgress');
  assert.equal(page.activity, 'thinking');
  const { streamToken } = (await app.inject({ method: 'POST', url: `/api/desktop/threads/${id}/stream-token`, headers })).json();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/desktop/threads/${id}/events?streamToken=${streamToken}&cursor=${page.cursor}&generation=${encodeURIComponent(page.generation)}`, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function delta() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (frame.startsWith('event: delta\n')) return JSON.parse(frame.split('\ndata: ')[1]);
      } else {
        const result = await reader.read();
        assert.equal(result.done, false);
        buffer += decoder.decode(result.value, { stream: true });
      }
    }
  }
  await fs.appendFile(file, JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', input: 'private arguments' } }) + '\n');
  const working = await delta();
  assert.equal(working.activity, 'working');
  assert.ok(!JSON.stringify(working).includes('private arguments'));
  await fs.appendFile(file, record('visible answer'));
  const output = await delta();
  assert.equal(output.activity, 'outputting');
  assert.equal(output.turnStatus, undefined);
  assert.equal(output.messages[0].text, 'visible answer');
  await fs.appendFile(file, record('', 'task_complete'));
  assert.equal((await delta()).turnStatus, 'completed');
  await reader.cancel();
});

class FakeClient extends EventEmitter {
  ready = false;
  starts = 0;
  stops = 0;
  gate = Promise.withResolvers();
  async start() { this.starts++; await this.gate.promise; this.ready = true; }
  isConnected() { return this.ready; }
  async stop() { this.stops++; this.ready = false; }
}

test('ordinary role prompts survive app-server notifications and completed thread refresh', async t => {
  const client = new EventEmitter();
  let connected = false;
  client.start = async () => { connected = true; };
  client.isConnected = () => connected;
  client.stop = async () => { connected = false; };
  const input = [...ordinaryPrompts, ordinaryPrompts[0]], turnId = 'synthetic-prompt-turn';
  const items = [...contextEnvelopes, ...input].map((text, index) => ({ type: 'userMessage', id: `item-${index}`, content: [{ type: 'text', text }] }));
  items.push({ type: 'hookPrompt', id: 'hook', fragments: [{ text: 'synthetic hook' }] });
  client.request = async method => {
    if (method === 'thread/resume') return {};
    if (method === 'turn/start') return { turn: { id: turnId, status: 'inProgress' } };
    if (method === 'thread/read') return { thread: { id, name: 'Synthetic prompts', updatedAt: 1, cwd: '/synthetic', turns: [{ id: turnId, items, startedAt: 1 }] } };
    assert.fail(`unexpected synthetic RPC: ${method}`);
  };
  const controller = new LiveTurnController('/synthetic', () => client);
  t.after(() => controller.stop());
  await controller.startTurn({ threadId: id, message: 'Synthetic seed' });
  for (const item of items) client.emit('notification', { method: 'item/completed', params: { threadId: id, turnId, item } });
  assert.deepEqual(controller.getTurn(turnId).messages.filter(m => m.id.startsWith(`${turnId}-item-`)).map(m => m.text), input);
  client.emit('notification', { method: 'turn/completed', params: { threadId: id, turn: { id: turnId, status: 'completed' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(controller.getTurn(turnId).messages.map(m => m.text), input);
});

test('concurrent status calls await one initialized client and reconnect after loss', async t => {
  const clients = [];
  const controller = new LiveTurnController('/synthetic', () => { const c = new FakeClient(); clients.push(c); return c; });
  t.after(() => controller.stop());
  let completed = 0;
  const a = controller.status().then(x => { completed++; return x; });
  const b = controller.status().then(x => { completed++; return x; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, 0);
  assert.equal(clients.length, 1);
  clients[0].gate.resolve();
  assert.ok((await a).ok && (await b).ok);
  clients[0].ready = false;
  clients[0].emit('disconnect');
  const recovered = controller.status();
  assert.equal(clients.length, 2);
  clients[1].gate.resolve();
  assert.ok((await recovered).ok);
});

test('stop during initialization never publishes the old client', async () => {
  const client = new FakeClient();
  const controller = new LiveTurnController('/synthetic', () => client);
  const pending = controller.status();
  await controller.stop();
  client.gate.resolve();
  assert.equal((await pending).ok, false);
  assert.equal(client.ready, false);
});

const { SubmissionRegistry } = await import('../dist/server/submissions.js');
test('repeated and concurrent message IDs submit once, and mismatched content conflicts', async () => {
  const registry = new SubmissionRegistry();
  const gate = Promise.withResolvers();
  let calls = 0;
  const action = async () => { calls++; await gate.promise; return { ok: true }; };
  const first = registry.execute('one', { thread: 'a', text: 'hello' }, action);
  const second = registry.execute('one', { thread: 'a', text: 'hello' }, action);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  gate.resolve();
  assert.deepEqual(await first, await second);
  assert.equal((await registry.execute('one', { thread: 'a', text: 'hello' }, action)).submission.state, 'confirmed');
  assert.equal(calls, 1);
  await assert.rejects(registry.execute('one', { thread: 'b' }, action), { statusCode: 409 });
});

test('ambiguous failures are never retried under the same ID; capacity is bounded', async () => {
  const registry = new SubmissionRegistry(1);
  let calls = 0;
  const action = async () => { calls++; throw new Error('response lost'); };
  await assert.rejects(registry.execute('one', { text: 'hello' }, action));
  await assert.rejects(registry.execute('one', { text: 'hello' }, action));
  assert.equal(calls, 1);
  assert.equal(registry.receipt('one').state, 'unknown');
  await assert.rejects(registry.execute('two', {}, action), { statusCode: 503 });
});


test('full history remains complete beyond the tail page budget', async t => {
  const first = record('first');
  const filler = record('x'.repeat(200000));
  const { store } = await fixture(t, first + filler.repeat(45) + record('last'));
  t.after(() => store.close());
  const read = await store.readThreadWithCursor(id);
  assert.equal(read.messages[0].text, 'first');
  assert.equal(read.messages.at(-1).text, 'last');
  assert.equal(read.cursor, read.fileSize);
});

test('concurrent starts reserve capacity before initialization completes', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let connected = false;
  let turns = 0;
  const client = new EventEmitter();
  client.start = async () => { await gate; connected = true; };
  client.isConnected = () => connected;
  client.stop = async () => { connected = false; };
  client.request = async method => method === 'turn/start' ? { turn: { id: `turn-${++turns}`, status: 'inProgress' } } : {};
  const controller = new LiveTurnController('/synthetic', () => client);
  t.after(() => controller.stop());
  const starts = Array.from({ length: 32 }, (_, index) => controller.startTurn({ threadId: `thread-${index}`, message: 'synthetic' }));
  await assert.rejects(controller.startTurn({ threadId: 'overflow', message: 'synthetic' }), { statusCode: 503 });
  release();
  await Promise.all(starts);
  assert.equal((await controller.status()).activeTurns, 32);
});

test('rollout user history and delta retain source identity and the original turn without fabricating a client ID', async t => {
  const raw = JSON.stringify({ timestamp: '2026-10-23T05:52:09.088Z', type: 'response_item', payload: { type: 'message', id: 'msg_fixture_steer', role: 'user', content: [{ type: 'input_text', text: '合成引导' }], internal_chat_message_metadata_passthrough: { turn_id: 'fixture-original-turn' } } }) + '\n';
  const { store } = await fixture(t, raw); t.after(() => store.close());
  for (const page of [await store.readThreadWithCursor(id), await store.readThreadLatest(id), await store.readThreadDelta(id)]) {
    assert.equal(page.messages[0].sourceItemId, 'msg_fixture_steer');
    assert.equal(page.messages[0].turnId, 'fixture-original-turn');
    assert.equal(page.messages[0].clientMessageId, undefined);
    assert.match(page.messages[0].id, /^log-/);
  }
});

test('distinct user source items at the same timestamp keep both actual inputs', async t => {
  const line = sourceItemId => JSON.stringify({ timestamp: '2026-10-23T05:52:09.088Z', type: 'response_item', payload: { type: 'message', id: sourceItemId, role: 'user', content: [{ type: 'input_text', text: '重复但真实的输入' }], internal_chat_message_metadata_passthrough: { turn_id: 'fixture-original-turn' } } }) + '\n';
  const { store } = await fixture(t, line('msg_first') + line('msg_second') + line('msg_second')); t.after(() => store.close());
  for (const page of [await store.readThreadWithCursor(id), await store.readThreadLatest(id), await store.readThreadDelta(id)]) {
    assert.deepEqual(page.messages.map(message => message.sourceItemId), ['msg_first', 'msg_second']);
  }
});

test('rollout history and delta preserve the original assistant item identity and phase', async t => {
  const raw = JSON.stringify({ timestamp: '2026-10-22T18:52:19.963Z', type: 'response_item', payload: { type: 'message', id: 'msg_fixture_final', role: 'assistant', phase: 'final_answer', internal_chat_message_metadata_passthrough: { turn_id: 'fixture-turn' }, content: [{ type: 'output_text', text: '同一条回复' }] } }) + '\n';
  const { store } = await fixture(t, raw); t.after(() => store.close());
  for (const page of [await store.readThreadWithCursor(id), await store.readThreadLatest(id), await store.readThreadDelta(id)]) {
    assert.equal(page.messages[0].sourceItemId, 'msg_fixture_final');
    assert.equal(page.messages[0].phase, 'final_answer');
    assert.equal(page.messages[0].turnId, 'fixture-turn');
    assert.match(page.messages[0].id, /^log-/);
  }
});
