import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { build } from 'esbuild';
import { voiceInputDriver } from './helpers/voice-input-driver.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-voice-tests-'));
test.after(() => fs.rm(root, { recursive: true, force: true }));
const source = await fs.readFile(new URL('../apps/mobile/src/features/voice/model.ts', import.meta.url), 'utf8');
await fs.writeFile(path.join(root, 'model.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { mergeVoiceDraft, parseVoiceConfig, parseVoiceText, voiceError } = await import(path.join(root, 'model.mjs'));

// Exercise the actual HTTP error translator with a native transport stub; no real requests.
const httpSource = await fs.readFile(new URL('../apps/mobile/src/features/connection/http.ts', import.meta.url), 'utf8');
const httpJs = ts.transpileModule(httpSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/import[^;]+from "@capacitor\/core";/, 'const Capacitor = { isNativePlatform: () => false }; const CapacitorHttp = {};');
await fs.writeFile(path.join(root, 'http.mjs'), httpJs);
const { ensureHttpOk } = await import(path.join(root, 'http.mjs'));

const recoverySource = await fs.readFile(new URL('../apps/mobile/src/features/voice/recovery.ts', import.meta.url), 'utf8');
await fs.writeFile(path.join(root, 'recovery.mjs'), ts.transpileModule(recoverySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace('"./model"', '"./model.mjs"'));
const { createVoiceRecovery, voiceDraftHash, recoveredVoiceDraft, loadVoicePending, voiceRecoveryTtl } = await import(path.join(root, 'recovery.mjs'));
const { parseVoiceResult } = await import(path.join(root, 'model.mjs'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage() { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; }
async function pending(overrides = {}) { return { requestId: crypto.randomUUID(), stage: 'asr', scope: 'connection-one', thread: 'codex:original-thread', createdAt: Date.now(), draftHash: await voiceDraftHash('原草稿'), ...overrides }; }
function seed(store, record) { store.setItem(`mobileCodexVoicePendingV1:${record.scope}`, JSON.stringify([record])); }
function completed(record, text = '取回原文') { return { status: 'completed', outcome: 'succeeded', requestId: record.requestId, text, expiresAt: Date.now() + voiceRecoveryTtl }; }
function coordinator(t, store, overrides = {}) {
  const manager = createVoiceRecovery({ scope: 'connection-one', storage: store, query: async () => ({ status: 'not_found' }), restore: async () => assert.fail('unexpected restore'), ...overrides });
  t.after(() => manager.stop()); return manager;
}


const adapterBundle = path.join(root, 'adapters.mjs');
await build({ stdin: { contents: `export * from './apps/mobile/src/features/voice/draftRecovery'; export { saveAgentDrafts, loadAgentDrafts } from './apps/mobile/src/features/agents/runtime'; export { saveThreadRuntimeCache, loadThreadRuntimeCache, defaultRuntime } from './apps/mobile/src/features/chat/runtime';`, resolveDir: process.cwd() }, outfile: adapterBundle, bundle: true, platform: 'node', format: 'esm' });
const adapters = await import(adapterBundle);

test('voice adoption appends to the captured draft and rejects changed or excessive drafts', () => {
  assert.equal(mergeVoiceDraft('已有约束：不要发布', '已有约束：不要发布', '只分析 APK26'), '已有约束：不要发布\n\n只分析 APK26');
  assert.equal(mergeVoiceDraft('', '', ' 只分析 '), '只分析');
  assert.throws(() => mergeVoiceDraft('旧草稿', '新输入', '不要覆盖'), /输入框内容已变化/);
  assert.throws(() => mergeVoiceDraft('x'.repeat(19999), 'x'.repeat(19999), '任务'), /20000/);
});

test('voice response decoder refuses empty, truncated and unknown payloads', () => {
  assert.equal(parseVoiceText({ text: ' 只分析，不执行。 ' }), '只分析，不执行。');
  for (const raw of [null, {}, { text: 1 }, { text: '' }, { text: 'x'.repeat(20001) }]) assert.throws(() => parseVoiceText(raw));
  const config = { region: 'cn', workspace: '', qwenConfigured: true, deepseekConfigured: false, deepseekBaseUrl: 'https://provider.example/v1', qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', asrModel: 'qwen', promptModel: 'deepseek' };
  assert.equal(parseVoiceConfig(config), config);
  for (const raw of [null, {}, { ...config, region: 'unknown' }, { ...config, qwenConfigured: 'yes' }, { ...config, deepseekBaseUrl: undefined }, { ...config, qwenBaseUrl: undefined }]) assert.throws(() => parseVoiceConfig(raw));
});

test('voice errors expose actionable native messages and hide arbitrary exception text', () => {
  assert.match(voiceError(new Error('voice_microphone_denied')), /麦克风权限/);
  assert.match(voiceError(new Error('HTTP 404')), /更新网关/);
  assert.doesNotMatch(voiceError(new Error('upstream-secret-api-key')), /secret/);
});

test('voice HTTP errors identify stage, cause and required endpoint credential without exposing provider data', () => {
  for (const [stage, label] of [['asr', '百炼语音识别'], ['refine', 'DeepSeek 提示词整理']]) {
    for (const reason of ['auth', 'busy', 'endpoint', 'request', 'unavailable', 'response_invalid', 'timeout']) {
      assert.throws(() => ensureHttpOk(502, { error: `voice_${stage}_${reason}`, detail: 'provider-secret' }), error => {
        assert.match(error.message, new RegExp(label)); assert.doesNotMatch(error.message, /provider-secret/); return true;
      });
    }
  }
  assert.throws(() => ensureHttpOk(409, { error: 'voice_qwen_key_required_for_url' }), /百炼地址/);
  assert.throws(() => ensureHttpOk(409, { error: 'voice_audio_upgrade_required' }), /APK29/);
});

test('recovery decoder validates request identity, terminal outcomes and payload limits', async () => {
  const record = await pending();
  assert.equal(parseVoiceResult(completed(record), record.requestId).text, '取回原文');
  assert.deepEqual(parseVoiceResult({ status: 'not_found' }, record.requestId), { status: 'not_found' });
  for (const value of [{ ...completed(record), requestId: 'other' }, { ...completed(record), text: '' }, { ...completed(record), text: 'x'.repeat(20001) }, { status: 'completed' }, { ...completed(record), outcome: 'failed', errorCode: 'provider secret' }]) assert.throws(() => parseVoiceResult(value, record.requestId));
});

test('lost POST response queries the same id and never reuploads either stage', async t => {
  for (const stage of ['asr', 'refine']) {
    const record = await pending({ stage }), store = storage(); let posts = 0, gets = 0;
    const manager = coordinator(t, store, { query: async id => { gets++; assert.equal(id, record.requestId); return completed(record); } });
    manager.setVisible(true);
    const text = await manager.submit(record, async () => { posts++; throw new Error('connection lost'); });
    assert.equal(text, '取回原文'); assert.equal(posts, 1); assert.equal(gets, 1); assert.equal(store.data.size, 0);
  }
});

test('background pauses GET; foreground result wins against a late native POST exactly once', async t => {
  const record = await pending(), store = storage(); let finishPost, gets = 0, adopted = 0;
  const manager = coordinator(t, store, { query: async () => { gets++; return completed(record); } });
  const result = manager.submit(record, () => new Promise(resolve => { finishPost = resolve; }));
  result.then(() => { adopted++; });
  manager.setVisible(false); await manager.poll(); assert.equal(gets, 0);
  manager.setVisible(true); assert.equal(await result, '取回原文');
  finishPost('late duplicate'); await tick();
  assert.equal(adopted, 1); assert.equal(gets, 1); assert.equal(store.data.size, 0);
});

test('process restart restores only persisted metadata with GET and original thread identity', async t => {
  const record = await pending(), store = storage(); let posts = 0;
  const first = coordinator(t, store);
  const waiting = first.submit(record, async () => { posts++; return new Promise(() => {}); });
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  const raw = [...store.data.values()][0];
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(), ['createdAt', 'draftHash', 'requestId', 'scope', 'stage', 'thread']);
  assert.doesNotMatch(raw, /原草稿|取回原文|dataBase64|token|text/);
  first.stop(); await rejected;
  // Fresh coordinator, no in-memory request/session carried over.
  const drafts = { 'codex:original-thread': '原草稿', 'codex:currently-open': '不要覆盖' }; let gets = 0;
  const second = coordinator(t, store, { query: async id => { gets++; assert.equal(id, record.requestId); return completed(record); }, restore: async (r, text) => { drafts[r.thread] = await recoveredVoiceDraft(r, drafts[r.thread], text); } });
  second.setVisible(true); await second.poll();
  assert.equal(drafts[record.thread], '原草稿\n\n取回原文'); assert.equal(drafts['codex:currently-open'], '不要覆盖');
  assert.equal(posts, 1); assert.ok(gets >= 1); assert.equal(store.data.size, 0);
});

test('restarted refine recovery never starts ASR or another refinement; changed draft is protected', async t => {
  const record = await pending({ stage: 'refine' }), store = storage(); seed(store, record);
  let current = '编辑后的新草稿', preview;
  const manager = coordinator(t, store, { query: async () => completed(record, '整理结果'), restore: async (r, text) => {
    try { current = await recoveredVoiceDraft(r, current, text); } catch { preview = text; }
  } });
  manager.setVisible(true); await manager.poll();
  assert.equal(current, '编辑后的新草稿'); assert.equal(preview, '整理结果'); assert.equal(store.data.size, 0);
});

test('unknown, failed, cancelled and expired records clear without restore or upload', async t => {
  for (const outcome of ['not_found', 'failed', 'cancelled', 'expired']) {
    const record = await pending(), store = storage(); seed(store, record); let gets = 0;
    const manager = coordinator(t, store, { now: () => record.createdAt + (outcome === 'expired' ? voiceRecoveryTtl : 0), query: async () => { gets++; return outcome === 'not_found' ? { status: 'not_found' } : { status: 'completed', outcome, requestId: record.requestId, errorCode: 'voice_cancelled', expiresAt: Date.now() + voiceRecoveryTtl }; } });
    manager.setVisible(true); await manager.poll();
    assert.equal(store.data.size, 0); if (outcome === 'expired') assert.equal(gets, 0);
  }
});

test('persistent records isolate connection scopes, prune invalid/oversized data and expire at 15 minutes', async () => {
  const record = await pending(), store = storage(); seed(store, record);
  assert.deepEqual(loadVoicePending(store, 'different-scope'), []);
  assert.equal(loadVoicePending(store, record.scope, record.createdAt + voiceRecoveryTtl - 1).length, 1);
  assert.equal(loadVoicePending(store, record.scope, record.createdAt + voiceRecoveryTtl).length, 0);
  seed(store, { ...record, text: 'forbidden', dataBase64: 'forbidden' });
  loadVoicePending(store, record.scope, record.createdAt);
  assert.doesNotMatch([...store.data.values()][0], /forbidden/);
  store.setItem(`mobileCodexVoicePendingV1:${record.scope}`, '{bad');
  assert.deepEqual(loadVoicePending(store, record.scope), []);
});

test('storage failure prevents the initial upload', async t => {
  const store = storage(); store.setItem = () => { throw new Error('quota'); };
  const manager = coordinator(t, store);
  await assert.rejects(manager.submit(await pending(), async () => assert.fail('must not POST without recovery metadata')), /quota/);
});

test('explicit cancel discards late GET/POST while detach preserves metadata for original-session recovery', async t => {
  const record = await pending(), store = storage(); let finishPost, finishQuery;
  const manager = coordinator(t, store, { query: () => new Promise(resolve => { finishQuery = resolve; }) });
  const result = manager.submit(record, () => new Promise(resolve => { finishPost = resolve; }));
  const rejected = assert.rejects(result, { name: 'AbortError' });
  manager.setVisible(true); manager.cancel(record.requestId); await rejected;
  finishQuery(completed(record)); finishPost('late'); await tick(); assert.equal(store.data.size, 0);
  const other = await pending();
  const detached = manager.submit(other, () => new Promise(() => {})); const detachment = assert.rejects(detached, { name: 'AbortError' });
  manager.detach(other.requestId); await detachment; assert.equal(loadVoicePending(store, other.scope).length, 1);
});

test('not_found during an in-flight upload must not discard a future successful response', async t => {
  const record = await pending(), store = storage(); let finishPost;
  const manager = coordinator(t, store);
  const result = manager.submit(record, () => new Promise(resolve => { finishPost = resolve; }));
  manager.setVisible(true); await manager.poll(); assert.equal(loadVoicePending(store, record.scope).length, 1);
  finishPost('最终收到'); assert.equal(await result, '最终收到'); assert.equal(store.data.size, 0);
});

test('pending query uses capped backoff and stale query cannot affect a new visibility generation', async t => {
  const record = await pending(), store = storage(); seed(store, record);
  const delays = []; let release;
  const manager = coordinator(t, store, { schedule: (_cb, ms) => { delays.push(ms); return 0; }, query: async () => ({ status: 'processing', requestId: record.requestId }) });
  manager.setVisible(true); await tick();
  for (let i = 0; i < 5; i++) await manager.poll();
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000, 8000]); manager.stop();
  const stale = coordinator(t, store, { query: () => new Promise(resolve => { release = resolve; }) });
  stale.setVisible(true); stale.setVisible(false); release(completed(record)); await tick();
  assert.equal(loadVoicePending(store, record.scope).length, 1);
});

test('production draft adapters restore original Codex/Agent drafts, preserve other sessions and compare before writing', async t => {
  const original = globalThis.localStorage; globalThis.localStorage = storage();
  t.after(() => { globalThis.localStorage = original; });
  const scope = 'connection-one';
  adapters.saveThreadRuntimeCache({ original: { ...adapters.defaultRuntime(), draft: '原草稿' }, other: { ...adapters.defaultRuntime(), draft: 'other' } }, scope);
  assert.equal(adapters.readVoiceCodexDraft(scope, 'original'), '原草稿');
  assert.equal(adapters.writeVoiceCodexDraft(scope, 'original', 'changed', 'NO'), false);
  assert.equal(adapters.writeVoiceCodexDraft(scope, 'original', '原草稿', '原草稿\n\n取回'), true);
  assert.equal(adapters.loadThreadRuntimeCache(scope).original.draft, '原草稿\n\n取回');
  assert.equal(adapters.loadThreadRuntimeCache(scope).other.draft, 'other');
  adapters.saveAgentDrafts(scope, { 'deepseek:11111111-1111-4111-8111-111111111111': '原草稿', 'claude:22222222-2222-4222-8222-222222222222': 'other' });
  assert.equal(adapters.writeVoiceAgentDraft(scope, 'deepseek:11111111-1111-4111-8111-111111111111', 'changed', 'NO'), false);
  assert.equal(adapters.writeVoiceAgentDraft(scope, 'deepseek:11111111-1111-4111-8111-111111111111', '原草稿', '取回'), true);
  assert.equal(adapters.loadAgentDrafts(scope)['claude:22222222-2222-4222-8222-222222222222'], 'other');
  let live = { 'deepseek:11111111-1111-4111-8111-111111111111': 'live edit' };
  const unregister = adapters.registerVoiceAgentDrafts(scope, { read: () => live, write: value => { live = value; return true; } }); t.after(unregister);
  assert.equal(adapters.readVoiceAgentDraft(scope, 'deepseek:11111111-1111-4111-8111-111111111111'), 'live edit');
  assert.equal(adapters.writeVoiceAgentDraft(scope, 'deepseek:11111111-1111-4111-8111-111111111111', '取回', 'NO'), false);
  assert.equal(adapters.writeVoiceAgentDraft(scope, 'deepseek:11111111-1111-4111-8111-111111111111', 'live edit', 'appended'), true);
  assert.equal(live['deepseek:11111111-1111-4111-8111-111111111111'], 'appended');
});

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() >= deadline) assert.fail('voice state did not settle'); await tick(); }
}
function inputDriver(t, recovery, api = {}) {
  const driver = voiceInputDriver({ recovery, mergeVoiceDraft, voiceError, voiceDraftHash, api: {
    config: async () => ({ qwenConfigured: true, deepseekConfigured: true }),
    cancel: async () => {}, refine: async () => '整理结果', ...api,
  } });
  t.after(() => driver.unmount());
  driver.click('语音输入'); driver.click('仅转文字');
  return driver;
}
async function record(driver) {
  const before = driver.calls.start;
  driver.click(driver.button('重新录音') ? '重新录音' : '开始录音');
  await until(() => driver.calls.start > before);
  driver.recording();
}

