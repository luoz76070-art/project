import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { VoiceService, transcribeSchema, refineSchema, MAX_AUDIO_BYTES } from '../dist/voice/service.js';
import { VoiceCredentialStore, voiceConfigPatch } from '../dist/voice/credentials.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const config = { region: 'cn', workspace: '', qwenKey: 'synthetic-qwen-key', deepseekKey: 'synthetic-deepseek-key' };
const audio = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(100)]).toString('base64');
const aac = Buffer.concat([Buffer.from([0xff, 0xf1, 0x60, 0x40, 0x0f, 0xff, 0xfc]), Buffer.alloc(120)]).toString('base64');
const input = () => ({ requestId: randomUUID(), dataBase64: audio, durationMs: 1000 });
const refine = () => ({ requestId: randomUUID(), text: '只分析 APK26，不要执行或发布，保留 DeepSeek。' });
const signal = () => new AbortController().signal;
const response = text => Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}

// Contract copied structurally from the official non-streaming examples, not the old implementation.
test('Qwen-Audio-3.1 uses multimodal input and output.text, with regional hosts and real containers', async () => {
  const calls = [];
  const service = new VoiceService(async (url, options) => { calls.push({ url, ...options }); return Response.json({ output: { text: ' 只分析，不执行。 ', sentence: { text: 'ignored partial' } }, usage: { duration: 1 } }); });
  assert.deepEqual(await service.transcribe('a', input(), config, signal()), { text: '只分析，不执行。' });
  await service.transcribe('b', { ...input(), dataBase64: aac }, { ...config, region: 'sg', workspace: 'workspace_42' }, signal());
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(calls[1].url, 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(calls[1].headers['X-DashScope-WorkSpace'], 'workspace_42');
  assert.equal(calls[0].headers.Authorization, 'Bearer synthetic-qwen-key');
  assert.equal(calls[0].headers['X-DashScope-SSE'], 'disable');
  assert.equal(calls[0].redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].body), {
    model: 'qwen-audio-3.1-asr-flash',
    input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mp4;base64,${audio}` } }] }] },
    parameters: { format: 'm4a', sample_rate: '16000', vocabulary: { '手机会话': 1, '聊天会话': 1, Codex: 1, DeepSeek: 1 } },
  });
  assert.equal(JSON.parse(calls[1].body).parameters.format, 'aac');
  assert.equal(JSON.parse(calls[1].body).input.messages[0].content[0].input_audio.data, `data:audio/aac;base64,${aac}`);
});

test('Qwen3 uses workspace compatible chat API, AAC and stop response; M4A never reaches provider', async () => {
  const base = 'https://llm-synthetic.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
  const service = new VoiceService(async (url, options) => {
    assert.equal(url, `${base}/chat/completions`);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-qwen-key');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), {
      model: 'qwen3-asr-flash', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/aac;base64,${aac}` } }] }],
      stream: false, asr_options: { enable_itn: true },
    });
    return response('只分析，不执行。');
  });
  const settings = { ...config, qwenBaseUrl: base, qwenModel: 'qwen3-asr-flash' };
  assert.deepEqual(await service.transcribe('a', { ...input(), dataBase64: aac }, settings, signal()), { text: '只分析，不执行。' });
  await assert.rejects(service.transcribe('a', input(), settings, signal()), { code: 'voice_audio_upgrade_required' });
  const native = new VoiceService(async (url) => {
    assert.equal(url, 'https://llm-synthetic.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    return Response.json({ output: { text: '正确' } });
  });
  await native.transcribe('b', input(), { ...config, qwenBaseUrl: base }, signal());
  for (const raw of [{ choices: [] }, { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, { output: { text: 'wrong protocol' } }]) {
    await assert.rejects(new VoiceService(async () => Response.json(raw)).transcribe('a', { ...input(), dataBase64: aac }, settings, signal()), { code: 'voice_asr_response_invalid' });
  }
  await assert.rejects(new VoiceService(async () => response(' ')).transcribe('a', { ...input(), dataBase64: aac }, settings, signal()), { code: 'voice_no_speech' });
});

