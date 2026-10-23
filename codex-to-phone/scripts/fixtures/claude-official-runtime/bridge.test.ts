import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const sessionId = '11111111-1111-4111-8111-111111111111';
const generation = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const secondId = '44444444-4444-4444-8444-444444444444';
const started = { cwd: '/synthetic/claude-project', surface: 'terminal' as const, isInteractive: true };
type Command = { id: string; type: 'snapshot' | 'message' | 'interrupt'; text?: string; turnId?: string };
type Event = { type: string; id?: string; text?: string; turnId?: string | null; delivery?: string; messages?: { text: string }[] };
type Body = { sessionId?: string; version?: string; generation?: string; events?: Event[] };

function fixture(on: On, options: { configured?: boolean; watching?: boolean; version?: string; polls?: Command[][]; pollStatus?: number } = {}) {
  const posts: { route: string; body: Body }[] = [], prompts: string[] = [], aborted: string[] = [];
  const clock = mock.clock(on);
  let reads = 0, pollCount = 0;
  mock.env(on, options.configured === false ? {} : {
    MOBILE_CODEX_CLAUDE_BRIDGE_URL: 'http://127.0.0.1:8787',
    MOBILE_CODEX_CLAUDE_BRIDGE_TOKEN: 'synthetic-only-bridge-token-0123456789',
  });
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('session.version', () => ({ value: { version: options.version ?? '2.1.287', base: options.version ?? '2.1.287', builtAt: '2026-10-21T00:00:00Z' } }));
  on('session.id', () => ({ value: sessionId }));
  on('session.cwd', () => ({ value: started.cwd }));
  on('session.messages', () => {
    reads++;
    return { value: [{ role: 'assistant', text: '原会话最近文本', toolUses: [] }] };
  });
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('turn.complete', ($, e) => ({ text: e.answer }));
  on('prompt.submit', ($, e) => { prompts.push(e.text); return { text: e.text }; });
  on('turn.abort', ($, e) => { aborted.push(e.turnId); return { value: undefined }; });
  on('http.fetch', async ($, e) => {
    // Every host HTTP call is answered here; no socket or external provider exists.
    expect(e.url.startsWith('http://127.0.0.1:8787/api/claude-bridge/')).toBe(true);
    const route = e.url.slice(e.url.lastIndexOf('/'));
    const body: Body = JSON.parse(e.init?.body ?? '{}');
    posts.push({ route, body });
    let result: object = { watching: options.watching !== false }, status = 200;
    if (route === '/register') result = { ...result, generation };
    if (route === '/poll') {
      const commands = options.polls?.[pollCount++];
      if (!commands) await clock.sleep(20000);
      status = options.pollStatus ?? 200;
      result = { ...result, commands: commands ?? [] };
    }
    return { value: { ok: status === 200, status, headers: {}, text: JSON.stringify(result) } };
  });
  return { posts, prompts, aborted, clock, reads: () => reads, events: () => posts.flatMap(post => post.body.events ?? []) };
}

test('unconfigured module leaves the original session untouched', async ($, on) => {
  const f = fixture(on, { configured: false });
  expect(await $.session.start(started)).toEqual({ cwd: started.cwd });
  await f.clock.settle();
  expect(f.posts).toEqual([]);
  expect(f.reads()).toBe(0);
});

test('unsupported host never registers or reads the original transcript', async ($, on) => {
  const f = fixture(on, { version: '2.1.286' });
  await $.session.start(started);
  await f.clock.settle();
  expect(f.posts).toEqual([]);
  expect(f.reads()).toBe(0);
});

test('official sandbox registers this session without reading when no phone watches', async ($, on) => {
  const f = fixture(on, { watching: false });
  await $.session.start(started);
  await f.clock.settle();
  expect(f.posts[0]).toMatchObject({ route: '/register', body: { sessionId, version: '2.1.287' } });
  expect(f.posts.filter(post => post.route === '/poll')).toHaveLength(1);
  expect(f.reads()).toBe(0);
  await $.session.end({ sessionId, reason: 'other', resume: { id: sessionId } });
  await f.clock.settle();
  expect(f.posts.at(-1)?.route).toBe('/end');
});

test('snapshot is on demand and duplicate commands never submit twice', async ($, on) => {
  const input: Command = { id: messageId, type: 'message', text: '手机原会话输入' };
  const f = fixture(on, { polls: [[{ id: secondId, type: 'snapshot' }, input, input]] });
  await $.session.start(started);
  await f.clock.settle();
  await f.clock.advance(40);
  expect(f.reads()).toBe(1);
  expect(f.prompts).toEqual(['手机原会话输入']);
  expect(f.events().find(event => event.type === 'messages')?.messages).toEqual([{ role: 'assistant', text: '原会话最近文本' }]);
  expect(f.events().filter(event => event.type === 'receipt')).toEqual([
    { type: 'receipt', id: messageId, delivery: 'confirmed' },
    { type: 'receipt', id: messageId, delivery: 'uncertain' },
  ]);
});

test('official stream chain passes every original chunk once and only bridges visible text', async ($, on) => {
  const f = fixture(on);
  let modelCalls = 0;
  on('turn.step', async function* ($, e) {
    modelCalls++;
    yield { kind: 'thinking', index: 0, text: 'synthetic private reasoning' };
    yield { kind: 'text', index: 1, text: '实时输出 📱' };
    return { turnId: e.turnId, index: e.index, answer: '实时输出 📱', toolUses: [], stopReason: 'end_turn', usage: null };
  });
  await $.session.start(started);
  await f.clock.settle();
  await $.turn.start({ turnId: 'original-turn', text: 'fixture input' });
  const stream = $.turn.step({ turnId: 'original-turn', index: 0, model: 'local-fixture', messageCount: 1 });
  const chunks = [];
  // The official test Engine returns the terminal value through next(), even
  // though the fixed declarations also advertise a .result convenience field.
  while (true) {
    const item = await stream.next();
    if (item.done) { expect(item.value.answer).toBe('实时输出 📱'); break; }
    chunks.push(item.value);
  }
  expect(chunks).toHaveLength(2);
  expect(modelCalls).toBe(1);
  await f.clock.advance(40);
  expect(f.events().filter(event => event.type === 'text')).toEqual([
    { type: 'text', turnId: 'original-turn', id: 'live:original-turn:0:1', text: '实时输出 📱' },
  ]);
  expect(JSON.stringify(f.events()).includes('synthetic private reasoning')).toBe(false);
});

test('interrupt uses the current turn and rejects a stale queued target', async ($, on) => {
  const f = fixture(on, { polls: [[], [
    { id: messageId, type: 'interrupt', turnId: 'old-turn' },
    { id: secondId, type: 'interrupt', turnId: 'original-turn' },
  ]] });
  await $.session.start(started);
  // First poll schedules the next without advancing virtual time.
  await $.turn.start({ turnId: 'original-turn', text: 'fixture input' });
  await f.clock.settle();
  await f.clock.advance(40);
  expect(f.aborted).toEqual(['original-turn']);
  expect(f.events().filter(event => event.type === 'receipt')).toEqual([
    { type: 'receipt', id: messageId, delivery: 'rejected' },
    { type: 'receipt', id: secondId, delivery: 'confirmed' },
  ]);
});

test('unauthorized gateway stops polling without reading the transcript', async ($, on) => {
  const f = fixture(on, { polls: [[]], pollStatus: 403 });
  await $.session.start(started);
  await f.clock.settle();
  await f.clock.advance(3000);
  expect(f.posts.filter(post => post.route === '/poll')).toHaveLength(1);
  expect(f.reads()).toBe(0);
});
