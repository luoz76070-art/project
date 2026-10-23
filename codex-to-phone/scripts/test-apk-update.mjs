import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apk-update-tests-'));
test.after(() => fs.rm(temp, { recursive: true, force: true }));
const source = await fs.readFile(new URL('../apps/mobile/src/features/updates/apk.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
await fs.writeFile(path.join(temp, 'apk.mjs'), output.outputText);
const { parseAndroidUpdateManifest, newerApkStatus, apkCanContinue, apkBusy, apkProgress, apkStatusText, watchApkUpdate } = await import(path.join(temp, 'apk.mjs'));
const manifest = { platform: 'android', versionCode: 25, versionName: '1.3.4-fixture', apkUrl: 'https://example.com/app.apk', size: 4000000, sha256: 'AB'.repeat(32) };
const status = { supported: true, revision: 1, phase: 'idle', receivedBytes: 0, totalBytes: 4000000, versionCode: 25, versionName: 'fixture', nativeVersionCode: 24, canInstall: false, error: '' };

test('APK manifest requires complete native integrity metadata and secure URLs', () => {
  assert.equal(parseAndroidUpdateManifest(manifest).sha256, manifest.sha256.toLowerCase());
  for (const patch of [{ platform: 'ios' }, { size: undefined }, { size: -1 }, { size: 128 * 1024 * 1024 + 1 }, { sha256: undefined }, { sha256: 'bad' }, { versionCode: '25' }, { versionCode: 2.5 }, { versionCode: 0 }, { apkUrl: 'http://example.com/a' }, { apkUrl: 'https://user:pass@example.com/a' }, { apkUrl: 'https://example.com/a#hash' }]) {
    assert.throws(() => parseAndroidUpdateManifest({ ...manifest, ...patch }));
  }
  assert.throws(() => parseAndroidUpdateManifest(null));
  assert.equal(parseAndroidUpdateManifest({ ...manifest, apkUrl: 'http://127.0.0.1/a' }).apkUrl, 'http://127.0.0.1/a');
  assert.equal(parseAndroidUpdateManifest({ ...manifest, apkUrl: 'http://[::1]/a' }).apkUrl, 'http://[::1]/a');
});

test('progress and late snapshots preserve newer native states', () => {
  const downloading = { ...status, revision: 10, phase: 'downloading', receivedBytes: 2000000 };
  assert.equal(newerApkStatus(downloading, status), downloading);
  const ready = { ...status, revision: 11, phase: 'ready' };
  assert.equal(newerApkStatus(downloading, ready), ready);
  assert.equal(apkProgress(downloading), 50);
  assert.equal(apkProgress({ ...status, receivedBytes: 8000000 }), 100);
  assert.equal(apkProgress({ ...status, totalBytes: 0 }), 0);
  assert.equal(apkStatusText(downloading), '正在下载 50%');
  for (const phase of ['downloading', 'verifying', 'awaiting_install']) assert.equal(apkBusy({ ...status, phase }), true);
  for (const phase of ['ready', 'permission_required', 'error', 'idle']) assert.equal(apkBusy({ ...status, phase }), false);
});

test('permission denial and cancelled installer keep an explicit retry action without claiming success', () => {
  for (const phase of ['ready', 'permission_required', 'awaiting_install']) {
    assert.equal(apkCanContinue({ ...status, phase }), true);
    assert.doesNotMatch(apkStatusText({ ...status, phase }), /安装成功|更新成功/);
  }
  assert.equal(apkCanContinue({ ...status, phase: 'error' }), false);
  assert.equal(apkCanContinue(null), false);
});

test('subscribe before snapshot and discard late reads, remove listener on unmount or failed snapshot', async () => {
  let receive, resolveRead, removed = 0, current = null;
  const plugin = { addListener: async (_, fn) => { receive = fn; return { remove: async () => { removed++; } }; }, getStatus: () => new Promise(resolve => { resolveRead = resolve; }) };
  const pending = watchApkUpdate(plugin, next => { current = newerApkStatus(current, next); });
  await new Promise(resolve => setImmediate(resolve));
  receive({ ...status, revision: 9, phase: 'verifying' });
  resolveRead(status);
  const stop = await pending;
  assert.equal(current.revision, 9);
  await stop(); assert.equal(removed, 1);
  await assert.rejects(watchApkUpdate({ ...plugin, getStatus: async () => { throw new Error('bridge gone'); } }, () => {}));
  assert.equal(removed, 2);
});

test('native streaming downloader verifies complete bytes and cleans failures using synthetic HTTP', async () => {
  const candidates = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin'), '/opt/homebrew/opt/openjdk/bin', '/opt/homebrew/opt/openjdk@21/bin', ''];
  let java;
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try { execFileSync(path.join(candidate, 'javac'), ['-version'], { stdio: 'pipe' }); java = candidate; break; } catch {}
  }
  assert.notEqual(java, undefined, 'JDK required');
  execFileSync(path.join(java, 'javac'), ['--add-modules', 'jdk.httpserver', '-d', temp,
    'apps/mobile/android/app/src/main/java/com/mobilecodex/app/ApkUpdateDownload.java',
    'apps/mobile/android/app/src/main/java/com/mobilecodex/app/ApkUpdateIdentity.java', 'apps/mobile/tests/ApkUpdateDownloadTest.java'], { stdio: 'inherit' });
  execFileSync(path.join(java, 'java'), ['--add-modules', 'jdk.httpserver', '-cp', temp, 'com.mobilecodex.app.ApkUpdateDownloadTest'], { stdio: 'inherit', timeout: 30000 });
});