// ASR failure -> explicit new request, both attempts use the real V1 coordinator.
test('production retry button reuses audio after 502, changes id, locks double clicks and recovers a lost second response', async t => {
  const store = storage(), posts = [], gets = [];
  const manager = coordinator(t, store, { query: async id => {
    gets.push(id);
    return posts.length === 1 ? { status: 'completed', requestId: id, outcome: 'failed', errorCode: 'voice_asr_unavailable', expiresAt: Date.now() + voiceRecoveryTtl }
      : completed({ requestId: id }, '第二次成功');
  } });
  manager.setVisible(true);
  const driver = inputDriver(t, manager, { transcribe: async (id, audio, duration) => {
    posts.push({ id, audio, duration });
    const raw = [...store.data.values()][0];
    assert.doesNotMatch(raw, /synthetic-audio|dataBase64|durationMs|原草稿/);
    if (posts.length === 1) ensureHttpOk(502, { error: 'voice_asr_unavailable' });
    throw new Error('second POST response lost');
  } });
  await record(driver);
  const active = driver.session();
  await until(() => driver.button('重新转写'));
  assert.equal(posts.length, 1); assert.equal(active.recording.dataBase64, 'synthetic-audio');
  const retry = driver.button('重新转写').props.onClick;
  retry(); retry(); // Same render, before the disabled/hidden button can update.
  await until(() => driver.original() === '第二次成功');
  assert.equal(posts.length, 2); assert.equal(new Set(posts.map(p => p.id)).size, 2);
  assert.deepEqual(posts.map(({ audio, duration }) => ({ audio, duration })), Array(2).fill({ audio: 'synthetic-audio', duration: 1000 }));
  assert.deepEqual(gets, posts.map(p => p.id)); assert.equal(driver.calls.start, 1);
  assert.equal(active.recording, undefined); assert.equal(driver.button('重新转写'), undefined);
  assert.equal(store.data.size, 0);
  driver.click('采用原文'); assert.deepEqual(driver.drafts, ['原草稿\n\n第二次成功']);
});

