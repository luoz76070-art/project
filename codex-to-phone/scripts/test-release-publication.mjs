// Executes only the remote activation fragment against synthetic local files. No SSH/upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateUpdateSources } from '../apps/mobile/scripts/check-update-sources.mjs';

const updateSources = {
  VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: 'https://updates.example.test/android/latest.json',
  VITE_MOBILE_CODEX_HOT_MANIFEST_URL: 'https://updates.example.test/hot/latest.json',
};
test('packaged phone builds require both update channels; only local offline builds allow no sources', () => {
  assert.throws(() => validateUpdateSources({}), /UPDATE_MANIFEST_URL is missing/);
  assert.throws(() => validateUpdateSources({ VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: updateSources.VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL }), /HOT_MANIFEST_URL is missing/);
  assert.deepEqual(Object.values(validateUpdateSources({}, true)), ['', '']);
  assert.throws(() => validateUpdateSources({ VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: updateSources.VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL }, true), /HOT_MANIFEST_URL is missing/);
});
test('update channel validation accepts persistent production URLs and rejects malformed or public plaintext sources', () => {
  assert.deepEqual(validateUpdateSources(updateSources), updateSources);
  for (const value of ['not a URL', 'http://updates.example.test/latest.json', 'ftp://updates.example.test/latest.json', 'https://user:password@updates.example.test/latest.json']) {
    assert.throws(() => validateUpdateSources({ ...updateSources, VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: value }));
  }
  assert.equal(validateUpdateSources({ ...updateSources, VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: 'http://127.0.0.1:1234/latest.json' }).VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL, 'http://127.0.0.1:1234/latest.json');
});
const source = await fs.readFile(new URL('./upload-release-atomically.sh', import.meta.url), 'utf8');
const remote = source.split("<<'REMOTE'\n")[1].split('\nREMOTE')[0];
const hash = value => createHash('sha256').update(value).digest('hex');

for (const corrupt of [false, true]) test(`release activation ${corrupt ? 'preserves latest on checksum failure' : 'switches atomically and preserves rollback manifest'}`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const id = randomUUID(), artifact = 'synthetic-release', manifest = JSON.stringify({ version: 'fixture', sha256: hash(artifact) });
  await fs.writeFile(path.join(root, 'latest.json'), 'previous-manifest');
  await fs.writeFile(path.join(root, `.artifact-${id}.tmp`), corrupt ? 'corrupted' : artifact);
  await fs.writeFile(path.join(root, `.manifest-${id}.tmp`), manifest);
  // macOS has shasum rather than sha256sum; expose a local test shim.
  const bin = path.join(root, 'bin'); await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'sha256sum'), '#!/bin/sh\nexec shasum -a 256 "$@"\n', { mode: 0o755 });
  const result = spawnSync('bash', ['-s', '--', root, 'fixture.html', hash(artifact), String(Buffer.byteLength(artifact)), id, hash(manifest)], { input: remote, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(result.status === 0, !corrupt, result.stderr);
  assert.equal(await fs.readFile(path.join(root, 'latest.json'), 'utf8'), corrupt ? 'previous-manifest' : manifest);
  if (!corrupt) assert.equal(await fs.readFile(path.join(root, 'previous.json'), 'utf8'), 'previous-manifest');
  assert.equal(await fs.stat(path.join(root, '.publish-lock')).catch(() => null), null);
});
