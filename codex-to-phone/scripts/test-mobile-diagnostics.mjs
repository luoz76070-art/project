import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import ts from 'typescript';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-diagnostics-'));
const webId = 'web-11111111-1111-4111-8111-111111111111';
async function load(file) {
  const outfile = path.join(temp, path.basename(file) + '.mjs');
  await build({ entryPoints: [path.resolve('apps/mobile/src', file)], outfile, bundle: true, format: 'esm', platform: 'node', define: { __WEB_BUILD_ID__: JSON.stringify(webId), 'import.meta.env': '{}' } });
  return import(pathToFileURL(outfile).href);
}
const { makeMessageDiagnostics, readDiagnosticDom } = await load('features/chat/messageDiagnostics.ts');
const { makeDiagnosticsExport, projectDiagnosticEnvironment, readDiagnosticEnvironment, saveDiagnosticFile, webBuildId } = await load('features/chat/diagnosticExport.ts');
const { createConnectionJournal } = await load('features/connection/diagnosticJournal.ts');
test.after(() => fs.rm(temp, { recursive: true, force: true }));
const hash = text => createHash('sha256').update(text).digest('hex');
const message = (id = 'private-message') => ({ id, role: 'user', text: 'private body', kind: 'userMessage', timestamp: '2026-10-29T00:00:00Z' });
const node = id => ({ id, text: 'private body', laidOut: true, inViewport: true });
const input = (messages = [message()], nodes = [node('private-message')]) => ({ threadId: 'private-thread', appVersionCode: 35, runtime: messages, rendered: messages,
  domNodes: nodes, cache: { status: 'missing', messageIdentityVersion: null, invalidMessageCount: 0, messages: [] } });
const context = { platform: 'android', webVersionCode: 35, webBuildId: webId, documentHotVersion: 'web-old', nativeRead: 'ok', gatewayRead: 'ok' };
const gateway = { schema: 'mobile-codex-gateway-diagnostics-v1', buildId: 'gateway-22222222-2222-4222-8222-222222222222', tunnel: { enabled: true, omitted: 0, events: [] } };
const env = () => projectDiagnosticEnvironment({ nativeVersionCode: 41, activeVersion: 'web-new', pendingVersion: 'web-new' }, gateway, context);

const appSource = await fs.readFile('apps/mobile/src/app/App.tsx', 'utf8');
const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let exportFunction;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'exportMessageDiagnostics') exportFunction = node.getText(appAst);
  ts.forEachChild(node, visit);
}
visit(appAst); assert.ok(exportFunction, 'test the actual App export handler');
const actionFile = path.join(temp, 'app-action.mjs');
await build({ stdin: { contents: `
export function driver(environment) {
 const selectedRef = { current: { id: 'thread' } }, diagnosticEpochRef = { current: 0 };
 const scopeAbortRef = { current: new AbortController() }, messageDiagnosticsLock = { current: false };
 const activeRuntimeRef = { current: { messages: [] } }, visibleMessages = [], messagesRef = { current: null };
 const diagnosticJournalRef = { current: { snapshot: () => ({ events: [], omitted: 0 }) } };
 const scope = 'synthetic', appVersionCode = 35, endpoint = 'synthetic', token = 'synthetic';
 const document = { querySelector: () => null }, Capacitor = { getPlatform: () => 'browser' }, NativeHotUpdate = { getStatus: async () => null };
 const buildUrl = () => '', requestGet = async () => { throw new Error('unexpected network'); };
 const readDiagnosticDom = () => [], readThreadMessageCacheForDiagnostics = () => ({});
 let status = '', busy = false, gate = Promise.resolve(environment), failure = '', fileResult = 'saved';
 const writes = [], files = [];
 const setMessageDiagnosticsStatus = value => { status = value; }, setCopyingMessageDiagnostics = value => { busy = value; };
 const makeMessageDiagnostics = async () => ({}), readDiagnosticEnvironment = () => gate;
 const makeDiagnosticsExport = () => ({ summary: 'short summary', detail: 'detail', summaryBytes: 13 });
 const writeClipboard = async text => { if(failure) throw new Error(failure); writes.push(text); };
 const saveDiagnosticFile = async text => { if(failure) throw new Error(failure); files.push(text); return fileResult; };
 ${exportFunction}
 return { run: exportMessageDiagnostics, writes, files, status: () => status, busy: () => busy,
   wait: value => { gate = value; }, fail: value => { failure = value; }, result: value => { fileResult = value; },
   changeThread: () => { selectedRef.current = { id: 'other' }; diagnosticEpochRef.current++; },
   closeSettings: () => { diagnosticEpochRef.current++; }, dispose: () => scopeAbortRef.current.abort() };
}
`, loader: 'ts' }, outfile: actionFile, format: 'esm' });
const { driver } = await import(pathToFileURL(actionFile).href);

