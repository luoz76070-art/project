import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const agentSource = await readFile(path.join(root, 'apps/mobile/src/features/agents/AgentWorkspace.tsx'), 'utf8');
const agentAst = ts.createSourceFile('AgentWorkspace.tsx', agentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const productSource = await readFile(path.join(root, 'apps/mobile/src/features/product/ProductRemoteShell.tsx'), 'utf8');
const productAst = ts.createSourceFile('ProductRemoteShell.tsx', productSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let productLifecycle;
function visitProduct(node) {
  if (ts.isCallExpression(node) && node.expression.getText(productAst) === 'useEffect' && node.arguments[0]?.getText(productAst).includes('ProductHost.getState')) productLifecycle = node.arguments[0].getText(productAst);
  ts.forEachChild(node, visitProduct);
}
visitProduct(productAst); assert.ok(productLifecycle);
let agentDraftLifecycle;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(agentAst) === 'useEffect') {
    const callback = node.arguments[0]?.getText(agentAst) ?? '';
    if (callback.includes('saveAgentDrafts') && callback.includes('beforeNavigate')) agentDraftLifecycle = callback;
  }
  ts.forEachChild(node, visit);
}
visit(agentAst);
assert.ok(agentDraftLifecycle, 'cover the actual Agent draft lifecycle effect');
const temp = await mkdtemp(path.join(tmpdir(), 'mobile-product-'));
const shim = path.join(temp, 'capacitor.mjs');
await writeFile(shim, 'export const registerPlugin = () => new Proxy({}, {get: (_, name) => (...args) => globalThis.__productHost[name](...args)});');
await build({ stdin: { contents: `
import { saveAgentDrafts } from './apps/mobile/src/features/agents/runtime';
import { productBeforeNavigate } from './apps/mobile/src/features/product/host';
import { applyProductAppearance, isKelivoHost, ProductHost, productAppearanceChanged, setProductSettingsLaunch, type ProductAppearance } from './apps/mobile/src/features/product/host';
export * from './apps/mobile/src/features/product/host';
export * from './apps/mobile/src/shared/format';
export * from './apps/mobile/src/features/chat/readingPositions';
export * from './apps/mobile/src/features/chat/runtime';
export * from './apps/mobile/src/features/agents/runtime';
export function bindAgentDraftLifecycle(scope, draftsRef, setError = () => {}) { return (${agentDraftLifecycle})(); }
export function bindProductLifecycle(onComputerSettings, onHandoff, setReady, setError, setUpdates = () => {}) { return (${productLifecycle})(); }
`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(temp, 'product.mjs'),
  alias: { '@capacitor/core': shim }, define: { 'import.meta.env': '{"VITE_KELIVO_HOST":"android"}' } });
const m = await import(pathToFileURL(path.join(temp, 'product.mjs')));
test.after(() => rm(temp, { recursive: true, force: true }));
function fixture(t) {
  const saved = { localStorage: globalThis.localStorage, window: globalThis.window, document: globalThis.document };
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  globalThis.window = new EventTarget();
  t.after(() => { Object.assign(globalThis, saved); delete globalThis.__productHost; });
  return values;
}
test('navigation flushes before the native switch; failed input saving cancels it', async t => {
  fixture(t); const order = [];
  globalThis.__productHost = { navigate: async value => order.push(value.tab) };
  window.addEventListener(m.productBeforeNavigate, () => order.push('saved'));
  await m.navigateProduct('settings'); assert.deepEqual(order, ['saved', 'settings']);
  window.addEventListener(m.productBeforeNavigate, event => event.preventDefault());
  await assert.rejects(m.navigateProduct('ai'), /输入保存/);
  assert.deepEqual(order, ['saved', 'settings', 'saved']);
});
test('appearance uses the Flutter brightness and valid palette, including system mode', t => {
  fixture(t); const values = new Map();
  globalThis.document = { documentElement: { dataset: {}, style: { setProperty: (k,v) => values.set(k,v), removeProperty: k => values.delete(k) } } };
  const appearance = { mode: 'system', dark: false, colors: { primary: '#123456', background: 'url(unsafe)' } };
  m.applyProductAppearance(appearance); assert.equal(values.get('--accent'), '#123456'); assert.equal(values.has('--bg-0'), false);
  assert.equal(document.documentElement.dataset.theme, 'light');
  m.applyProductAppearance({ ...appearance, dark: true, colors: {primary:'#abcdef'} });
  assert.equal(document.documentElement.dataset.theme, 'dark'); assert.equal(values.get('--accent'), '#abcdef');
});
test('AI semantic surfaces stay independent from the accent container and clear on an older palette', t => {
  fixture(t); const values = new Map();
  globalThis.document = { documentElement: { dataset: {}, style: {setProperty: (k,v) => values.set(k,v), removeProperty: k => values.delete(k)} } };
  for (const dark of [false, true]) {
    m.applyProductAppearance({ dark, colors: { primaryContainer: '#123456', userBubble: '#aabbcc', avatar: '#ccddee', composer: '#ddeeff', composerOutline: '#8899aa', secondaryText: '#778899', messageAuthor: '#334455', navigationIndicator: '#abcdef', navigationText: '#112233' } });
    assert.equal(values.get('--accent-soft'), '#123456');
    assert.equal(values.get('--user-bubble'), '#aabbcc');
    assert.equal(values.get('--avatar-surface'), '#ccddee');
    assert.equal(values.get('--composer-surface'), '#ddeeff');
    assert.equal(values.get('--process-surface'), '#ddeeff');
    assert.equal(values.get('--composer-outline'), '#8899aa');
    assert.equal(values.get('--navigation-indicator'), '#abcdef');
    assert.equal(values.get('--navigation-text'), '#112233');
    assert.equal(values.get('--subtle'), '#778899');
    assert.equal(values.get('--message-author'), '#334455');
  }
  m.applyProductAppearance({ dark: false, colors: { primaryContainer: '#123456' } });
  for (const key of ['--user-bubble', '--avatar-surface', '--composer-surface', '--composer-outline', '--navigation-indicator', '--navigation-text', '--message-author']) assert.equal(values.has(key), false);
});
test('message timestamps show local date and seconds without throwing on absent or invalid input', () => {
  assert.equal(m.formatMessageTime('2026-11-06T13:57:10'), '2026-11-06 13:57:10');
  assert.equal(m.formatMessageTime(''), '');
  assert.equal(m.formatMessageTime('invalid'), '');
});
test('actual product effect receives Flutter updates, ignores stale startup palette and removes its listener', async t => {
  fixture(t); let release; const ready = [], errors = [];
  globalThis.document = { documentElement: { dataset: {}, style: {setProperty() {}, removeProperty() {}} } };
  globalThis.__productHost = { getState: () => new Promise(resolve => { release = resolve; }) };
  const cleanup = m.bindProductLifecycle(() => {}, () => {}, value => ready.push(value), value => errors.push(value));
  const changed = dark => window.dispatchEvent(Object.assign(new Event(m.productAppearanceChanged), {detail:{mode:'system',dark}}));
  changed(true); assert.equal(document.documentElement.dataset.theme, 'dark');
  release({revision:1,appearance:{mode:'system',dark:false}}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.documentElement.dataset.theme, 'dark'); assert.deepEqual(ready, [true]); assert.deepEqual(errors, []);
  changed(false); assert.equal(document.documentElement.dataset.theme, 'light');
  cleanup(); changed(true); assert.equal(document.documentElement.dataset.theme, 'light');
});
test('native app-update launch selects the update page before computer settings or handoff can mount', async t => {
  fixture(t); const selected = [], computer = [], ready = [];
  globalThis.document = { documentElement: { dataset: {}, style: {setProperty() {}, removeProperty() {}} } };
  globalThis.__productHost = { getState: async () => ({revision:1,openUpdates:true,appearance:{dark:false}}) };
  const cleanup = m.bindProductLifecycle(() => computer.push(true), () => {}, value => ready.push(value), () => {}, value => selected.push(value));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(selected, [true]); assert.deepEqual(computer, []); assert.deepEqual(ready, [true]);
  assert.equal(m.takeProductSettingsLaunch(), false);
  cleanup();
});
test('recreated remote restores independent drafts, attachment metadata and pending delivery without control tokens', t => {
  const values = fixture(t);
  const attachment = { id: 'a', path: '/fixture/a.png', relativePath: 'a.png', fileName: 'a.png', size: 8, createdAt: '', mimeType: 'image/png', previewUrl: 'blob:obsolete' };
  const runtime = { ...m.defaultRuntime(), draft: '未发送电脑草稿', attachments: [attachment], pendingMessageId: 'synthetic-client', pendingMessageText: '待确认输入', desktopControl: { token: 'never-persist-control' } };
  assert.equal(m.saveThreadRuntimeCache({ thread: runtime }, 'computer').status, 'saved');
  const restored = m.loadThreadRuntimeCache('computer').thread;
  assert.equal(restored.draft, runtime.draft); assert.equal(restored.pendingMessageId, runtime.pendingMessageId);
  assert.deepEqual(restored.attachments, [{ ...attachment, previewUrl: null }]);
  assert.equal(Object.values(m.loadThreadRuntimeCache('other')).length, 0);
  assert.equal([...values.values()].join('').includes('never-persist-control'), false);
  m.saveThreadRuntimeCache({ thread: { ...m.defaultRuntime() } }, 'computer');
  assert.equal(m.loadThreadRuntimeCache('computer').thread, undefined);
});
test('reading positions are bounded, validated and isolated by profile', t => {
  const values = fixture(t);
  m.saveReadingPositions('computer', { thread: 452 }); assert.deepEqual(m.loadReadingPositions('computer'), { thread: 452 });
  assert.deepEqual(m.loadReadingPositions('other'), {});
  values.set('mobileCodexReadingPositionsV1:computer', '{"ok":0,"negative":-1,"string":"40"}');
  assert.deepEqual(m.loadReadingPositions('computer'), { ok: 0 });
  m.saveReadingPositions('computer', Object.fromEntries(Array.from({length:100}, (_,i) => ['t'+i, i])));
  assert.equal(Object.keys(m.loadReadingPositions('computer')).length, 64);
});
test('Agent pending input survives recreation and clears only on matching authority', t => {
  fixture(t); const pending = { clientMessageId: 'client', text: '电脑输入' };
  assert.equal(m.savePendingAgentDraft('profile', 'deepseek:session', pending), true);
  const restored = m.loadPendingAgentDraft('profile', 'deepseek:session'); assert.deepEqual(restored, pending);
  assert.equal(m.loadPendingAgentDraft('other', 'deepseek:session'), null);
  assert.equal(m.reconcileAgentDraft(pending.text, restored, {clientMessageId:'other', action:'message', delivery:'confirmed'}).pending, restored);
  const accepted = m.reconcileAgentDraft(pending.text, restored, {clientMessageId:'client', action:'message', delivery:'confirmed'});
  assert.equal(accepted.pending, null); assert.equal(accepted.draft, '');
  assert.equal(m.savePendingAgentDraft('profile', 'deepseek:session', null), true);
  assert.equal(m.loadPendingAgentDraft('profile', 'deepseek:session'), null);
});
test('Agent draft persistence reports storage failure before leaving the activity', t => {
  fixture(t);
  const drafts = { 'deepseek:12345678-1234-1234-1234-123456789abc': '独立草稿' };
  assert.equal(m.saveAgentDrafts('profile', drafts), true);
  assert.deepEqual(m.loadAgentDrafts('profile'), drafts);
  assert.equal(m.saveAgentDrafts('profile', drafts, { setItem() { throw new Error('synthetic quota'); } }), false);
});
test('actual Agent lifecycle flushes the current draft and blocks navigation on failure', async t => {
  fixture(t); const navigations = [];
  globalThis.__productHost = { navigate: async value => navigations.push(value.tab) };
  const errors = [], draftsRef = { current: {} }, release = m.bindAgentDraftLifecycle('profile', draftsRef, value => errors.push(value));
  try {
    draftsRef.current = { 'deepseek:12345678-1234-1234-1234-123456789abc': '刚输入的草稿' };
    await m.navigateProduct('ai');
    assert.deepEqual(m.loadAgentDrafts('profile'), draftsRef.current);
    localStorage.setItem = () => { throw new Error('synthetic quota'); };
    await assert.rejects(m.navigateProduct('settings'), /输入保存/);
    assert.match(errors.at(-1), /草稿保存失败/);
    assert.deepEqual(navigations, ['ai']);
  } finally { release(); }
});
test('computer rendering honors Kelivo font and tool preferences and resets old snapshots', t => {
  fixture(t); const values = new Map();
  globalThis.document = { documentElement: { dataset: {}, style: { setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k) } } };
  m.applyProductAppearance({ display: { chatFontScale: 1.5, showToolCards: false, showToolResultSummary: true } });
  assert.equal(values.get('--remote-chat-scale'), '1.5');
  assert.equal(document.documentElement.dataset.showToolCards, 'false');
  assert.equal(document.documentElement.dataset.showToolSummary, 'true');
  m.applyProductAppearance({ display: { chatFontScale: NaN } });
  assert.equal(values.get('--remote-chat-scale'), '1');
  assert.equal(document.documentElement.dataset.showToolCards, 'true');
  assert.equal(document.documentElement.dataset.showToolSummary, 'false');
});


test('signal and error follow host palettes and stale or malformed roles fall back', t => {
  fixture(t); const values = new Map();
  globalThis.document = { documentElement: { dataset: {}, style: { setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k) } } };
  for (const dark of [false, true]) {
    m.applyProductAppearance({ mode: 'system', dark, colors: { signal: '#aabbcc', error: '#cc3322', primary: '#123456' } });
    assert.equal(values.get('--signal'), '#aabbcc');
    assert.equal(values.get('--danger'), '#cc3322');
    assert.equal(values.get('--accent'), '#123456');
  }
  m.applyProductAppearance({ dark: false, colors: { signal: 'red', error: '#12345678' } });
  assert.equal(values.has('--signal'), false);
  assert.equal(values.has('--danger'), false);
  m.applyProductAppearance({ dark: true, colors: { signal: '#ffaa00', error: '#cc3322' } });
  m.applyProductAppearance({ dark: false, colors: { primary: '#111111' } });
  assert.equal(values.has('--signal'), false);
  assert.equal(values.has('--danger'), false);
  m.applyProductAppearance({ mode: 'dark', colors: { signal: '#ffaa00', error: '#cc3322' } });
  assert.equal(values.has('--signal'), false, 'legacy snapshots without brightness cannot override defaults');
});
