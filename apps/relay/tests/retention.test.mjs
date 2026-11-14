import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRelayServer } from '../dist/server/createRelayServer.js';
import { WorkItemStore } from '../dist/workItems/store.js';
import { CaptureAssetStore } from '../dist/capture/store.js';
import { handoffMessage } from '../dist/workItems/handoffMessage.js';
import { png } from './fixtures/capture.mjs';

const day = 86_400_000;
const exists = file => fs.access(file).then(() => true, () => false);
async function server(t, root) {
  const app = await createRelayServer({ logger: false, config: { host: '127.0.0.1', port: 0, token: 'admin', codexHome: path.join(root, 'empty'), defaultCwd: root }, services: {
    store: { close() {} }, live: { stop: async () => {} }, liveTurns: { stop: async () => {} }, desktopControl: { stop: async () => {}, messageQueue: { stop: async () => {}, revoke: async () => {} } }, agentGateway: { stop: async () => {} },
  } });
  let closed = false; const close = async () => { if (!closed) { closed = true; app.server.closeAllConnections(); await app.close(); } };
  t.after(close);
  const request = (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: 'Bearer admin' } });
  async function upload(captureId) {
    const assetId = randomUUID();
    const response = await request('POST', '/api/uploads', { purpose: 'capture', assetId, captureId, role: 'original', originalAssetId: null, fileName: '截图.png', mimeType: 'image/png', dataBase64: png().toString('base64') });
    assert.equal(response.statusCode, 200, response.body); return assetId;
  }
  async function card(state = 'todo') {
    const captureId = randomUUID(), assetId = await upload(captureId), info = (await request('GET', '/api/work-items')).json();
    let item = (await request('POST', '/api/work-items', { storeId: info.storeId, uid: randomUUID(), mutationId: randomUUID(), expectedRevision: 0, title: `卡片 ${state}`, detail: '保留文字', kind: 'task', assets: [], codeRefs: [],
      capture: { id: captureId, mode: 'image', createdAt: new Date().toISOString(), assetIds: [assetId], rawTranscript: null } })).json().item;
    const act = async (route, body) => { const r = await request('POST', `/api/work-items/${item.uid}/${route}`, { mutationId: randomUUID(), expectedRevision: item.revision, ...body }); assert.equal(r.statusCode, 200, r.body); item = r.json().item; };
    if (state !== 'todo') await act('actions', { action: 'start' });
    if (['to_verify', 'done'].includes(state)) await act('actions', { action: 'review' });
    if (state === 'done') await act('verify', { decision: 'accept' });
    if (state === 'returned') await act('actions', { action: 'return', reason: '不需要了' });
    return { item, assetId };
  }
  return { request, upload, card, close };
}
const assetDir = (root, id) => path.join(root, 'mobile-uploads', 'captures', id);

test('deleting an undispatched capture card removes its images from disk', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const s = await server(t, root), { item, assetId } = await s.card('todo');
  assert.equal(await exists(assetDir(root, assetId)), true);
  const removed = await s.request('DELETE', `/api/work-items/${item.uid}`, { mutationId: randomUUID(), expectedRevision: item.revision });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(await exists(assetDir(root, assetId)), false);
  assert.equal((await s.request('GET', `/api/capture-assets/${assetId}`)).statusCode, 404);
});

test('retention purges images of done/returned cards past the window, keeps their text, and removes abandoned uploads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const s = await server(t, root);
  const cards = {}; for (const state of ['todo', 'in_progress', 'to_verify', 'done', 'returned']) cards[state] = await s.card(state);
  const orphan = await s.upload(randomUUID());
  await s.close();
  const store = await WorkItemStore.open(root, new CaptureAssetStore(root));
  const soon = await store.retention(Date.now() + 3_600_000, 30);
  assert.deepEqual(soon, { purgedCards: 0, removedAssets: 0 }, 'nothing expires within the window, fresh uploads stay');
  const later = await store.retention(Date.now() + 31 * day, 30);
  assert.deepEqual(later, { purgedCards: 2, removedAssets: 3 });
  for (const state of ['done', 'returned']) {
    const { item } = store.get(cards[state].item.uid);
    assert.ok(item.capture.assetsPurgedAt); assert.equal(item.detail, '保留文字'); assert.equal(item.state, state);
    assert.equal(await exists(assetDir(root, cards[state].assetId)), false);
  }
  for (const state of ['todo', 'in_progress', 'to_verify']) {
    assert.equal(store.get(cards[state].item.uid).item.capture.assetsPurgedAt, undefined);
    assert.equal(await exists(assetDir(root, cards[state].assetId)), true, `${state} keeps its images however old`);
  }
  assert.equal(await exists(assetDir(root, orphan)), false);
  assert.deepEqual(await store.retention(Date.now() + 62 * day, 30), { purgedCards: 0, removedAssets: 0 }, 'a second sweep is a no-op');
  const reopened = await WorkItemStore.open(root, new CaptureAssetStore(root));
  assert.ok(reopened.get(cards.done.item.uid).item.capture.assetsPurgedAt, 'the purge marker is persisted');
});

test('retention 0 keeps card images forever but still removes abandoned uploads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const s = await server(t, root), done = await s.card('done'), orphan = await s.upload(randomUUID());
  await s.close();
  const store = await WorkItemStore.open(root, new CaptureAssetStore(root));
  assert.deepEqual(await store.retention(Date.now() + 365 * day, 0), { purgedCards: 0, removedAssets: 1 });
  assert.equal(await exists(assetDir(root, done.assetId)), true); assert.equal(await exists(assetDir(root, orphan)), false);
});

test('a purged card hands off its text and says the images were cleaned, without paths', async () => {
  const item = { title: '旧卡片', detail: '说明', codeRefs: [], capture: { id: randomUUID(), mode: 'image', createdAt: new Date().toISOString(), assetIds: [randomUUID()], rawTranscript: null, assetsPurgedAt: new Date().toISOString() },
    assets: [{ id: randomUUID(), managed: true, role: 'original', relativePath: 'mobile-uploads/captures/x/image', fileName: 'a.png', size: 1, sha256: '0'.repeat(64), orientation: 1 }] };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-msg-'));
  try {
    const { text, attachments } = await handoffMessage(item, { agentId: 'codex', sessionId: 's', title: 't', cwd: '/p' }, root, null);
    assert.equal(attachments.length, 0); assert.match(text, /已按保留期从电脑上清理/); assert.doesNotMatch(text, /mobile-uploads/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