test('actual App export discards late captures after thread, settings or workspace changes', async () => {
  for (const change of ['changeThread', 'closeSettings', 'dispose']) {
    const d = driver(env()), gate = Promise.withResolvers(); d.wait(gate.promise);
    const pending = d.run('copy'); assert.equal(d.busy(), true); d[change](); gate.resolve(env()); await pending;
    assert.deepEqual(d.writes, []); assert.equal(d.busy(), false); assert.equal(d.status(), '');
  }
});

test('actual App copy is locked while pending, releases after failure and retries only a short summary', async () => {
  const d = driver(env()), gate = Promise.withResolvers(); d.wait(gate.promise);
  const first = d.run('copy'); await d.run('copy'); gate.resolve(env()); await first;
  assert.deepEqual(d.writes, ['short summary']);
  d.fail('private clipboard error'); await d.run('copy'); assert.equal(d.status(), '摘要复制失败，请重试。'); assert.equal(d.busy(), false);
  d.fail(''); await d.run('copy'); assert.equal(d.writes.length, 2);
});

test('actual App file cancellation, failure and legacy APK support remain retryable without clipboard fallback', async () => {
  const d = driver(env()); d.result('cancelled'); await d.run('file'); assert.match(d.status(), /已取消/);
  d.fail('diagnostic_export_unsupported'); await d.run('file'); assert.match(d.status(), /当前 APK 尚不支持/);
  d.fail('private failure'); await d.run('file'); assert.equal(d.status(), '报告保存失败，请重试。');
  d.fail(''); d.result('saved'); await d.run('file'); assert.equal(d.status(), '详细报告已保存为文件。');
  assert.deepEqual(d.writes, []); assert.equal(d.busy(), false);
});

test('DOM identity distinguishes independent messages from one message rendered twice', async () => {
  const independent = await makeMessageDiagnostics(input([message('one'), message('two')], [node('one'), node('two')]));
  assert.equal(independent.dom.duplicateIds, 0); assert.equal(independent.dom.distinctIds, 2);
  const duplicated = await makeMessageDiagnostics(input([message('one')], [node('one'), node('one')]));
  assert.equal(duplicated.dom.matchedNodes, 2);
  assert.deepEqual(duplicated.dom.duplicates, [{ messageId: hash('one'), nodes: 2, runtime: 1, rendered: 1, indexes: [0, 1] }]);
  assert.deepEqual(duplicated.sameTextGroups[0].counts, { runtime: 1, rendered: 1, cache: 0, dom: 2 });
});

test('DOM snapshots are immutable across hashing and unknown IDs are not guessed from matching text', async () => {
  const data = input([message('one')], [node('unknown')]);
  const pending = makeMessageDiagnostics(data); data.domNodes.push(node('one')); data.domNodes[0].id = 'one'; data.threadId = 'changed';
  const report = await pending;
  assert.equal(report.dom.totalUserTextElements, 1); assert.equal(report.dom.matchedNodes, 0);
  assert.equal(report.dom.recent[0].messageId, hash('unknown')); assert.equal(report.threadSha256, hash('private-thread'));
});

test('DOM capture includes attachment-only user bubbles with layout flags', () => {
  const previous = globalThis.window; globalThis.window = { innerWidth: 360, innerHeight: 800 };
  try {
    const bubble = { getAttribute: name => name === 'data-message-id' ? 'image-only' : null, querySelector: () => null,
      getBoundingClientRect: () => ({ width: 200, height: 100, top: 900, bottom: 1000, left: 0, right: 200 }), getClientRects: () => [{}] };
    assert.deepEqual(readDiagnosticDom({ querySelectorAll: () => [bubble] }), [{ id: 'image-only', text: '', laidOut: true, inViewport: false }]);
  } finally { globalThis.window = previous; }
});

test('installed APK, running web and active versus loaded hot versions retain separate evidence', () => {
  const value = env();
  assert.equal(webBuildId, webId); assert.equal(value.native.versionCode, 41); assert.equal(value.web.versionCode, 35);
  assert.equal(value.web.buildId, webId); assert.deepEqual(value.hot, { active: 'web-new', pending: 'web-new', loaded: 'web-old' });
  assert.equal(projectDiagnosticEnvironment(null, null, { ...context, nativeRead: 'unavailable', gatewayRead: 'unsupported' }).native.versionCode, null);
});

test('version and gateway projections drop credentials, URLs, raw errors and malformed events', () => {
  const value = projectDiagnosticEnvironment({ nativeVersionCode: 41, activeVersion: 'https://private/key', token: 'private-key' }, {
    ...gateway, token: 'private-key', endpoint: 'https://private', tunnel: { enabled: true, events: [
      { at: '2026-10-29T00:00:00Z', seq: 1, generation: 1, state: 'connected', reason: 'open', error: 'private-error', closeCode: 1000 },
      { at: '2026-10-29T00:00:00Z', seq: 2, generation: 1, state: 'private-state', reason: 'private-error' },
    ] },
  }, context);
  assert.equal(value.hot.active, null); assert.equal(value.gateway.tunnel.events.length, 1);
  assert.equal(JSON.stringify(value).includes('private'), false);
});

