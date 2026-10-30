import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDeepSeekBridge } from '../plugins/mobile-deepseek/bridge.mjs';

// Explicit official-algorithm check. Only detached synthetic storage and handles, no model.
const runtime = process.argv[2];
if (!runtime || !path.isAbsolute(runtime) || process.argv.length !== 3) throw new Error('Usage: node scripts/check-deepseek-history.mjs <absolute-isolated-runtime-directory>');
const packages = path.join(runtime, 'node_modules/@deepseek-ai');
const version = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/@deepseek-ai/dsh-llm/package.json'), 'utf8')).version;
assert.ok(['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5'].includes(version), 'Unsupported isolated runtime');
const load = name => import(pathToFileURL(path.join(packages, name, 'lib/index.js')).href);
const official = path.join(packages, 'dsh-api-session-controller/lib/index.js');
assert.equal(JSON.parse(await fs.readFile(path.join(packages, 'dsh-api-session-controller/package.json'), 'utf8')).version, version);
const copy = path.join(path.dirname(official), `mobile-history-check-${randomUUID()}.mjs`);
await fs.writeFile(copy, (await fs.readFile(official, 'utf8')) + '\nexport { ApiSessionList, SessionHistoryController, SessionCommandController };\n');
let ctx, bridge, reader, stream;
const checks = {};
try {
  const [{ Context }, { SessionStore }, { AgentRegistry }, { default: Query }, { default: Projections }, { titleProjectionDefinition }, { SessionPersistence }, { createUserMessage }, { SessionController, ApiSessionList, SessionHistoryController, SessionCommandController }] = await Promise.all([
    load('cordis'), load('dsh-session'), load('dsh-agent'), load('dsh-session-query'), load('dsh-session-projection'), load('dsh-session-title'), load('dsh-session-persistence'), load('dsh-llm'), import(pathToFileURL(copy).href),
  ]);
  ctx = new Context();
  await Promise.all([SessionStore, AgentRegistry, Query, Projections].map(plugin => ctx.plugin(plugin).await()));
  ctx.sessionProjections.register(titleProjectionDefinition);
  const directory = path.join(runtime, 'synthetic-workspace'), persisted = new Map();
  let reads = 0, readHandles = 0, resumes = 0, admissions = 0;
  class MemoryPersistence extends SessionPersistence {
    async list() { return [...persisted.values()].map(value => ({ header: value.header, revision: 'one', formatStatus: 'current' })); }
    async stat(id) { const value = persisted.get(id); return value && { header: value.header, revision: 'one', formatStatus: 'current' }; }
    async open(id, mode) {
      assert.equal(mode, 'read'); const value = persisted.get(id); assert.ok(value); reads++; readHandles++;
      return { header: value.header, inheritedEventCount: 0,
        async read() { return { events: structuredClone(value.events), eventState: 'detached' }; },
        async close() { readHandles--; },
      };
    }
  }
  await ctx.plugin(MemoryPersistence).await();
  for (let n = 0; n < 72; n++) {
    const session = ctx.sessions.prepare(`official-cold-${n}`, { meta: { cwd: n % 2 ? directory : path.join(runtime, 'other-workspace') } });
    for (let i = 0; i < (n === 0 ? 95 : 0); i++) session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `官方分页消息 ${i}` }], source: { kind: 'user' } }), { surfaceOp: 'append' });
    persisted.set(session.id, { header: session.header, events: session.snapshotEvents() });
  }
  const list = new ApiSessionList(ctx, 8), history = new SessionHistoryController(ctx, () => assert.fail('viewing must never promote'));
  const resolver = { async resolveAgent(id) {
    resumes++; const seed = persisted.get(id), session = ctx.sessions.create(id, { meta: seed.header, seed: structuredClone(seed.events) });
    const agent = { id, session, ctx, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, followup(message) {
      admissions++; session.append('user/message', message, { surfaceOp: 'append' });
    }, steer() { assert.fail('cold send uses queue'); }, cancel() { assert.fail('no interruption'); } };
    await ctx.agents.register(agent); return { agent };
  } };
  const commands = new SessionCommandController({ agents: ctx.agents, attachments: { admitPromptContent: async content => content }, fileUploads: { bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) } }, resolver, directory);
  const service = Object.create(SessionController.prototype);
  service.ctx = { invocation: undefined, remoteAccess: { allows: () => true } }; service.listState = list; service.history = history; service.commands = commands;
  // Use public official list/page/prompt methods with their actual inner algorithms.
  ctx.reflect.provide('sessionController', service);
  const token = randomBytes(32).toString('base64url');
  const facade = { agents: ctx.agents, sessionQuery: ctx.sessionQuery, on: (...args) => ctx.on(...args), get: name => ctx.get(name) };
  bridge = createDeepSeekBridge(facade, { port: 0, token, directory, scope: 'all' }, createUserMessage, version);
  const base = `http://127.0.0.1:${(await bridge.ready).port}`;
  const json = async (route, body) => {
    const result = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(4000) });
    const data = await result.json(); assert.equal(result.status, 200, JSON.stringify(data)); return data;
  };
  const first = await json('/sessions?range=all'); assert.equal(first.sessions.length, 50); assert.ok(first.cursor);
  const second = await json('/sessions?range=all&cursor=' + first.cursor); assert.equal(second.sessions.length, 22);
  assert.equal(reads, 0); assert.equal(ctx.agents.list().length, 0); checks.officialMetadataNoLogRead = true;
  const found = await json('/sessions?range=all&search=official-cold-0'); assert.equal(found.sessions.length, 1); const id = found.sessions[0].id;
  const observation = await ctx.sessionQuery.observeSession('official-cold-0', { projectionMode: 'none' });
  try { assert.equal(observation.source, 'prepared'); } finally { observation[Symbol.dispose](); }
  stream = new AbortController();
  const response = await fetch(`${base}/sessions/${id}/events`, { headers: { authorization: `Bearer ${token}` }, signal: stream.signal });
  assert.equal(response.status, 200); reader = response.body.getReader(); let buffer = ''; const decoder = new TextDecoder();
  async function next(predicate) {
    const timer = setTimeout(() => stream.abort(), 4000);
    try { for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) { const item = await reader.read(); assert.equal(item.done, false); buffer += decoder.decode(item.value, { stream: true }); continue; }
      const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      if (frame.startsWith('data: ')) { const value = JSON.parse(frame.slice(6)); if (predicate(value)) return value; }
    } } finally { clearTimeout(timer); }
  }
  const snapshot = await next(() => true), ids = new Set(snapshot.messages.map(message => message.id)); let cursor = snapshot.historyCursor;
  assert.equal(snapshot.messages.length, 40);
  while (cursor) { const page = await json(`/sessions/${id}/history?cursor=${cursor}`); for (const message of page.messages) { assert.ok(!ids.has(message.id)); ids.add(message.id); } cursor = page.cursor; }
  assert.equal(ids.size, 95); assert.equal(ctx.agents.list().length, 0); assert.equal(resumes, 0); assert.equal(readHandles, 0); checks.officialPreparedPagesNoActivation = true;
  const requestId = randomUUID();
  await json(`/sessions/${id}/messages`, { controlToken: snapshot.control.token, clientMessageId: requestId, text: '隔离原线程继续', delivery: 'queue' });
  const confirmed = await next(value => value.submission?.delivery === 'confirmed');
  assert.equal(confirmed.session.id, id); assert.equal(resumes, 1); assert.equal(admissions, 1);
  assert.equal(ctx.agents.get('official-cold-0').session.snapshotEvents().at(-1).data.source.rpcId, requestId); checks.officialPromptRpcConfirmation = true;
  // Actual official public command deduplicates its requestId too; it cannot admit twice.
  resolver.resolveAgent = async id => ({ agent: ctx.agents.get(id) });
  await service.prompt({ sessionId: 'official-cold-0', requestId, mode: 'queue', content: [{ type: 'text', text: '隔离原线程继续' }] }, new AbortController().signal);
  assert.equal(admissions, 1); checks.officialRequestDeduplication = true;
  console.log(JSON.stringify({ version, checks, externalModelRequests: 0, userProfilesChanged: false, originalUserSessionsRead: false }, null, 2));
} finally {
  stream?.abort(); await reader?.cancel().catch(() => {}); await bridge?.stop(); await ctx?.fiber.dispose(); await fs.rm(copy, { force: true });
}