test('ASR preserves supplier text for both models instead of rewriting homophones', async () => {
  for (const qwenModel of ['qwen-audio-3.1-asr-flash', 'qwen3-asr-flash']) {
    for (const text of ['保留原始绘画，不要删除旧绘画。', '手机绘画按项目文件夹归类。', '把聊天会话和绘画作品分开。']) {
      const service = new VoiceService(async () => qwenModel === 'qwen3-asr-flash' ? response(text) : Response.json({ output: { text } }));
      try {
        assert.equal((await service.transcribe('a', { ...input(), dataBase64: aac }, { ...config, qwenModel }, signal())).text, text);
      } finally { service.stop(); }
    }
  }
});

test('DeepSeek editing disables thinking, carries only the spoken text and rejects incomplete output', async () => {
  let body;
  const service = new VoiceService(async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    body = JSON.parse(options.body); return response('只分析 APK26，不要执行或发布，保留 DeepSeek。');
  });
  const request = refine();
  assert.equal((await service.refine('a', request, config, signal())).text, request.text);
  assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.stream, false);
  assert.equal(body.messages[1].content, request.text);
  assert.match(body.messages[0].content, /不得编造/); assert.match(body.messages[0].content, /不执行任务/);
  assert.equal(body.messages.length, 2);
  for (const data of [{ choices: [] }, { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, { choices: [{ finish_reason: 'stop', message: { content: '' } }] }]) {
    await assert.rejects(new VoiceService(async () => Response.json(data)).refine('a', refine(), config, signal()), { code: 'voice_refine_response_invalid' });
  }
});

test('missing credentials, invalid base64/format and excessive duration never call a supplier', async () => {
  const service = new VoiceService(async () => { assert.fail('No network request expected'); });
  await assert.rejects(service.transcribe('a', input(), { region: 'cn', workspace: '' }, signal()), { code: 'voice_qwen_key_required' });
  await assert.rejects(service.refine('a', refine(), { region: 'cn', workspace: '' }, signal()), { code: 'voice_deepseek_key_required' });
  for (const dataBase64 of [Buffer.from('not m4a file').toString('base64'), `${audio}==`, Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64')]) {
    await assert.rejects(service.transcribe('a', { ...input(), dataBase64 }, config, signal()), { code: 'voice_audio_invalid' });
  }
  assert.equal(transcribeSchema.safeParse({ ...input(), durationMs: 122000 }).success, false);
  assert.equal(transcribeSchema.safeParse({ ...input(), dataBase64: '!invalid' }).success, false);
  assert.equal(refineSchema.safeParse({ ...refine(), text: ' ' }).success, false);
});

test('supplier errors and oversized/malformed responses expose no provider secret or body', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(new VoiceService(async () => new Response('secret-provider-body', { status })).refine('a', refine(), config, signal()), error => {
      assert.doesNotMatch(error.message, /secret|synthetic/); return true;
    });
  }
  for (const value of ['{invalid-provider-secret', 'x'.repeat(300000)]) {
    await assert.rejects(new VoiceService(async () => new Response(value)).refine('a', refine(), config, signal()), error => {
      assert.doesNotMatch(error.message, /secret|synthetic/); return true;
    });
  }
  await assert.rejects(new VoiceService(async () => Response.json({ output: { text: ' ' } })).transcribe('a', input(), config, signal()), { code: 'voice_no_speech' });
});