test('summary and full report enforce UTF-8 caps without leaking source text or mutating input', async () => {
  const messages = Array.from({ length: 300 }, (_, index) => ({ ...message(`private-${index}`), clientMessageId: `private-client-${index}`, text: `秘密-${Math.floor(index / 2)}-🙂` }));
  const report = await makeMessageDiagnostics(input(messages, messages.map(m => ({ ...node(m.id), text: m.text }))));
  const journal = createConnectionJournal(), record = journal.subscribe('desktop');
  for (let i = 0; i < 100; i++) record({ at: '2026-10-29T00:00:00Z', generation: i, state: 'recovering', reason: 'stream-error' });
  const before = JSON.stringify(report), output = makeDiagnosticsExport(report, env(), journal.snapshot());
  assert.ok(Buffer.byteLength(output.summary) <= 2048); assert.ok(Buffer.byteLength(output.detail) <= 65536);
  assert.equal(output.detailBytes, Buffer.byteLength(output.detail)); assert.equal(JSON.stringify(report), before);
  for (const forbidden of ['private-', '秘密', '🙂', 'token', 'endpoint']) assert.equal(output.detail.includes(forbidden), false, forbidden);
  const summary = JSON.parse(output.summary), full = JSON.parse(output.detail);
  assert.equal(summary.users.runtime.total, 300); assert.equal(summary.users.runtime.analyzed, 240);
  assert.equal(full.connection.events.length, 20); assert.equal(full.connection.omitted, 80);
  assert.equal(full.environment.native.versionCode, 41);
});

test('connection journal is bounded, cloned and isolated by workspace instance', () => {
  const journal = createConnectionJournal(), record = journal.subscribe('desktop');
  for (let i = 0; i < 25; i++) record({ at: '2026-10-29T00:00:00Z', generation: i, state: 'online', reason: 'open', url: 'private' });
  const snapshot = journal.snapshot(); assert.equal(snapshot.omitted, 5); assert.equal(snapshot.events[0].seq, 6);
  snapshot.events[0].reason = 'changed'; assert.equal(journal.snapshot().events[0].reason, 'open');
  assert.equal(JSON.stringify(journal.snapshot()).includes('private'), false); assert.equal(createConnectionJournal().snapshot().events.length, 0);
});

test('read failures and legacy gateways stay unknown and a manual retry can succeed', async () => {
  const options = { signal: new AbortController().signal, platform: 'android', webVersionCode: 35, documentHotVersion: null,
    readNative: async () => { throw new Error('private-native-error'); }, readGateway: async () => { throw { status: 404, message: 'private' }; } };
  const missing = await readDiagnosticEnvironment(options);
  assert.equal(missing.native.state, 'unavailable'); assert.equal(missing.gateway.state, 'unsupported');
  const retried = await readDiagnosticEnvironment({ ...options, readNative: async () => ({ nativeVersionCode: 41 }), readGateway: async () => gateway });
  assert.equal(retried.native.versionCode, 41); assert.equal(retried.gateway.buildId, gateway.buildId);
  const unauthorized = await readDiagnosticEnvironment({ ...options, readGateway: async () => { throw { status: 401 }; } });
  assert.equal(unauthorized.gateway.state, 'unauthorized');
});

test('diagnostic reads have a deadline and workspace cancellation rejects late results', async () => {
  let remoteSignal;
  const options = { signal: new AbortController().signal, platform: 'android', webVersionCode: 35, documentHotVersion: null, timeoutMs: 10,
    readNative: () => new Promise(() => {}), readGateway: signal => { remoteSignal = signal; return new Promise(() => {}); } };
  const timedOut = await readDiagnosticEnvironment(options);
  assert.equal(timedOut.native.state, 'unavailable'); assert.equal(timedOut.gateway.state, 'unavailable'); assert.equal(remoteSignal.aborted, true);
  const controller = new AbortController();
  const cancelled = readDiagnosticEnvironment({ ...options, signal: controller.signal, timeoutMs: 1000 }); controller.abort();
  await assert.rejects(cancelled);
});

test('file export rejects oversized UTF-8 and invalid schemas before touching storage', async () => {
  await assert.rejects(saveDiagnosticFile(JSON.stringify({ schema: 'mobile-codex-message-diagnostics-v2', data: '中'.repeat(30000) })), /invalid/);
  await assert.rejects(saveDiagnosticFile('{"schema":"wrong"}'), /invalid/);
});
