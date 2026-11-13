import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { MacGatewayService, gatewayServiceLabel } from '../dist/gateway/macService.js';
import { initializeGateway, readManagedConfig } from '../dist/gateway/config.js';
import { gatewayErrorMessage, inspectGateway, runGatewayCli } from '../dist/gateway/cli.js';

const execute = promisify(execFile);
const absent = { code: 113, stdout: '', stderr: 'Bad request.\nCould not find service "local.mobile-codex.gateway" in domain for user gui: 501\n' };
const ok = { code: 0, stdout: 'synthetic loaded job', stderr: '' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 8000;
  while (!await check()) { assert.ok(Date.now() < end, 'Synthetic service timed out'); await pause(15); }
}
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-gateway-service-'));
  const home = path.join(root, 'home & "test"'), workspace = path.join(root, 'work <test>'), codexHome = path.join(root, 'codex');
  await Promise.all([home, workspace, codexHome].map(dir => fs.mkdir(dir)));
  const listener = http.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const configFile = path.join(root, 'private/gateway.json');
  await initializeGateway(configFile, { workspace, codexHome, port });
  const config = await readManagedConfig(configFile);
  const entry = path.join(root, 'gateway.mjs'); await fs.writeFile(entry, '// synthetic self-contained gateway\n');
  const calls = [];
  const state = { loaded: false, override: null, hook: null };
  const run = async args => {
    calls.push(args);
    if (state.override) return state.override(args);
    if (args[0] === 'print') return state.loaded ? ok : absent;
    if (args[0] === 'bootstrap') state.loaded = true;
    if (args[0] === 'bootout') state.loaded = false;
    await state.hook?.(args);
    return ok;
  };
  const service = new MacGatewayService({ home, platform: 'darwin', uid: 501, nodePath: process.execPath, run, ...options });
  const stops = [];
  t.after(async () => { for (const stop of stops.reverse()) await stop(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, home, configFile, config, entry, service, calls, state, stops, install: () => service.install(configFile, config, entry) };
}

test('service status and regular registration lookup are passive and never create files', async t => {
  const f = await fixture(t);
  assert.equal(await f.service.registered(f.configFile), false);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.service.status(f.configFile), { installed: false, loaded: false, label: gatewayServiceLabel, restartOnFailure: false });
  assert.deepEqual(await fs.readdir(f.home), []);
  assert.deepEqual(f.calls, [['print', 'gui/501/local.mobile-codex.gateway']]);
});

test('unsupported platform and root refuse explicit installation without creating service files', async t => {
  for (const options of [{ platform: 'linux' }, { uid: 0 }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.install(), { code: 'GATEWAY_SERVICE_UNSUPPORTED' });
    await assert.rejects(f.service.status(f.configFile), { code: 'GATEWAY_SERVICE_UNSUPPORTED' });
    assert.equal(await f.service.registered(f.configFile), false);
    assert.equal(f.calls.length, 0); assert.deepEqual(await fs.readdir(f.home), []);
  }
});

test('install pins immutable private program and receipt, escaping plist paths without copying secrets', async t => {
  const f = await fixture(t), before = await fs.readFile(f.configFile, 'utf8');
  assert.equal((await f.install()).loaded, true);
  const receipt = JSON.parse(await fs.readFile(f.service.receiptFile, 'utf8'));
  const bundle = path.join(f.service.root, `gateway-${receipt.bundleSha256}.mjs`);
  assert.deepEqual(await fs.readFile(bundle), await fs.readFile(f.entry));
  assert.equal(receipt.bundleSha256, createHash('sha256').update(await fs.readFile(f.entry)).digest('hex'));
  assert.deepEqual(f.calls, [['print', 'gui/501/local.mobile-codex.gateway'], ['bootstrap', 'gui/501', f.service.plistFile], ['print', 'gui/501/local.mobile-codex.gateway']]);
  for (const file of [f.service.receiptFile, f.service.plistFile, bundle]) {
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const bytes = await fs.readFile(file, 'utf8');
    for (const secret of [f.config.token, f.config.managerKey, f.config.codexHome]) assert.ok(!bytes.includes(secret));
  }
  assert.equal((await fs.stat(f.service.root)).mode & 0o777, 0o700);
  const plist = await fs.readFile(f.service.plistFile, 'utf8');
  assert.ok(plist.includes('home &amp; &quot;test&quot;')); assert.ok(plist.includes('work &lt;test&gt;'));
  assert.equal(await fs.readFile(f.configFile, 'utf8'), before);
  await fs.rm(f.entry);
  assert.equal(await f.service.registered(f.configFile), true, 'plugin cache removal leaves the fixed program available');
  await f.service.start(f.configFile);
  assert.deepEqual(f.calls.at(-1), ['kickstart', 'gui/501/local.mobile-codex.gateway']);
});

