import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// F1: the phone's notification bridge (keys shared with the gateway, settings, when to ask and start).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'mobile-attention-'));
const shim = path.join(temp, 'capacitor.mjs');
await writeFile(shim, `
export const Capacitor = { isNativePlatform: () => Boolean(globalThis.__native), isPluginAvailable: name => Boolean(globalThis.__plugins?.[name]) };
export const CapacitorHttp = { request: async () => { throw new Error("no http in tests"); } };
export const registerPlugin = name => new Proxy({}, { get: (_, method) => (...args) => globalThis.__plugins[name][method](...args) });
`);
await build({ stdin: { contents: `
export * from './apps/mobile/src/features/notify/attention';
export { attentionKey } from './apps/relay/src/attention/attentionHub';
`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(temp, 'attention.mjs'),
  alias: { '@capacitor/core': shim }, logLevel: 'error' });
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
globalThis.window = new EventTarget();
const m = await import(pathToFileURL(path.join(temp, 'attention.mjs')));
test.after(() => rm(temp, { recursive: true, force: true }));

function plugin(permission) {
  const calls = [];
  const state = { permission };
  globalThis.__native = true;
  globalThis.__plugins = { Attention: {
    permission: async () => { calls.push('permission'); return { ...state, running: false }; },
    requestPermission: async () => { calls.push('request'); state.permission = state.next ?? 'granted'; return { ...state, running: false }; },
    start: async () => { calls.push('start'); return { ...state, running: true, started: true }; },
    setViewing: async value => { calls.push(['viewing', value.key]); },
  } };
  return { calls, state };
}

test('keys are the gateway attentionKey() for every channel and parse back to a target', () => {
  assert.equal(m.codexAttentionKey('t1', true), m.attentionKey({ source: 'desktop', threadId: 't1' }));
  assert.equal(m.codexAttentionKey('t1', false), m.attentionKey({ source: 'live', threadId: 't1', turnId: 'x' }));
  assert.equal(m.agentAttentionKey('deepseek', 's:1'), m.attentionKey({ source: 'agent', agentId: 'deepseek', sessionId: 's:1' }));
  assert.deepEqual(m.parseAttentionKey('desktop:t1'), { agentId: 'codex', sessionId: 't1' });
  assert.deepEqual(m.parseAttentionKey('live:t1'), { agentId: 'codex', sessionId: 't1' });
  assert.deepEqual(m.parseAttentionKey('agent:deepseek:s:1'), { agentId: 'deepseek', sessionId: 's:1' });
  for (const bad of ['', 'desktop:', 'agent:deepseek', 'agent::s', 'other:t1']) assert.equal(m.parseAttentionKey(bad), null, bad);
});

test('settings default to both on, survive corrupt storage and announce changes', () => {
  storage.clear();
  assert.deepEqual(m.loadNotifySettings(), { finished: true, approvals: true });
  let changed = 0; const listener = () => changed++;
  window.addEventListener('mobicodex-notify-settings', listener);
  m.saveNotifySettings({ finished: false, approvals: true });
  window.removeEventListener('mobicodex-notify-settings', listener);
  assert.equal(changed, 1);
  assert.deepEqual(m.loadNotifySettings(), { finished: false, approvals: true });
  storage.set(m.notifySettingsKey, '{broken');
  assert.deepEqual(m.loadNotifySettings(), { finished: true, approvals: true });
});

test('after a send: asks for permission once, starts only when allowed, and does nothing in a browser or when switched off', async () => {
  storage.clear();
  globalThis.__native = false; globalThis.__plugins = {};
  await m.attentionAfterSend();

  let p = plugin('prompt');
  await m.attentionAfterSend();
  assert.deepEqual(p.calls, ['permission', 'request', 'start']);

  storage.clear(); p = plugin('prompt'); p.state.next = 'denied';
  await m.attentionAfterSend();
  await m.attentionAfterSend();
  assert.deepEqual(p.calls, ['permission', 'request', 'permission'], 'a refusal is not asked again on every send');

  storage.clear(); p = plugin('granted');
  m.saveNotifySettings({ finished: false, approvals: false });
  await m.attentionAfterSend();
  assert.deepEqual(p.calls, []);
  m.saveNotifySettings({ finished: false, approvals: true });
  await m.attentionAfterSend();
  assert.deepEqual(p.calls, ['permission', 'start']);

  m.setAttentionViewing('desktop:t1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(p.calls.at(-1), ['viewing', 'desktop:t1']);
});
