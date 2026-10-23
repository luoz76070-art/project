import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenCodeClient } from '../apps/relay/dist/agents/openCodeClient.js';
import { OpenCodeAdapter } from '../apps/relay/dist/agents/openCodeAdapter.js';
import { activeSchema, interruptSchema, sessionsSchema } from '../apps/relay/dist/agents/openCodeProtocol.js';

// Explicit official-service check; never installs an agent or reads a user profile.
const binary = process.argv[2];
if (!binary || !path.isAbsolute(binary) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/check-opencode-runtime.mjs <absolute-opencode-2.0.16-binary> (build relay first)');
}
const sandbox = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-opencode-runtime-')));
const checks = [], productRequests = [];
let child, childClosed, client, adapter, unsubscribe, address;
let stdout = '', stderr = '', latest, disconnects = 0;
const password = randomBytes(32).toString('base64url');
const headers = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
const redact = value => value.replaceAll(sandbox, '<isolated-profile>').replaceAll(password, '<test-credential>');
const result = { version: '2.0.16', checks, passed: false, modelPromptsSubmitted: 0, userProfilesChanged: false, originalSessionControlVerified: false };

async function until(predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Official server exited: ${redact(stderr)}`);
    await delay(25);
  }
  throw new Error(`Official runtime check timed out: ${redact(stdout + stderr)}`);
}
async function check(name, run) {
  await run();
  checks.push(name);
}
async function request(route, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(new URL(route, address), {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${redact(text)}`);
  return response.status === 204 ? undefined : JSON.parse(text);
}
class TracedClient extends OpenCodeClient {
  json(route, schema, body, method) {
    productRequests.push({ method: method ?? (body === undefined ? 'GET' : 'POST'), route });
    return super.json(route, schema, body, method);
  }
}