test('per-device and global concurrency, request replay and cancel-before-arrival remain bounded', async () => {
  const releases = [];
  const service = new VoiceService(async (_url, options) => new Promise((resolve, reject) => {
    releases.push(() => resolve(response('done')));
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const firstInput = refine(); const first = service.refine('a', firstInput, config, signal());
  await assert.rejects(service.refine('a', refine(), config, signal()), { code: 'voice_busy' });
  const others = ['b', 'c', 'd'].map(owner => service.refine(owner, refine(), config, signal()));
  await assert.rejects(service.refine('e', refine(), config, signal()), { code: 'voice_busy' });
  for (const release of releases) release();
  await Promise.all([first, ...others]);
  await assert.rejects(service.refine('a', firstInput, config, signal()), { code: 'voice_request_used' });
  const cancelled = refine(); service.cancel('a', cancelled.requestId);
  await assert.rejects(service.refine('a', cancelled, config, signal()), { code: 'voice_request_used' });
  // A request identifier belongs to one owner, not the whole gateway.
  const cross = service.refine('z', cancelled, config, signal()); releases.at(-1)(); await cross;
});

test('disconnect signal, explicit cancel, revoke and shutdown abort the active supplier call', async () => {
  for (const kind of ['signal', 'cancel', 'revoke', 'stop']) {
    let aborted = false;
    const service = new VoiceService(async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('upstream secret')); }, { once: true })));
    const controller = new AbortController(), request = refine();
    const pending = service.refine('owner', request, config, controller.signal);
    await tick();
    if (kind === 'signal') controller.abort();
    else if (kind === 'cancel') service.cancel('owner', request.requestId);
    else if (kind === 'revoke') service.revoke('owner');
    else service.stop();
    await assert.rejects(pending, { code: 'voice_cancelled' }); assert.equal(aborted, true);
    if (kind === 'stop') await assert.rejects(service.refine('other', refine(), config, signal()), { code: 'voice_unavailable' });
  }
});

test('deadline aborts the provider and reports an unknown result without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const service = new VoiceService(async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const pending = service.refine('a', refine(), config, signal());
  t.mock.timers.tick(40001);
  await assert.rejects(pending, { code: 'voice_refine_timeout', statusCode: 504 });
  assert.equal(calls, 1);
});

test('closing the HTTP response cancels upstream work through the production route', { timeout: 6000 }, async t => {
  const root = await temporary(t);
  let started, cancelled;
  const ready = new Promise(resolve => { started = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  const voice = new VoiceService(async (_url, options) => {
    started();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { cancelled(); reject(new Error('aborted')); }, { once: true }));
  });
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: { voice, desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  const auth = { authorization: 'Bearer synthetic-admin' };
  await app.inject({ method: 'POST', url: '/api/voice/config', headers: auth, payload: { deepseekKey: config.deepseekKey } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 }), controller = new AbortController();
  const request = fetch(`${base}/api/voice/refine`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(refine()), signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(request); await stopped;
});

test('voice HTTP capacity is reserved before body parsing and released after errors', async t => {
  const root = await temporary(t); let release, started, hold = true;
  const ready = new Promise(resolve => { started = resolve; });
  const voice = new VoiceService(async () => {
    if (!hold) return response('done');
    started(); return new Promise(resolve => { release = () => resolve(response('done')); });
  });
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: { voice, desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer synthetic-admin', 'content-type': 'application/json' };
  await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { deepseekKey: config.deepseekKey } });
  const first = app.inject({ method: 'POST', url: '/api/voice/refine', headers, payload: refine() });
  await ready;
  assert.equal((await app.inject({ method: 'POST', url: '/api/voice/refine', headers, payload: '{bad' })).statusCode, 429);
  hold = false; release(); assert.equal((await first).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/voice/refine', headers, payload: '{bad' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/voice/refine', headers, payload: refine() })).statusCode, 200);
});

