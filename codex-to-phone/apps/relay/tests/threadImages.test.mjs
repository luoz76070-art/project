import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readThreadImage, maxThreadImageBytes } from '../dist/store/threadImages.js';
import { createRelayServer } from '../dist/server/createRelayServer.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thread-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'); await fs.mkdir(project);
  await fs.writeFile(path.join(project, '截图 (1).png'), png);
  return { root, project };
}
test('project images preserve bytes for absolute, relative, encoded and file URI paths', async t => {
  const { project } = await fixture(t);
  const file = path.join(project, '截图 (1).png');
  for (const source of [file, '截图 (1).png', encodeURI(file), pathToFileURL(file).href]) {
    const image = await readThreadImage(project, source);
    assert.equal(image.mimeType, 'image/png'); assert.equal(image.size, png.length);
    assert.deepEqual(Buffer.from(image.dataUrl.split(',')[1], 'base64'), png);
  }
});
test('absolute, traversal, encoded traversal and symlink escapes cannot expose outside files', async t => {
  const { root, project } = await fixture(t);
  const outside = path.join(root, 'outside.png'); await fs.writeFile(outside, png);
  await fs.symlink(outside, path.join(project, 'link.png'));
  for (const source of [outside, '../outside.png', '%2e%2e%2foutside.png', 'link.png']) await assert.rejects(readThreadImage(project, source), { statusCode: 403 });
});
test('missing, invalid, non-raster, directory and oversized files fail with bounded errors', async t => {
  const { project } = await fixture(t);
  await fs.writeFile(path.join(project, 'fake.png'), '<svg onload="alert(1)"/>');
  await fs.mkdir(path.join(project, 'folder'));
  const big = path.join(project, 'big.png'); await fs.writeFile(big, png); await fs.truncate(big, maxThreadImageBytes + 1);
  for (const [source, statusCode] of [['missing.png', 404], ['fake.png', 415], ['folder', 415], ['big.png', 413], ['bad\0.png', 400], ['https://example.com/x.png', 400]]) {
    await assert.rejects(readThreadImage(project, source), { statusCode });
  }
});
test('HTTP image route uses authenticated thread cwd, rejects unauthenticated parsing and revocation', async t => {
  const { root, project } = await fixture(t);
  const id = '11111111-1111-4111-8111-111111111111';
  const app = await createRelayServer({ logger: false,
    config: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', codexHome: path.join(root, 'empty'), defaultCwd: root },
    services: { store: { getThreadSummary: async key => key === id ? { id, cwd: project } : null, close() {} }, desktopControl: { stop: async () => {} }, liveTurns: { stop: async () => {} } },
  });
  t.after(() => app.close());
  const url = `/api/threads/${id}/images`, auth = { authorization: 'Bearer synthetic-admin' };
  assert.equal((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{bad' })).statusCode, 401);
  const pairing = (await app.inject({ method: 'POST', url: '/api/pairing', headers: auth })).json();
  const device = (await app.inject({ method: 'POST', url: '/api/pairing/consume', payload: { code: pairing.code, name: 'image fixture' } })).json();
  const headers = { authorization: `Bearer ${device.token}` };
  const response = await app.inject({ method: 'POST', url, headers, payload: { path: '截图 (1).png' } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.json().dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { path: '../outside.png' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/threads/22222222-2222-4222-8222-222222222222/images', headers, payload: { path: '截图 (1).png' } })).statusCode, 404);
  await app.inject({ method: 'DELETE', url: `/api/devices/${device.device.id}`, headers: auth });
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { path: '截图 (1).png' } })).statusCode, 401);
});
