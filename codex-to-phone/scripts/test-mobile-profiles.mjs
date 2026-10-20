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