test('private credentials preserve independent keys, survive reload and reject unsafe files', async t => {
  const root = await temporary(t), file = path.join(root, 'private', 'voice.json');
  const store = await VoiceCredentialStore.open(file);
  await Promise.all(['a', 'b'].map((key, i) => store.update(`00000000-0000-4000-8000-00000000000${i}`, { qwenKey: `synthetic-${key}`, region: i ? 'sg' : 'cn' }, () => true)));
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const restored = await VoiceCredentialStore.open(file);
  assert.equal(restored.get('00000000-0000-4000-8000-000000000001').qwenKey, 'synthetic-b');
  assert.equal(JSON.stringify(restored.status('00000000-0000-4000-8000-000000000001')).includes('synthetic'), false);
  await restored.update('00000000-0000-4000-8000-000000000001', { qwenKey: null }, () => true);
  assert.equal(restored.status('00000000-0000-4000-8000-000000000001').qwenConfigured, false);
  await assert.rejects(restored.update('admin', { deepseekKey: 'synthetic' }, () => false));
  const alias = path.join(root, 'alias'); await fs.symlink(file, alias);
  await assert.rejects(VoiceCredentialStore.open(alias), /VOICE_CREDENTIALS_UNAVAILABLE/);
  await fs.chmod(file, 0o644); await assert.rejects(VoiceCredentialStore.open(file), /VOICE_CREDENTIALS_UNAVAILABLE/);
});

test('HTTP wiring authenticates first, isolates settings, redacts errors and removes revoked device credentials', async t => {
  const root = await temporary(t); const keys = [];
  const voice = new VoiceService(async (_url, options) => { keys.push(options.headers.Authorization); return response('只分析，不执行'); });
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: { voice, desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/api/voice/config', headers: { 'content-type': 'application/json' }, payload: '{bad' })).statusCode, 401);
  const admin = { authorization: 'Bearer synthetic-admin' };
  async function pair(name) {
    const code = (await app.inject({ method: 'POST', url: '/api/pairing', headers: admin })).json().code;
    const result = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code, name } })).json();
    return { auth: { authorization: `Bearer ${result.token}` }, id: result.device.id };
  }
  const a = await pair('a'), b = await pair('b');
  const save = await app.inject({ method: 'POST', url: '/api/voice/config', headers: a.auth, payload: { deepseekKey: config.deepseekKey } });
  assert.equal(save.statusCode, 200); assert.equal(save.json().deepseekConfigured, true); assert.doesNotMatch(save.body, /synthetic/);
  assert.equal((await app.inject({ url: '/api/voice/config', headers: b.auth })).json().deepseekConfigured, false);
  assert.equal((await app.inject({ url: '/api/voice/config', headers: admin })).json().deepseekConfigured, false);
  const missing = await app.inject({ method: 'POST', url: '/api/voice/refine', headers: b.auth, payload: refine() });
  assert.equal(missing.statusCode, 409); assert.equal(missing.json().error, 'voice_deepseek_key_required');
  assert.equal((await app.inject({ method: 'POST', url: '/api/voice/refine', headers: a.auth, payload: refine() })).statusCode, 200);
  assert.deepEqual(keys, ['Bearer synthetic-deepseek-key']);
  for (const payload of [{ region: 'evil' }, { endpoint: 'http://evil' }, { qwenKey: 'bad\nheader' }, { owner: b.id }, { workspace: '../bad' }]) {
    const invalid = await app.inject({ method: 'POST', url: '/api/voice/config', headers: a.auth, payload });
    assert.equal(invalid.statusCode, 400); assert.equal(invalid.json().error, 'voice_invalid_request');
  }
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${a.id}`, headers: b.auth })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${a.id}`, headers: admin })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/voice/config', headers: a.auth })).statusCode, 401);
  assert.equal((await fs.readFile(path.join(root, '.mobile-codex/voice-credentials.json'), 'utf8')).includes(config.deepseekKey), false);
});

