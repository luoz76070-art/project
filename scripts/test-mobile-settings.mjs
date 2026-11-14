import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));
await build({ stdin: { contents: "export * from './apps/mobile/src/features/connection/connectionStatus.ts'; export { deviceRevokedMessage } from './apps/mobile/src/features/connection/authorization.ts';", resolveDir: process.cwd(), loader: 'ts' },
  outfile: path.join(dir, 'model.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { friendlyComputerName, connectionCardState, connectionCardTitles, deviceRevokedMessage } = await import(pathToFileURL(path.join(dir, 'model.mjs')).href);
const app = await fs.readFile('apps/mobile/src/app/App.tsx', 'utf8'), pairing = await fs.readFile('apps/mobile/src/features/connection/PairingPanel.tsx', 'utf8');

test('the computer is named by its relay ID or host, never the full URL', () => {
  assert.equal(friendlyComputerName('https://broker.example/proxy/r/my-mac'), 'my-mac');
  assert.equal(friendlyComputerName('http://192.168.1.8:8787'), '192.168.1.8:8787');
  assert.equal(friendlyComputerName('not a url'), '');
});
test('connection card states', () => {
  const base = { endpoint: 'https://x', token: 't', checking: false, failed: false, latency: 42, connectionState: 'ok' };
  assert.equal(connectionCardState({ ...base, token: '' }), 'none');
  assert.equal(connectionCardState({ ...base, checking: true, latency: null }), 'testing');
  assert.equal(connectionCardState({ ...base, checking: true }), 'ok', 'a re-check keeps showing the last good result');
  assert.equal(connectionCardState({ ...base, failed: true }), 'error');
  assert.equal(connectionCardState({ ...base, connectionState: 'error' }), 'error');
  assert.equal(connectionCardState(base), 'ok');
  assert.deepEqual(Object.keys(connectionCardTitles).sort(), ['error', 'none', 'ok', 'testing']);
});
test('settings order: connection card, pairing, voice, then 高级 with manual connection, status and diagnostics', () => {
  const order = ['<ConnectionCard', '<PairingPanel', '<VoiceSettings', '高级</DisclosureSummary>', '<h3>手动连接</h3>', '<h3>电脑状态</h3>', '会话显示诊断</DisclosureSummary>'].map(mark => app.indexOf(mark));
  assert.ok(order.every(i => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
test('no developer jargon in visible settings text; 401 wording no longer claims revocation only', () => {
  for (const jargon of ['Relay endpoint', 'placeholder="Token"', 'Pair phone', '显示或隐藏 token', '打开健康检查', '<span>Relay</span>', '<span>Desktop</span>', 'IPC 可用']) assert.ok(!app.includes(jargon) && !pairing.includes(jargon), jargon);
  assert.doesNotMatch(pairing, /Relay/);
  assert.match(deviceRevokedMessage, /撤销/); assert.match(deviceRevokedMessage, /令牌不对/); assert.match(deviceRevokedMessage, /重新配对/);
});
