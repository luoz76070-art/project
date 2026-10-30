import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Opt-in official-runtime check, including AgentLoop with a local-only adapter.
// Never installs packages, loads user profiles or registers external providers.
const runtime = process.argv[2];
if (!runtime || !path.isAbsolute(runtime) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/check-deepseek-runtime.mjs <absolute-isolated-runtime-directory>');
}
const modules = path.join(runtime, 'node_modules');
async function manifest(name) { return JSON.parse(await fs.readFile(path.join(modules, name, 'package.json'), 'utf8')); }
const version = (await manifest('@deepseek-ai/dsh')).version;
assert.ok(['0.2.1-rc.2', '0.2.1-rc.3'].includes(version), 'Unsupported isolated runtime');
for (const name of ['dsh', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-session-query', 'dsh-llm', 'dsh-agent-loop-testkit']) {
  assert.equal((await manifest(`@deepseek-ai/${name}`)).version, version, `Unexpected official ${name} version`);
}
assert.equal((await manifest('@deepseek-ai/cordis')).version, '4.0.5');
const load = name => import(pathToFileURL(path.join(modules, '@deepseek-ai', name, 'lib/index.js')).href);
const [{ Context }, { default: Loader }, boot, { AgentRegistry, emitAgentEvent }, { SessionStore }, { default: SessionQuery }, { createUserMessage, LlmAdapter }, testkit] = await Promise.all([
  load('cordis'), load('cordis-plugin-loader'), load('dsh-app-boot'), load('dsh-agent'), load('dsh-session'), load('dsh-session-query'), load('dsh-llm'), load('dsh-agent-loop-testkit'),
]);
function eventReader(response) {
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '';
  return {
    close: () => reader.cancel().catch(() => {}),
    async next() {
      while (true) {
        const boundary = pending.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          if (frame.startsWith('data: ')) return JSON.parse(frame.slice(6));
        } else {
          const { value, done } = await reader.read();
          assert.equal(done, false);
          pending += decoder.decode(value, { stream: true });
        }
      }
    },
  };
}
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-dsh-loader-check-'));
const ctx = new Context();
// Cordis declares FiberState as a TypeScript const enum; no JS export exists.
const pendingState = 0, activeState = 2;
const checks = {};
let stream, streamDeadline;
try {
  const plugin = path.join(sandbox, 'plugin');
  await fs.cp(fileURLToPath(new URL('../plugins/mobile-deepseek', import.meta.url)), plugin, { recursive: true });
  const pluginManifest = JSON.parse(await fs.readFile(path.join(plugin, 'package.json'), 'utf8'));
  assert.equal(boot.evaluatePluginCompatibility(pluginManifest, undefined, version), undefined);
  for (const unsupported of ['0.2.1-rc.1', '0.2.1-rc.4', '0.2.1', '0.2.2']) {
    assert.ok(boot.evaluatePluginCompatibility(pluginManifest, undefined, unsupported));
  }
  checks.officialVersionGate = true;
  // Dependencies resolve only from the supplied isolated official installation.
  await fs.symlink(modules, path.join(sandbox, 'node_modules'));
  const dshHome = path.join(sandbox, 'dsh-home');
  const profileDir = path.join(dshHome, 'profiles', 'mobile-codex-isolation');
  boot.initProfile(profileDir, ['dsh-mobile-codex']);
  await fs.mkdir(path.join(profileDir, 'node_modules'), { recursive: true });
  await fs.symlink(plugin, path.join(profileDir, 'node_modules/dsh-mobile-codex'));
  const anchor = path.join(modules, '@deepseek-ai/dsh/lib/bin.js');
  const profile = boot.loadProfile('dsh', 'mobile-codex-isolation', anchor, dshHome);
  assert.deepEqual(profile.skippedBundles, []);
  const entries = boot.composeEntries([...profile.layers.map(layer => layer.patches), profile.patches]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'dsh-mobile-codex');
  checks.bundleComposition = true;
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const dump = spawnSync(process.execPath, [anchor, '--profile', 'mobile-codex-isolation', '--dump-config'], {
    cwd: sandbox, env: { ...env, DSH_HOME: dshHome }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(dump.status, 0, dump.stderr);
  assert.match(dump.stdout, /name: dsh-mobile-codex/u);
  checks.officialCliDump = true;

  const reserve = http.createServer();
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const token = randomBytes(32).toString('base64url');
  const configFile = path.join(sandbox, 'bridge.json');
  await fs.writeFile(configFile, JSON.stringify({ port, token, directory: sandbox }), { mode: 0o600 });
  entries[0].config = { configFile };
  const loader = ctx.plugin(Loader, { baseUrl: pathToFileURL(path.join(profileDir, 'package.json')).href });
  await loader.await();
  await ctx.loader.root.update(entries);
  await ctx.loader.await();
  const entry = ctx.loader.resolve(entries[0].id);
  assert.equal(entry.fiber.state, pendingState);
  checks.waitsForServices = true;

  const sessions = ctx.plugin(SessionStore);
  const agents = ctx.plugin(AgentRegistry);
  const query = ctx.plugin(SessionQuery);
  await Promise.all([sessions.await(), agents.await(), query.await()]);
  assert.equal(ctx.get('llm'), undefined);
  await entry.fiber.await();
  assert.equal(entry.fiber.state, activeState);
  const base = `http://127.0.0.1:${port}`;
  async function json(route, options = {}) {
    const response = await fetch(base + route, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    return response.json();
  }
  assert.deepEqual(await json('/info'), { protocol: 1, harnessVersion: version, messagePhases: true, interactions: false });
  assert.deepEqual((await json('/sessions')).sessions, []);
  checks.officialLoaderActive = true;

  // Official in-memory registry/session/query; only the driving handle is synthetic.
  // No Agent factory, persistence provider, model or user session is involved.
  const session = ctx.sessions.create('mobile-runtime-synthetic', { meta: { cwd: sandbox } });
  let sends = 0, driveError;
  const handle = {
    id: session.id, session, status: 'idle',
    followup(message) { sends++; try { session.append('user/message', message, { surfaceOp: 'append' }); } catch (error) { driveError = error; throw error; } },
    steer() { throw new Error('Unexpected steer'); }, cancel() { throw new Error('Unexpected cancel'); },
  };
  const unregister = ctx.agents.register(handle);
  await unregister;
  const id = (await json('/sessions')).sessions[0]?.id;
  assert.match(id, /^[0-9a-f-]{36}$/u);
  stream = new AbortController();
  streamDeadline = setTimeout(() => stream.abort(), 8000);
  const response = await fetch(`${base}/sessions/${id}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: stream.signal });
  const feed = eventReader(response), snapshot = () => feed.next();
  let current = await snapshot();
  assert.equal(current.connected, true);
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic official runtime check' }] });
  assert.equal(Object.isFrozen(message), true);
  const clientMessageId = randomUUID();
  const result = await json(`/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ clientMessageId, controlToken: current.control.token, text: 'synthetic official runtime check', delivery: 'queue' }) });
  if (driveError) throw driveError;
  assert.equal(result.delivery, 'confirmed');
  while (current.submission?.delivery !== 'confirmed') current = await snapshot();
  assert.equal(sends, 1);
  assert.deepEqual(current.messages.map(item => item.text), ['synthetic official runtime check']);
  checks.officialSessionQueryAndEventBus = true;
  handle.status = 'running';
  emitAgentEvent(ctx, handle, 'agent/status', { status: 'running' });
  let revision = 0;
  const emitFrame = frame => emitAgentEvent(ctx, handle, 'agent/assistant-stream', { frame: { attemptId: 'synthetic-attempt', revision: ++revision, ...frame } });
  emitFrame({ type: 'start', turn: 1, step: 1 });
  emitFrame({ type: 'chunk', index: 0, time: Date.now(), chunk: { type: 'reasoning-delta', index: 0, text: 'synthetic hidden reasoning' } });
  emitFrame({ type: 'chunk', index: 1, time: Date.now(), chunk: { type: 'text-delta', index: 1, text: '官方事件总线 📱' } });
  while (current.activity !== 'outputting') current = await snapshot();
  assert.equal(current.status, 'running');
  assert.deepEqual(current.messages.map(item => item.text), ['synthetic official runtime check', '官方事件总线 📱']);
  emitFrame({ type: 'end', index: 2, outcome: { kind: 'abandoned' } });
  handle.status = 'idle';
  emitAgentEvent(ctx, handle, 'agent/status', { status: 'idle' });
  while (current.status !== 'idle') current = await snapshot();
  assert.deepEqual(current.messages.map(item => item.text), ['synthetic official runtime check']);
  checks.officialScopedStreamAndStatus = true;
  stream.abort();
  clearTimeout(streamDeadline);
  await feed.close();

  await query.dispose();
  await entry.fiber.await();
  assert.equal(entry.fiber.state, pendingState);
  await assert.rejects(fetch(`${base}/info`, { signal: AbortSignal.timeout(2000) }));
  checks.dependencyLossClosesListener = true;
  const replacement = ctx.plugin(SessionQuery);
  await replacement.await();
  await entry.fiber.await();
  assert.equal(entry.fiber.state, activeState);
  assert.deepEqual(await json('/info'), { protocol: 1, harnessVersion: version, messagePhases: true, interactions: false });
  await loader.dispose();
  await assert.rejects(fetch(`${base}/info`, { signal: AbortSignal.timeout(2000) }));
  checks.reloadAndAsyncUnload = true;
  await unregister();

  const loopCtx = new Context();
  let fixtureRequests = 0;
  let phase = 'setup', realAgent, live;
  try {
    await testkit.mountAgentLoopTestDependencies(loopCtx);
    testkit.provideWorkingDirectoryFixture(loopCtx, sandbox);
    const harness = await testkit.mountAgentLoopTestHarness(loopCtx);
    await loopCtx.plugin(SessionQuery).await();
    const releases = [];
    class LocalAdapter extends LlmAdapter {
      resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }); }
      async * stream(options) {
        const index = fixtureRequests++;
        assert.ok(index < 3, 'Unexpected extra fixture request');
        const visible = ['首轮输出', '追加后的输出', '新任务输出'][index];
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: visible };
        await new Promise((resolve, reject) => {
          const abort = () => reject(new Error('synthetic request aborted'));
          releases[index] = () => { options.signal.removeEventListener('abort', abort); resolve(); };
          if (options.signal.aborted) abort();
          else options.signal.addEventListener('abort', abort, { once: true });
        });
        yield { type: 'block-end', index: 0, block: { type: 'text', text: visible } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    loopCtx.llm.registerAdapter(['mobile-runtime-local'], new LocalAdapter());
    assert.deepEqual(loopCtx.llm.listProviders().map(provider => provider.id), ['mobile-runtime-local']);
    realAgent = await harness.create('mobile-real-driver-fixture', { provider: 'mobile-runtime-local', model: 'fixture' }, { cwd: sandbox });
    const realLoader = loopCtx.plugin(Loader, { baseUrl: pathToFileURL(path.join(profileDir, 'package.json')).href });
    await realLoader.await();
    await loopCtx.loader.root.update(entries);
    await loopCtx.loader.await();
    await loopCtx.loader.resolve(entries[0].id).fiber.await();
    const realId = (await json('/sessions')).sessions[0].id;
    stream = new AbortController();
    streamDeadline = setTimeout(() => stream.abort(), 12000);
    const realFeed = eventReader(await fetch(`${base}/sessions/${realId}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: stream.signal }));
    live = await realFeed.next();
    async function waitFor(predicate) { while (!predicate(live)) live = await realFeed.next(); }
    async function send(text, delivery = 'queue') {
      const clientMessageId = randomUUID();
      const receipt = await json(`/sessions/${realId}/messages`, { method: 'POST', body: JSON.stringify({ clientMessageId, controlToken: live.control.token, text, delivery }) });
      assert.ok(['submitted', 'confirmed'].includes(receipt.delivery));
      return clientMessageId;
    }
    async function interrupt(controlToken = live.control.token) {
      return json(`/sessions/${realId}/interrupt`, { method: 'POST', body: JSON.stringify({ clientMessageId: randomUUID(), controlToken }) });
    }
    phase = 'queue';
    const first = await send('原驱动首条输入');
    await waitFor(value => value.submission?.clientMessageId === first && value.submission.delivery === 'confirmed' && value.activity === 'outputting');
    assert.equal(fixtureRequests, 1);
    assert.equal(realAgent.status, 'running');
    checks.realAgentLoopQueue = true;
    const oldTurnToken = live.control.token;
    phase = 'steer';
    const steer = await send('原任务追加', 'steer');
    releases[0]();
    await waitFor(value => value.submission?.clientMessageId === steer && value.submission.delivery === 'confirmed' && value.messages.some(message => message.text === '追加后的输出'));
    assert.equal(fixtureRequests, 2);
    assert.equal(live.messages.filter(message => message.text === '首轮输出').length, 1);
    checks.realAgentLoopSteerAndCanonicalText = true;
    const preserved = createUserMessage({ content: [{ type: 'text', text: '原宿主排队输入' }], source: { kind: 'user' } });
    realAgent.inbox.append('next-turn', preserved);
    phase = 'interrupt-keeps-inbox';
    await interrupt();
    await waitFor(value => value.status === 'idle' && value.submission?.action === 'interrupt' && value.submission.delivery === 'confirmed');
    assert.equal(realAgent.inbox.nextTurn[0]?.id, preserved.id);
    assert.equal(fixtureRequests, 2);
    realAgent.inbox.remove(preserved.id); // The fixture owner removes only its own parked input.
    checks.realAgentLoopInterruptKeepsInbox = true;
    phase = 'new-turn';
    const next = await send('后续新任务');
    await waitFor(value => value.submission?.clientMessageId === next && value.submission.delivery === 'confirmed' && value.messages.some(message => message.text === '新任务输出'));
    const stale = await fetch(`${base}/sessions/${realId}/interrupt`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ clientMessageId: randomUUID(), controlToken: oldTurnToken }), signal: AbortSignal.timeout(3000) });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'DEEPSEEK_STALE_CONTROL');
    assert.equal(realAgent.status, 'running');
    phase = 'new-turn-interrupt';
    await interrupt();
    await waitFor(value => value.status === 'idle' && value.submission?.delivery === 'confirmed');
    assert.equal(fixtureRequests, 3);
    checks.realAgentLoopRejectsOldTurnControl = true;
    stream.abort(); clearTimeout(streamDeadline); await realFeed.close();
  } catch (error) {
    throw new Error(JSON.stringify({ phase, fixtureRequests, agentStatus: realAgent?.status, snapshotStatus: live?.status, submission: live?.submission, texts: live?.messages?.map(message => message.text) }), { cause: error });
  } finally { await loopCtx.fiber.dispose(); }
  console.log(JSON.stringify({ version, cordis: '4.0.5', checks, externalModelRequests: 0, fixtureModelRequests: fixtureRequests, userProfilesChanged: false, originalSessionControlVerified: false }, null, 2));
} finally {
  clearTimeout(streamDeadline);
  stream?.abort();
  await ctx.fiber.dispose();
  await fs.rm(sandbox, { recursive: true, force: true });
}