test('failed, not_found, provider timeout and definitive rejection preserve audio; cancellation releases it', async t => {
  for (const kind of ['failed', 'not_found', 'timeout', 'rejected', 'cancelled', 'cancel-post']) {
    const store = storage();
    const manager = coordinator(t, store, { query: async id => kind === 'not_found' ? { status: 'not_found' }
      : { status: 'completed', requestId: id, outcome: kind === 'cancelled' ? 'cancelled' : 'failed', errorCode: kind === 'timeout' ? 'voice_asr_timeout' : 'voice_asr_unavailable', expiresAt: Date.now() + voiceRecoveryTtl } });
    manager.setVisible(true);
    const driver = inputDriver(t, manager, { transcribe: async () => {
      if (kind === 'cancel-post') ensureHttpOk(409, { error: 'voice_cancelled' });
      if (kind === 'rejected') ensureHttpOk(422, {});
      throw new Error('network unavailable');
    } });
    await record(driver); const active = driver.session();
    await until(() => active.finished);
    const cancelled = kind.startsWith('cancel');
    assert.equal(Boolean(active.recording), !cancelled, kind);
    assert.equal(Boolean(driver.button('重新转写')), !cancelled, kind);
    assert.equal(store.data.size, 0);
    manager.stop();
  }
});

