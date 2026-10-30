import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { createGatewayDiagnostics, gatewayBuildId } from '../dist/gateway/diagnostics.js';
import { startTunnel } from '../dist/transport/tunnel.js';

test('gateway build identity is attached to the built artifact and journal is bounded without raw context', () => {
  assert.match(gatewayBuildId, /^gateway-[a-f0-9-]{36}$/);
  const journal = createGatewayDiagnostics(true);
  for (let i = 0; i < 100; i++) journal.record({ at: '2026-10-29T00:00:00Z', generation: i, state: 'connected', reason: 'open', url: 'private-url', token: 'private-secret' });
  const snapshot = journal.snapshot();
  assert.equal(snapshot.events.length, 20); assert.equal(snapshot.omitted, 80); assert.equal(snapshot.events[0].seq, 81);
  snapshot.events[0].reason = 'changed'; assert.equal(journal.snapshot().events[0].reason, 'open');
  assert.equal(JSON.stringify(journal.snapshot()).includes('private'), false);
});

test('tunnel diagnostics capture heartbeat loss and a new connection generation without close reason text', async t => {
  const broker = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: false });
  await once(broker, 'listening');
  const events = [], journal = createGatewayDiagnostics(true);
  const tunnel = startTunnel({ brokerUrl: `http://127.0.0.1:${broker.address().port}`, relayId: 'private-relay', relaySecret: 'private-secret',
    localRelay: 'http://127.0.0.1:1', reconnectMs: 10, requestTimeoutMs: 100, heartbeatMs: 25 }, {
    log() {}, onDiagnostic: event => { events.push(event); journal.record(event); },
  });
  t.after(async () => { tunnel.stop(); await tunnel.done; for (const socket of broker.clients) socket.terminate(); await new Promise(resolve => broker.close(resolve)); });
  const deadline = Date.now() + 4000;
  while (!events.some(event => event.reason === 'open' && event.generation >= 2)) {
    assert.ok(Date.now() < deadline, 'synthetic tunnel reconnect timeout');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(events.slice(0, 7).map(event => [event.generation, event.reason]), [[1, 'connect'], [1, 'open'], [1, 'heartbeat-timeout'], [1, 'closed'], [1, 'retry'], [2, 'connect'], [2, 'open']]);
  tunnel.stop(); tunnel.stop(); await tunnel.done;
  assert.equal(events.filter(event => event.reason === 'stop').length, 1);
  assert.equal(JSON.stringify(journal.snapshot()).includes('private'), false);
});