test('real plutil decodes generated launch policy and exact argv without registering a job', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t); await f.install();
  const { stdout } = await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', f.service.plistFile]);
  const plist = JSON.parse(stdout), receipt = JSON.parse(await fs.readFile(f.service.receiptFile, 'utf8'));
  assert.equal(plist.Label, gatewayServiceLabel);
  assert.deepEqual(plist.ProgramArguments, [process.execPath, path.join(f.service.root, `gateway-${receipt.bundleSha256}.mjs`), 'daemon', '--config', f.configFile]);
  assert.deepEqual(plist.KeepAlive, { SuccessfulExit: false });
  assert.equal(plist.RunAtLoad, true); assert.equal(plist.ThrottleInterval, 15); assert.equal(plist.LimitLoadToSessionType, 'Aqua');
  assert.deepEqual(plist.EnvironmentVariables, { HOME: f.home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` });
  assert.equal(plist.WorkingDirectory, f.config.workspace);
});

test('legacy App login item and unknown loaded label prevent installation without replacing anything', async t => {
  for (const mode of ['legacy', 'unknown']) {
    const f = await fixture(t);
    if (mode === 'legacy') {
      const legacy = path.join(f.home, 'Library/LaunchAgents/local.mobile-codex.relay.plist');
      await fs.mkdir(path.dirname(legacy), { recursive: true }); await fs.writeFile(legacy, 'old app');
    } else f.state.loaded = true;
    await assert.rejects(f.install(), { code: mode === 'legacy' ? 'GATEWAY_LEGACY_AUTOSTART_PRESENT' : 'GATEWAY_SERVICE_CONFLICT' });
    assert.ok(!f.calls.some(call => call[0] === 'bootstrap' || call[0] === 'bootout'));
    assert.deepEqual(await fs.readdir(f.service.root), []);
  }
});

test('install is exclusive and a second configuration cannot manage the existing service', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.install(), f.install(), f.install()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'bootstrap').length, 1);
  const before = await fs.readFile(f.service.receiptFile, 'utf8');
  await assert.rejects(f.install(), { code: 'GATEWAY_SERVICE_ALREADY_INSTALLED' });
  const other = path.join(f.root, 'other.json');
  assert.equal(await f.service.registered(other), false);
  await assert.rejects(f.service.start(other), { code: 'GATEWAY_SERVICE_CONFIG_MISMATCH' });
  await assert.rejects(f.service.uninstall(other), { code: 'GATEWAY_SERVICE_CONFIG_MISMATCH' });
  assert.equal(await fs.readFile(f.service.receiptFile, 'utf8'), before);
  assert.ok(!f.calls.some(call => call[0] === 'bootout'));
});

test('status failure is unknown instead of absent and never triggers bootstrap', async t => {
  for (const response of [{ code: 1, stdout: '', stderr: 'Operation not permitted' }, { code: 113, stdout: '', stderr: 'Could not find domain' }]) {
    const f = await fixture(t); f.state.override = () => response;
    await assert.rejects(f.install(), { code: 'GATEWAY_SERVICE_STATUS_UNKNOWN' });
    assert.ok(f.calls.every(call => call[0] === 'print'));
    assert.deepEqual(await fs.readdir(f.service.root), []);
  }
});

test('failed or timed out activation retains exact ownership files for explicit recovery', async t => {
  for (const mode of ['failed', 'timeout']) {
    const f = await fixture(t);
    f.state.override = args => {
      if (args[0] === 'print') return absent;
      if (mode === 'timeout') throw Object.assign(new Error('synthetic timeout'), { code: 'GATEWAY_SERVICE_REQUEST_UNKNOWN' });
      return { code: 5, stdout: '', stderr: 'synthetic failure with private content' };
    };
    await assert.rejects(f.install(), { code: mode === 'timeout' ? 'GATEWAY_SERVICE_REQUEST_UNKNOWN' : 'GATEWAY_SERVICE_ACTIVATION_FAILED' });
    await fs.access(f.service.receiptFile); await fs.access(f.service.plistFile);
    assert.ok(!(await fs.readdir(f.service.root)).includes('operation.lock'));
    f.state.override = null;
    assert.equal((await f.service.uninstall(f.configFile)).removed, true);
  }
});

test('receipt, plist and fixed-program changes refuse all ownership-sensitive operations', async t => {
  for (const mode of ['receipt', 'plist', 'bundle', 'permissions', 'symlink']) {
    const f = await fixture(t); await f.install(); f.calls.length = 0;
    const receipt = JSON.parse(await fs.readFile(f.service.receiptFile, 'utf8'));
    if (mode === 'receipt') await fs.writeFile(f.service.receiptFile, '{}');
    if (mode === 'plist') await fs.appendFile(f.service.plistFile, '\n<!-- external edit -->');
    if (mode === 'bundle') await fs.appendFile(path.join(f.service.root, `gateway-${receipt.bundleSha256}.mjs`), '// changed');
    if (mode === 'permissions') await fs.chmod(f.service.receiptFile, 0o644);
    if (mode === 'symlink') { const moved = f.service.plistFile + '.original'; await fs.rename(f.service.plistFile, moved); await fs.symlink(moved, f.service.plistFile); }
    await assert.rejects(f.service.start(f.configFile));
    await assert.rejects(f.service.uninstall(f.configFile));
    assert.equal(f.calls.length, 0);
    await fs.access(f.service.receiptFile); await fs.lstat(f.service.plistFile);
  }
});

test('registered start bootstraps an unloaded job and never kills an already loaded instance', async t => {
  const f = await fixture(t); await f.install();
  f.state.loaded = false; f.calls.length = 0;
  await f.service.start(f.configFile);
  assert.deepEqual(f.calls, [['print', 'gui/501/local.mobile-codex.gateway'], ['bootstrap', 'gui/501', f.service.plistFile]]);
  f.calls.length = 0;
  await f.service.start(f.configFile);
  assert.deepEqual(f.calls, [['print', 'gui/501/local.mobile-codex.gateway'], ['kickstart', 'gui/501/local.mobile-codex.gateway']]);
});

test('uninstall confirms job removal and preserves original config, device file and fixed program', async t => {
  const f = await fixture(t); await f.install();
  const devices = path.join(f.config.workspace, '.mobile-codex/devices.json');
  await fs.mkdir(path.dirname(devices)); await fs.writeFile(devices, 'synthetic device registry');
  const before = await fs.readFile(f.configFile, 'utf8');
  const receipt = JSON.parse(await fs.readFile(f.service.receiptFile, 'utf8'));
  assert.equal((await f.service.uninstall(f.configFile)).removed, true);
  assert.deepEqual(f.calls.slice(-3), [['print', 'gui/501/local.mobile-codex.gateway'], ['bootout', 'gui/501/local.mobile-codex.gateway'], ['print', 'gui/501/local.mobile-codex.gateway']]);
  await assert.rejects(fs.access(f.service.plistFile), { code: 'ENOENT' });
  await assert.rejects(fs.access(f.service.receiptFile), { code: 'ENOENT' });
  await fs.access(path.join(f.service.root, `gateway-${receipt.bundleSha256}.mjs`));
  assert.equal(await fs.readFile(f.configFile, 'utf8'), before);
  assert.equal(await fs.readFile(devices, 'utf8'), 'synthetic device registry');
  assert.equal((await f.service.uninstall(f.configFile)).removed, false);
});

test('unconfirmed removal retains registration and never deletes another job on missing receipt', async t => {
  const f = await fixture(t); await f.install();
  f.state.override = args => args[0] === 'print' ? ok : { code: 5, stdout: '', stderr: 'synthetic denied' };
  await assert.rejects(f.service.uninstall(f.configFile), { code: 'GATEWAY_SERVICE_STOP_UNCONFIRMED' });
  await fs.access(f.service.plistFile); await fs.access(f.service.receiptFile);
  f.state.override = null;
  await fs.rm(f.service.receiptFile); f.calls.length = 0;
  await assert.rejects(f.service.uninstall(f.configFile), { code: 'GATEWAY_SERVICE_CONFLICT' });
  assert.equal(f.calls.length, 0);
});

test('missing Node rejects start but damaged gateway config does not prevent explicit service removal', async t => {
  const f = await fixture(t);
  const runtime = path.join(f.root, 'node'); await fs.writeFile(runtime, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const service = new MacGatewayService({ home: f.home, platform: 'darwin', uid: 501, nodePath: runtime, run: async args => {
    f.calls.push(args);
    if (args[0] === 'print') return f.state.loaded ? ok : absent;
    if (args[0] === 'bootstrap') f.state.loaded = true;
    if (args[0] === 'bootout') f.state.loaded = false;
    return ok;
  } });
  await service.install(f.configFile, f.config, f.entry);
  await fs.rm(runtime);
  await assert.rejects(service.start(f.configFile), { code: 'GATEWAY_SERVICE_RUNTIME_MISSING' });
  await fs.writeFile(f.configFile, '{invalid');
  const deps = { macService: service };
  assert.equal((await runGatewayCli(['service', 'status', '--config', f.configFile], f.entry, deps)).installed, true);
  assert.equal((await runGatewayCli(['service', 'uninstall', '--config', f.configFile], f.entry, deps)).removed, true);
  assert.equal(await fs.readFile(f.configFile, 'utf8'), '{invalid');
});

test('failed start of registered service does not fall back to an ordinary detached gateway', async t => {
  const f = await fixture(t); await f.install();
  f.state.override = args => args[0] === 'print' ? ok : { code: 5, stdout: '', stderr: 'synthetic denied start' };
  await assert.rejects(runGatewayCli(['start', '--config', f.configFile], f.entry, { macService: f.service }), { code: 'GATEWAY_SERVICE_ACTIVATION_FAILED' });
  assert.equal(await inspectGateway(f.config), null);
  assert.ok(!f.calls.some(call => call.includes('-k')));
  await fs.access(f.service.receiptFile);
});

test('service CLI rejects malformed arguments and reports only stable errors', async () => {
  for (const args of [['service'], ['service', 'restart'], ['service', 'install', '--config'], ['service', 'status', '--extra', 'value']]) {
    await assert.rejects(runGatewayCli(args, '/unused/gateway.mjs'), { code: 'GATEWAY_USAGE' });
  }
  assert.ok((await runGatewayCli(['help'], '/unused/gateway.mjs')).commands.includes('service install|status|uninstall (macOS)'));
  const value = gatewayErrorMessage(Object.assign(new Error('sensitive stderr'), { code: 'GATEWAY_SERVICE_ACTIVATION_FAILED' }));
  assert.equal(value.error, 'GATEWAY_SERVICE_ACTIVATION_FAILED');
  assert.ok(!JSON.stringify(value).includes('sensitive'));
});

test('built program survives plugin deletion and exits zero on normal stop; managed start reuses registration', async t => {
  const f = await fixture(t);
  await fs.copyFile(new URL('../../../dist-plugin/mobile-codex/lib/gateway.mjs', import.meta.url), f.entry);
  let child, childClosed;
  const startOwned = async () => {
    if (child && child.exitCode === null && child.signalCode === null) return;
    const receipt = JSON.parse(await fs.readFile(f.service.receiptFile, 'utf8'));
    const bundle = path.join(f.service.root, `gateway-${receipt.bundleSha256}.mjs`);
    child = spawn(process.execPath, [bundle, 'daemon', '--config', f.configFile], { cwd: f.config.workspace, env: { PATH: process.env.PATH, HOME: f.home, USERPROFILE: f.home }, stdio: ['ignore', 'ignore', 'pipe'] });
    childClosed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  };
  f.stops.push(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await childClosed; }
  });
  f.state.hook = async args => {
    if (args[0] === 'bootstrap' || args[0] === 'kickstart') await startOwned();
    if (args[0] === 'bootout' && child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await childClosed; }
  };
  const cli = args => runGatewayCli([...args, '--config', f.configFile], f.entry, { macService: f.service });
  const installation = await cli(['service', 'install']);
  assert.equal(installation.running, true);
  const first = installation.gateway.instanceId;
  await fs.rm(f.entry);
  assert.equal((await cli(['stop'])).stopped, true);
  assert.deepEqual(await childClosed, { code: 0, signal: null });
  assert.equal(await inspectGateway(f.config), null);
  assert.equal((await cli(['service', 'status'])).loaded, true, 'registration remains loaded after a successful exit');
  assert.equal(f.calls.filter(call => call[0] === 'bootstrap').length, 1);
  const started = await cli(['start']);
  assert.equal(started.managedBy, 'launchd'); assert.notEqual(started.gateway.instanceId, first);
  assert.equal(f.calls.filter(call => call[0] === 'kickstart').length, 1);
  assert.equal((await cli(['service', 'uninstall'])).removed, true);
  await until(async () => await inspectGateway(f.config) === null);
  assert.deepEqual(await childClosed, { code: 0, signal: null });
  assert.deepEqual(await fs.readdir(f.config.codexHome), [], 'no real agent is started or read');
});