test('V1 recovery expiry is a retryable failure rather than a user cancellation', async t => {
  const store = storage(); let now = Date.now();
  const manager = coordinator(t, store, { now: () => now, query: async id => ({ status: 'processing', requestId: id }) });
  const driver = inputDriver(t, manager, { transcribe: async () => null });
  await record(driver);
  await until(() => store.data.size > 0);
  now += voiceRecoveryTtl + 100;
  manager.setVisible(true);
  await until(() => driver.button('重新转写'));
  assert.ok(driver.session().recording); assert.equal(store.data.size, 0);
});

test('discard, new recording, close, scope/thread change and unmount clear the retained audio', async t => {
  for (const action of ['discard', 'new', 'close', 'thread', 'scope', 'unmount']) {
    const manager = coordinator(t, storage()); manager.setVisible(true);
    const driver = inputDriver(t, manager, { transcribe: async () => { throw new Error('network'); } });
    await record(driver); const active = driver.session();
    await until(() => driver.button('重新转写'));
    driver.hide(); assert.ok(active.recording, 'background alone preserves a failed recording');
    if (action === 'discard') driver.click('丢弃');
    if (action === 'new') driver.click('重新录音');
    if (action === 'close') driver.click('关闭语音输入');
    if (action === 'thread') driver.render({ thread: 'codex:other' });
    if (action === 'scope') driver.render({ scope: 'other-connection' });
    if (action === 'unmount') driver.unmount();
    assert.equal(active.recording, undefined, action);
    assert.notEqual(driver.session(), active, action);
    manager.stop();
  }
});

