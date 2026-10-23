import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-credentials-test-'));
test.after(() => fs.rm(directory, { recursive: true, force: true }));
let sequence = 0;
async function load(file, setup) {
  globalThis.__credentialFixture = setup;
  let source = await fs.readFile(new URL(`../apps/mobile/src/features/connection/${file}.ts`, import.meta.url), 'utf8');
  source = source.replace(/import \{ Capacitor, registerPlugin \} from "@capacitor\/core";/, 'const { Capacitor, registerPlugin } = globalThis.__credentialFixture;')
    .replace(/import \{ Capacitor, CapacitorHttp \} from "@capacitor\/core";/, 'const { Capacitor, CapacitorHttp } = globalThis.__credentialFixture;')
    .replace('import { normalizeEndpoint } from "./http";', 'const normalizeEndpoint = value => value.trim().replace(/\\/+$/, "");');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const filePath = path.join(directory, `${file}-${sequence++}.mjs`);
  await fs.writeFile(filePath, output.outputText);
  return import(pathToFileURL(filePath).href);
}
function storage(t) {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  t.after(() => { globalThis.localStorage = previous; delete globalThis.__credentialFixture; });
  return values;
}
const profile = { id: 'default', name: 'fixture', endpoint: 'http://127.0.0.1', token: 'synthetic-private-token', updatedAt: '2026-10-20' };

test('native startup encrypts legacy credentials before removing plaintext', async t => {
  const values = storage(t);
  values.set('connectionProfiles', JSON.stringify([profile])); values.set('relayToken', profile.token);
  let encrypted;
  const module = await load('profiles', { Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({ load: async () => ({ value: '{}' }), save: async ({ value }) => { assert.match(values.get('connectionProfiles'), /synthetic-private-token/); encrypted = value; } }) });
  await module.initializeCredentials();
  assert.equal(JSON.parse(encrypted).default, profile.token);
  assert.ok(!values.get('connectionProfiles').includes(profile.token));
  assert.equal(values.get('relayToken'), undefined);
  assert.equal(module.loadConnectionProfiles()[0].token, profile.token);
});

test('failed native migration leaves legacy credentials recoverable', async t => {
  const values = storage(t); values.set('connectionProfiles', JSON.stringify([profile]));
  const module = await load('profiles', { Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({ load: async () => ({ value: '{}' }), save: async () => { throw new Error('fixture disk failure'); } }) });
  await assert.rejects(module.initializeCredentials(), /disk failure/);
  assert.equal(JSON.parse(values.get('connectionProfiles'))[0].token, profile.token);
});

test('web profiles retain the existing browser storage path', async t => {
  const values = storage(t);
  const module = await load('profiles', { Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) });
  await module.saveConnectionProfiles([profile], 'default');
  assert.equal(JSON.parse(values.get('connectionProfiles'))[0].token, profile.token);
});

test('public plaintext endpoints are rejected; private LAN and HTTPS remain usable', async t => {
  storage(t);
  const { assertSecureEndpoint } = await load('http', { Capacitor: { isNativePlatform: () => false }, CapacitorHttp: {} });
  for (const value of ['https://relay.example/r/mac', 'http://127.0.0.1:8787', 'http://192.168.1.2', 'http://10.0.0.2', 'http://[::1]', 'http://mac.local']) assert.doesNotThrow(() => assertSecureEndpoint(value));
  for (const value of ['http://public.example', 'http://8.8.8.8', 'http://172.32.1.2', 'https://token:secret@relay.example', 'ftp://192.168.1.2']) assert.throws(() => assertSecureEndpoint(value), /HTTPS/);
});

for (const native of [false, true]) test(`${native ? 'native' : 'web'} HTTP preserves Desktop rejection codes without exposing response text`, async t => {
  storage(t);
  const previousFetch = globalThis.fetch;
  let calls = 0;
  const response = { error: 'desktop_control_refresh_required' };
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(response), { status: 409 }); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const { apiPost } = await load('http', {
    Capacitor: { isNativePlatform: () => native },
    CapacitorHttp: { request: async () => { calls++; return { status: 409, data: JSON.stringify(response) }; } },
  });
  await assert.rejects(apiPost('https://synthetic.example/messages', 'synthetic-token', { message: 'fixture' }), error => {
    assert.equal(error.status, 409); assert.equal(error.code, response.error);
    assert.match(error.message, /会话控制状态/); return true;
  });
  assert.equal(calls, 1, 'writes must never retry automatically');
  response.error = 'private-upstream-content';
  await assert.rejects(apiPost('https://synthetic.example/messages', 'synthetic-token', {}), error => {
    assert.equal(error.status, 409); assert.equal(error.code, undefined);
    assert.ok(!error.message.includes('private-upstream-content')); return true;
  });
});

for (const native of [false, true]) test(`${native ? 'native' : 'web'} voice errors retain known codes, discard provider text and never retry`, async t => {
  storage(t); const previousFetch = globalThis.fetch; let calls = 0;
  const data = { error: 'voice_provider_auth', detail: 'synthetic-private-key' };
  globalThis.fetch = async () => { calls++; return Response.json(data, { status: 502 }); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const { apiPost } = await load('http', {
    Capacitor: { isNativePlatform: () => native },
    CapacitorHttp: { request: async () => { calls++; return { status: 502, data }; } },
  });
  await assert.rejects(apiPost('https://synthetic.example/api/voice/refine', 'synthetic-token', {}), error => {
    assert.equal(error.code, 'voice_provider_auth'); assert.match(error.message, /模型鉴权失败/);
    assert.doesNotMatch(error.message, /synthetic-private-key/); return true;
  });
  assert.equal(calls, 1);
  data.error = 'synthetic-private-provider-error';
  await assert.rejects(apiPost('https://synthetic.example/api/voice/refine', 'synthetic-token', {}), error => {
    assert.equal(error.code, undefined); assert.doesNotMatch(error.message, /synthetic-private/); return true;
  });
});
