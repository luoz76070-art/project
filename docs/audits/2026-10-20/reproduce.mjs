import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/relay/package.json'));
const WebSocket = require('ws');
const { CodexStore } = await import(path.join(root, 'apps/relay/dist/codexStore.js'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-phone-audit-'));
const results = [];
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = (name, data) => { const row = { name, ...data }; results.push(row); console.log(JSON.stringify(row)); };
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const n = s.address().port; await new Promise(r => s.close(r)); return n; }
function child(file, env) { const p = spawn(process.execPath, [path.join(root, file)], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); p.auditLog = ''; p.stdout.on('data', x => { p.auditLog = (p.auditLog + x).slice(-5000); }); p.stderr.on('data', x => { p.auditLog = (p.auditLog + x).slice(-5000); }); children.push(p); return p; }
async function until(check, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await pause(30); } throw new Error('condition timed out'); }
let mock;
try {
  const sessions = path.join(temporary, 'sessions', '2026', '10', '20');
  await fs.mkdir(sessions, { recursive: true });
  const id = '11111111-1111-1111-1111-111111111111';
  const file = path.join(sessions, `rollout-${id}.jsonl`);
  const meta = JSON.stringify({ type: 'session_meta', payload: { id, source: 'vscode', cwd: temporary } }) + '\n';
  const msg = JSON.stringify({ timestamp: '2026-10-20T00:00:00Z', type: 'event_msg', payload: { type: 'agent_message', message: 'must-not-disappear' } });
  const split = Math.floor(msg.length / 2);
  await fs.writeFile(file, meta + msg.slice(0, split));
  await fs.writeFile(path.join(temporary, 'session_index.jsonl'), '');
  const store = new CodexStore(temporary);
  const latest = await store.readThreadLatest(id);
  await fs.appendFile(file, msg.slice(split) + '\n');
  const delta = await store.readThreadDelta(id, latest.cursor);
  output('partial-line-after-latest', { reproducedLoss: ![...latest.messages, ...delta.messages].some(x => x.text === 'must-not-disappear'), cursor: latest.cursor, deltaCursor: delta.cursor });
  await fs.writeFile(file, meta + JSON.stringify({ timestamp: '2026-10-20T00:00:01Z', type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(600000) } }) + '\n');
  const large = await store.readThreadDelta(id, Buffer.byteLength(meta));
  const largeAgain = await store.readThreadDelta(id, large.cursor);
  output('oversized-jsonl-record', { stalled: large.cursor === Buffer.byteLength(meta) && largeAgain.cursor === large.cursor, messages: large.messages.length, fileBytes: large.fileSize, truncated: large.truncated });

  let cancelStarted = false;
  let cancelClosed = false;
  let slowStarted = false;
  let gotFirstStreamFrame = false;
  mock = http.createServer((req, res) => {
    if (req.url === '/stream') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('event: desktop\ndata: {"value":1}\n\n'); const timer = setInterval(() => res.write(': heartbeat\n\n'), 100); req.on('close', () => clearInterval(timer)); return; }
    if (req.url === '/cancel') { cancelStarted = true; req.on('close', () => { cancelClosed = true; }); return; }
    if (req.url === '/slow') { slowStarted = true; return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const mockBase = `http://127.0.0.1:${mock.address().port}`;
  const direct = await fetch(`${mockBase}/stream`);
  const directReader = direct.body.getReader();
  gotFirstStreamFrame = (await directReader.read()).value.length > 0;
  await directReader.cancel();
  const brokerPort = await port();
  const brokerBase = `http://127.0.0.1:${brokerPort}`;
  const secret = 'audit-only-secret-12345678901234567890';
  child('apps/relay/dist/brokerServer.js', { MOBILE_CODEX_BROKER_HOST: '127.0.0.1', MOBILE_CODEX_BROKER_PORT: String(brokerPort), MOBILE_CODEX_BROKER_RELAYS: JSON.stringify({ audit: secret, second: secret }), MOBILE_CODEX_BROKER_REQUEST_TIMEOUT_MS: '1800' });
  await until(async () => { try { return (await fetch(`${brokerBase}/health`)).ok; } catch { return false; } });
  const tunnel = child('apps/relay/dist/remoteTunnelClient.js', { MOBILE_CODEX_BROKER_URL: brokerBase, MOBILE_CODEX_RELAY_ID: 'audit', MOBILE_CODEX_RELAY_SECRET: secret, MOBILE_CODEX_LOCAL_RELAY: mockBase, MOBILE_CODEX_TUNNEL_REQUEST_TIMEOUT_MS: '1200', MOBILE_CODEX_TUNNEL_RECONNECT_MS: '100' });
  await until(async () => (await (await fetch(`${brokerBase}/health`)).json()).connectedRelayCount === 1);
  const normal = await fetch(`${brokerBase}/r/audit/health`);
  output('broker-json-forward', { status: normal.status, body: await normal.json() });
  let started = performance.now();
  const streaming = await fetch(`${brokerBase}/r/audit/stream`);
  output('broker-sse-forward', { directFirstFrame: gotFirstStreamFrame, brokerStatus: streaming.status, firstResponseMs: Math.round(performance.now() - started), body: await streaming.json(), testTunnelDeadlineMs: 1200, productionDefaultMs: 180000 });
  const controller = new AbortController();
  const cancelRequest = fetch(`${brokerBase}/r/audit/cancel`, { signal: controller.signal }).catch(() => undefined);
  await until(() => cancelStarted);
  controller.abort();
  await cancelRequest;
  await pause(150);
  output('cancel-propagation', { localRequestStillOpenAfterPhoneAbort: !cancelClosed });
  started = performance.now();
  const slowRequest = fetch(`${brokerBase}/r/audit/slow`);
  await until(() => slowStarted);
  tunnel.kill('SIGTERM');
  const slow = await slowRequest;
  output('relay-disconnect-pending', { status: slow.status, elapsedMs: Math.round(performance.now() - started), body: await slow.json(), testBrokerDeadlineMs: 1800, productionDefaultMs: 180000 });

  // Two authorized synthetic relay sockets: a second relay must not resolve the first relay's request.
  const firstSocket = new WebSocket(`ws://127.0.0.1:${brokerPort}/relay/connect?relayId=audit&secret=${secret}`);
  await once(firstSocket, 'open');
  const secondSocket = new WebSocket(`ws://127.0.0.1:${brokerPort}/relay/connect?relayId=second&secret=${secret}`);
  await once(secondSocket, 'open');
  firstSocket.once('message', raw => { const request = JSON.parse(raw.toString()); secondSocket.send(JSON.stringify({ type: 'response', id: request.id, status: 200, headers: { 'content-type': 'application/json' }, body: '{"wrongRelay":true}' })); });
  const cross = await fetch(`${brokerBase}/r/audit/check`);
  output('cross-relay-response-binding', { status: cross.status, acceptedWrongRelay: (await cross.json()).wrongRelay === true, note: 'synthetic second relay given request UUID by test harness' });
  firstSocket.terminate(); secondSocket.terminate();
  await fs.writeFile('/tmp/codex-to-phone-audit-results-20261020.json', JSON.stringify(results, null, 2));
} finally {
  for (const p of children) { if (p.exitCode === null) p.kill('SIGTERM'); }
  mock?.closeAllConnections(); mock?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