test('unmount while uploading releases audio, preserves V1 metadata and ignores late results', async t => {
  const store = storage(); let resolvePost;
  const manager = coordinator(t, store);
  const driver = inputDriver(t, manager, { transcribe: () => new Promise(resolve => { resolvePost = resolve; }) });
  await record(driver); const active = driver.session();
  await until(() => resolvePost);
  driver.unmount();
  assert.equal(active.recording, undefined); assert.equal(active.abort.signal.aborted, true);
  assert.equal(loadVoicePending(store, 'connection-one').length, 1);
  manager.stop(); resolvePost('late'); await tick();
  assert.deepEqual(driver.drafts, []); assert.equal(driver.session(), undefined);
});

test('retry preserves captured draft conflicts and refine failures keep editable original text', async t => {
  const store = storage(); let asr = 0, refinements = 0;
  const manager = coordinator(t, store); manager.setVisible(true);
  const driver = inputDriver(t, manager, { transcribe: async () => {
    if (++asr === 1) throw new Error('lost'); return '已有原文';
  }, refine: async () => { if (++refinements === 1) ensureHttpOk(422, {}); return '重新整理成功'; } });
  driver.click('整理提示词');
  await record(driver);
  await until(() => driver.button('重新转写'));
  driver.render({ draft: '新的草稿' });
  driver.click('重新转写');
  await until(() => driver.original() === '已有原文' && driver.session().finished);
  assert.equal(driver.session().recording, undefined);
  assert.equal(driver.button('采用原文').props.disabled, true);
  driver.click('重新整理');
  await until(() => driver.button('采用提示词'));
  assert.equal(driver.original(), '已有原文'); assert.equal(asr, 2); assert.equal(refinements, 2);
  assert.equal(driver.button('采用提示词').props.disabled, true); assert.deepEqual(driver.drafts, []);
});