test('third-party DeepSeek base URLs normalize without leaking old keys to a changed target', async t => {
  const { voiceConfigPatch } = await import('../dist/voice/credentials.js');
  const root = await temporary(t), file = path.join(root, 'voice.json');
  const store = await VoiceCredentialStore.open(file);
  const save = patch => store.update('admin', voiceConfigPatch.parse(patch), () => true);
  assert.equal(store.status('admin').deepseekBaseUrl, 'https://api.deepseek.com');
  await save({ deepseekKey: 'synthetic-official' });
  await assert.rejects(save({ deepseekBaseUrl: 'https://provider.example/v1/' }), /voice_deepseek_key_required_for_url/);
  assert.equal(store.get('admin').deepseekKey, 'synthetic-official');
  for (const input of ['https://provider.example/v1', 'https://provider.example/v1/', 'https://provider.example/v1/chat/completions']) {
    await save({ deepseekBaseUrl: input, deepseekModel: 'vendor/deepseek-chat', deepseekKey: 'synthetic-provider' });
    assert.equal(store.status('admin').deepseekBaseUrl, 'https://provider.example/v1');
  }
  await save({ region: 'sg' });
  assert.equal(store.status('admin').deepseekConfigured, true);
  const restored = await VoiceCredentialStore.open(file);
  assert.equal(restored.status('admin').promptModel, 'vendor/deepseek-chat');
  assert.equal(restored.get('admin').deepseekKey, 'synthetic-provider');
  assert.equal(restored.status('00000000-0000-4000-8000-000000000001').deepseekBaseUrl, 'https://api.deepseek.com');
  await save({ deepseekBaseUrl: 'https://new-provider.example', deepseekKey: null });
  assert.equal(store.status('admin').deepseekConfigured, false);
  for (const url of ['http://provider.example', 'https://user:secret@provider.example', 'https://provider.example?api_key=secret', 'https://provider.example/#secret', 'https://provider.example/has space', 'https://provider.example\\path', 'invalid']) {
    assert.equal(voiceConfigPatch.safeParse({ deepseekBaseUrl: url }).success, false);
  }
  assert.equal(voiceConfigPatch.safeParse({ deepseekModel: 'bad\nmodel' }).success, false);
});

test('third-party requests use configured model and standard chat parameters without provider extensions', async () => {
  let calls = 0;
  const service = new VoiceService(async (url, options) => {
    calls++;
    assert.equal(url, 'https://provider.example/proxy/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-third-party');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'vendor/deepseek-chat');
    assert.equal(body.thinking, undefined); assert.equal(body.stream, false);
    assert.equal(body.messages.length, 2);
    return response('只整理原文，不执行。');
  });
  await service.refine('a', refine(), { ...config, deepseekBaseUrl: 'https://provider.example/proxy/v1', deepseekModel: 'vendor/deepseek-chat', deepseekKey: 'synthetic-third-party' }, signal());
  assert.equal(calls, 1);
});

test('changing a configured URL without a replacement key returns a stable HTTP error and preserves config', async t => {
  const root = await temporary(t);
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: { voice: new VoiceService(async () => assert.fail('no paid request')), desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer synthetic-admin' };
  await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { deepseekKey: 'synthetic-original' } });
  const rejected = await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { deepseekBaseUrl: 'https://provider.example/v1' } });
  assert.equal(rejected.statusCode, 409); assert.deepEqual(rejected.json(), { error: 'voice_deepseek_key_required_for_url' });
  const unchanged = (await app.inject({ url: '/api/voice/config', headers })).json();
  assert.equal(unchanged.deepseekBaseUrl, 'https://api.deepseek.com'); assert.equal(unchanged.deepseekConfigured, true);
  const changed = await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { deepseekBaseUrl: 'https://provider.example/v1/chat/completions', deepseekModel: 'vendor-chat', deepseekKey: 'synthetic-new-key' } });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().deepseekBaseUrl, 'https://provider.example/v1');
  assert.equal(changed.json().promptModel, 'vendor-chat'); assert.doesNotMatch(changed.body, /synthetic/);
});