try {
  for (const dir of ['home', 'config', 'cache', 'data', 'state', 'tmp', 'work', 'other']) await fs.mkdir(path.join(sandbox, dir), { mode: 0o700 });
  const directory = path.join(sandbox, 'work');
  const env = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8',
    HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home'), TMPDIR: path.join(sandbox, 'tmp'),
    XDG_CONFIG_HOME: path.join(sandbox, 'config'), XDG_CACHE_HOME: path.join(sandbox, 'cache'),
    XDG_DATA_HOME: path.join(sandbox, 'data'), XDG_STATE_HOME: path.join(sandbox, 'state'),
    OPENCODE_CONFIG_DIR: path.join(sandbox, 'config'), OPENCODE_CONFIG_PROJECT_DISABLE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_FILEWATCHER_DISABLE: '1', OPENCODE_DISABLE_FFF: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_SIMULATE: '1', OPENCODE_SERVER_PASSWORD: password,
  };
  await check('official-version-and-isolated-foreground-serve', async () => {
    const version = spawnSync(binary, ['--version'], { cwd: directory, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(version.error);
    assert.equal(version.status, 0, redact(version.stderr));
    assert.equal(version.stdout.trim(), 'opencode v2.0.16');
    result.binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
    child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    childClosed = new Promise(resolve => child.once('close', resolve));
    let spawnError;
    child.on('error', error => { spawnError = error; });
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-64000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-64000); });
    address = await until(() => {
      if (spawnError) throw spawnError;
      return /server listening on (http:\/\/127\.0\.0\.1:\d+)/u.exec(stdout)?.[1];
    }, 25000);
    const info = await request('/api/info');
    assert.equal(info.version, result.version);
    assert.equal(info.pid, child.pid);
    assert.ok(info.paths.tmp.startsWith(path.join(sandbox, 'tmp') + path.sep));
  });
  await check('official-basic-auth-and-unauthorized', async () => {
    for (const route of ['/api/info', '/api/session', '/api/event']) {
      const response = await fetch(new URL(route, address), { signal: AbortSignal.timeout(8000), redirect: 'error' });
      await response.arrayBuffer();
      assert.equal(response.status, 401);
      assert.match(response.headers.get('www-authenticate'), /^Basic /u);
    }
    const wrong = await fetch(new URL('/api/info', address), { headers: { Authorization: `Basic ${Buffer.from('opencode:wrong').toString('base64')}` }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    await wrong.arrayBuffer();
    assert.equal(wrong.status, 401);
  });
  client = new TracedClient({ url: address, directory, password });
  adapter = new OpenCodeAdapter(client);
  await check('production-adapter-empty-list-and-active-decoding', async () => {
    result.initialSessionList = await request('/api/session');
    assert.deepEqual(await adapter.listSessions(), { sessions: [], cursor: null });
    assert.deepEqual(await client.json('/api/session/active', activeSchema), { data: {} });
  });
  let sessionId;
  await check('test-owner-fixtures-and-production-directory-scope', async () => {
    // Only the test owner creates fixtures, in its own database. The product has no create route.
    const own = await request('/api/session', { title: 'Mobile official fixture', location: { directory } });
    sessionId = own.data.id;
    await request('/api/session', { title: 'Other directory fixture', location: { directory: path.join(sandbox, 'other') } });
    const page = await adapter.listSessions();
    assert.deepEqual(page.sessions.map(session => session.id), [sessionId]);
    assert.equal(page.sessions[0].directory, directory);
    const raw = await client.json('/api/session?limit=1&order=asc', sessionsSchema);
    assert.equal(raw.data.length, 1);
    assert.ok(raw.cursor.next);
    const next = await client.json(`/api/session?${new URLSearchParams({ limit: '1', cursor: raw.cursor.next })}`, sessionsSchema);
    assert.equal(next.data.length, 1);
    assert.notEqual(next.data[0].id, raw.data[0].id);
  });
  await check('production-sse-and-empty-session-snapshot', async () => {
    unsubscribe = await adapter.watchSession(sessionId, value => { latest = value; }, () => { disconnects++; });
    assert.equal(latest.connected, true);
    assert.equal(latest.status, 'idle');
    assert.deepEqual(latest.messages, []);
    assert.deepEqual(latest.questions, []);
    assert.deepEqual(latest.permissions, []);
    assert.equal(latest.control.canSend, true);
    assert.equal(latest.control.canInterrupt, false);
  });
  await check('official-idle-interrupt-and-no-unknown-lock', async () => {
    assert.deepEqual(await client.json(`/api/session/${sessionId}/interrupt`, interruptSchema, undefined, 'POST'), { interrupted: false });
    await assert.rejects(adapter.interruptSession(sessionId, { controlToken: latest.control.token, clientMessageId: randomUUID() }), { code: 'OPENCODE_SESSION_IDLE' });
    assert.equal(latest.control.canSend, true);
    assert.equal(latest.submission, null);
  });
  let formId;
  await check('official-form-events-and-original-keys-values', async () => {
    const form = await request(`/api/session/${sessionId}/form`, {
      title: 'Choose connection', metadata: { kind: 'question' }, fields: [
        { key: 'transport', type: 'string', title: 'Connection', required: true, options: [{ value: 'remote', label: 'Remote' }, { value: 'local', label: 'Local' }] },
        { key: 'features', type: 'multiselect', title: 'Features', required: true, options: [{ value: 'stream', label: 'Live output' }, { value: 'reconnect', label: 'Reconnect' }] },
      ],
    });
    formId = form.data.id;
    await until(() => latest.questions.length === 1);
    const question = latest.questions[0];
    assert.equal(question.unavailableReason, null);
    assert.deepEqual(question.questions.map(item => item.multiple), [false, true]);
    assert.deepEqual(await adapter.respondQuestion(sessionId, question.id, {
      controlToken: latest.control.token, clientMessageId: randomUUID(), answers: [['Remote'], ['Live output', 'Reconnect']],
    }), { ok: true, delivery: 'submitted' });
    const detail = await request(`/api/session/${sessionId}/form/${formId}`);
    assert.deepEqual(detail.data.state, { status: 'answered', answer: { transport: 'remote', features: ['stream', 'reconnect'] } });
    await until(() => latest.questions.length === 0);
    await assert.rejects(adapter.respondQuestion(sessionId, question.id, {
      controlToken: latest.control.token, clientMessageId: randomUUID(), answers: [['Remote'], ['Live output']],
    }), { code: 'OPENCODE_REQUEST_EXPIRED' });
  });
  await check('official-unsupported-form-and-owner-first-resolution', async () => {
    const form = await request(`/api/session/${sessionId}/form`, {
      title: 'Constrained field', metadata: { kind: 'question' }, fields: [{ key: 'name', type: 'string', minLength: 5 }],
    });
    await until(() => latest.questions.length === 1);
    const question = latest.questions[0];
    assert.ok(question.unavailableReason);
    await assert.rejects(adapter.respondQuestion(sessionId, question.id, {
      controlToken: latest.control.token, clientMessageId: randomUUID(), answers: [['short']],
    }), { code: 'OPENCODE_FORM_UNSUPPORTED' });
    await request(`/api/session/${sessionId}/form/${form.data.id}/reply`, { answer: { name: 'owner answer' } });
    await until(() => latest.questions.length === 0);
    await assert.rejects(adapter.respondQuestion(sessionId, question.id, {
      controlToken: latest.control.token, clientMessageId: randomUUID(), answers: [['phone answer']],
    }), { code: 'OPENCODE_REQUEST_EXPIRED' });
  });
  await check('official-owner-first-answer-preserves-original-result', async () => {
    const form = await request(`/api/session/${sessionId}/form`, {
      title: 'Owner first', metadata: { kind: 'question' }, fields: [{ key: 'answer', type: 'string' }],
    });
    await until(() => latest.questions.length === 1);
    const question = latest.questions[0], token = latest.control.token;
    assert.equal(question.unavailableReason, null);
    await request(`/api/session/${sessionId}/form/${form.data.id}/reply`, { answer: { answer: 'owner first answer' } });
    await assert.rejects(adapter.respondQuestion(sessionId, question.id, {
      controlToken: token, clientMessageId: randomUUID(), answers: [['late phone answer']],
    }), { code: 'OPENCODE_REQUEST_EXPIRED' });
    const detail = await request(`/api/session/${sessionId}/form/${form.data.id}`);
    assert.deepEqual(detail.data.state, { status: 'answered', answer: { answer: 'owner first answer' } });
    await until(() => latest.questions.length === 0);
  });
  await check('official-comment-heartbeat-keeps-production-sse-alive', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(new URL('/api/event', address), { headers, signal: controller.signal, redirect: 'error' });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/event-stream/u);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let frames = '';
      while (!frames.includes(': heartbeat\n\n')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        frames += decoder.decode(chunk.value, { stream: true });
        assert.ok(frames.length <= 64000);
      }
      assert.match(frames, /"type":"server.connected"/u);
      assert.equal(disconnects, 0);
      assert.equal(latest.connected, true);
    } finally { clearTimeout(timer); controller.abort(); }
  });
  await check('production-unsubscribe-and-reconnect-with-fresh-control', async () => {
    const token = latest.control.token;
    unsubscribe(); unsubscribe = undefined;
    await assert.rejects(adapter.respondQuestion(sessionId, 'expired', { controlToken: token, clientMessageId: randomUUID(), answers: [['answer']] }), { code: 'OPENCODE_CONTROL_EXPIRED' });
    unsubscribe = await adapter.watchSession(sessionId, value => { latest = value; }, () => { disconnects++; });
    assert.notEqual(latest.control.token, token);
    assert.equal(latest.connected, true);
    assert.deepEqual(latest.questions, []);
    assert.equal(disconnects, 0);
  });
  await check('no-product-create-fork-resume-or-model-prompt', async () => {
    assert.ok(productRequests.length > 0);
    assert.ok(productRequests.every(item => item.method === 'GET' || /^\/api\/session\/ses[^/]+\/(interrupt|form\/frm_[^/]+\/reply)$/u.test(item.route)), JSON.stringify(productRequests));
  });
  result.passed = true;
} catch (error) {
  result.error = redact(error.stack ?? String(error));
  result.serverOutput = redact(stdout + stderr);
  process.exitCode = 1;
} finally {
  unsubscribe?.();
  await adapter?.stop(); client?.stop();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await childClosed;
    clearTimeout(timer);
  }
  await fs.rm(sandbox, { recursive: true, force: true });
  result.temporaryProfileRemoved = true;
  result.ownedServerStopped = !child || child.exitCode !== null || child.signalCode !== null;
  result.checkCount = checks.length;
  console.log(JSON.stringify(result, null, 2));
}
