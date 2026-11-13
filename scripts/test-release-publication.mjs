// Executes only the remote activation fragment against synthetic local files. No SSH/upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateUpdateSources } from '../apps/mobile/scripts/check-update-sources.mjs';
import { createAndroidManifest, createHotManifest } from './create-github-update-manifest.mjs';

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

test('update channel validation rejects shared GitHub latest URLs', () => {
  assert.throws(() => validateUpdateSources({
    ...updateSources,
    VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: 'https://github.com/luoz76070-art/project/releases/latest/download/android-latest.json',
    VITE_MOBILE_CODEX_HOT_MANIFEST_URL: 'https://github.com/luoz76070-art/project/releases/latest/download/hot-latest.json',
  }), /product-specific GitHub Release tag/);
});

test('GitHub Android and hot manifests carry artifact integrity and immutable release URLs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'github-update-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const apk = path.join(root, 'mobile-codex-1.3.18-abc123.apk');
  const html = path.join(root, 'mobile-codex-1.3.18-hot.39-def456.html');
  await fs.writeFile(apk, 'synthetic apk');
  await fs.writeFile(html, '<!doctype html><meta name="mobile-codex-hot-bundle" content="fixture">');
  const android = await createAndroidManifest({ artifact: apk, repository: 'owner/project', releaseTag: 'mobicodex-v1.3.18', versionName: '1.3.18', versionCode: '39', notes: 'release' });
  assert.equal(android.platform, 'android');
  assert.equal(android.versionCode, 39);
  assert.match(android.apkUrl, /releases\/download\/mobicodex-v1\.3\.18\/mobile-codex-1\.3\.18-abc123\.apk$/);
  assert.equal(android.size, Buffer.byteLength('synthetic apk'));
  assert.match(android.sha256, /^[a-f0-9]{64}$/);
  const hot = await createHotManifest({ artifact: html, repository: 'owner/project', releaseTag: 'mobicodex-v1.3.18', version: '1.3.18-hot.39', minNativeVersionCode: '39', maxNativeVersionCode: '39' });
  assert.equal(hot.channel, 'hot');
  assert.equal(hot.minNativeVersionCode, 39);
  assert.match(hot.htmlUrl, /mobile-codex-1\.3\.18-hot\.39-def456\.html$/);
  await assert.rejects(createAndroidManifest({ artifact: apk, repository: 'owner/project', releaseTag: 'bad/tag', versionName: '1.3.18', versionCode: '39' }), /Invalid release-tag/);
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