test('ASR configuration migrates old credentials, normalizes official paths, and binds keys to effective destination', async t => {
  const root = await temporary(t), file = path.join(root, 'voice.json');
  await fs.writeFile(file, JSON.stringify({ admin: config }), { mode: 0o600 });
  const store = await VoiceCredentialStore.open(file);
  const save = patch => store.update('admin', voiceConfigPatch.parse(patch), () => true);
  assert.equal(store.status('admin').qwenBaseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(store.status('admin').asrModel, 'qwen-audio-3.1-asr-flash');
  await assert.rejects(save({ region: 'sg' }), /voice_qwen_key_required_for_url/);
  assert.equal(store.status('admin').region, 'cn');
  const origin = 'https://llm-synthetic.cn-beijing.maas.aliyuncs.com';
  await assert.rejects(save({ qwenBaseUrl: origin }), /voice_qwen_key_required_for_url/);
  for (const suffix of ['', '/', '/compatible-mode/v1/', '/compatible-mode/v1/chat/completions', '/api/v1', '/api/v1/services/aigc/multimodal-generation/generation']) {
    await save({ qwenBaseUrl: origin + suffix, qwenModel: 'qwen3-asr-flash', qwenKey: 'synthetic-new-qwen' });
    assert.equal(store.status('admin').qwenBaseUrl, origin + '/compatible-mode/v1');
  }
  await save({ region: 'sg' }); // Explicit workspace URL does not move when metadata changes.
  const restored = await VoiceCredentialStore.open(file);
  assert.equal(restored.status('admin').asrModel, 'qwen3-asr-flash');
  assert.equal(restored.get('admin').qwenKey, 'synthetic-new-qwen');
  assert.equal(restored.get('admin').deepseekKey, config.deepseekKey);
  assert.doesNotMatch(JSON.stringify(restored.status('admin')), /synthetic-new-qwen|synthetic-deepseek-key/);
  await save({ qwenBaseUrl: 'https://dashscope-intl.aliyuncs.com', qwenKey: null });
  assert.equal(store.status('admin').qwenConfigured, false);
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret', 'https://example.com/#secret', 'https://example.com/unknown', 'https://example.com/has space']) assert.equal(voiceConfigPatch.safeParse({ qwenBaseUrl: url }).success, false);
  assert.equal(voiceConfigPatch.safeParse({ qwenModel: 'arbitrary-chat-model' }).success, false);
});

test('stages classify provider failures without leaking response bodies and reject incomplete AAC', async () => {
  for (const stage of ['asr', 'refine']) {
    for (const [status, reason] of [[400, 'request'], [422, 'request'], [401, 'auth'], [403, 'auth'], [404, 'endpoint'], [429, 'busy'], [500, 'unavailable']]) {
      const service = new VoiceService(async () => new Response('provider-secret', { status }));
      await assert.rejects(stage === 'asr' ? service.transcribe('a', input(), config, signal()) : service.refine('a', refine(), config, signal()), { code: `voice_${stage}_${reason}` });
    }
    for (const body of ['{provider-secret', 'x'.repeat(300000)]) {
      const service = new VoiceService(async () => new Response(body));
      await assert.rejects(stage === 'asr' ? service.transcribe('a', input(), config, signal()) : service.refine('a', refine(), config, signal()), { code: `voice_${stage}_response_invalid` });
    }
  }
  const service = new VoiceService(async () => assert.fail('invalid AAC cannot call provider'));
  for (const bytes of [Buffer.from(aac, 'base64').subarray(0, -1), Buffer.from([0xff, 0xf1, 0x60, 0x40, 0, 0, 0])]) {
    await assert.rejects(service.transcribe('a', { ...input(), dataBase64: bytes.toString('base64') }, config, signal()), { code: 'voice_audio_invalid' });
  }
});

test('Qwen target guard is enforced by production HTTP config route', async t => {
  const root = await temporary(t);
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: { voice: new VoiceService(async () => assert.fail('no paid request')), desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } } });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer synthetic-admin' };
  await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { qwenKey: 'synthetic-old-key' } });
  const rejected = await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { region: 'sg' } });
  assert.equal(rejected.statusCode, 409); assert.deepEqual(rejected.json(), { error: 'voice_qwen_key_required_for_url' });
  const changed = await app.inject({ method: 'POST', url: '/api/voice/config', headers, payload: { qwenBaseUrl: 'https://llm-synthetic.cn-beijing.maas.aliyuncs.com', qwenModel: 'qwen3-asr-flash', qwenKey: 'synthetic-new-key' } });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().asrModel, 'qwen3-asr-flash'); assert.doesNotMatch(changed.body, /synthetic-new-key/);
});
