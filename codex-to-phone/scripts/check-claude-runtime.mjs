import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Opt-in official validator/test runner only. Never installs or starts a session.
const binary = process.argv[2];
if (!binary || !path.isAbsolute(binary) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/check-claude-runtime.mjs <absolute-isolated-claude-binary>');
}
const version = '2.1.287';
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-claude-runtime-check-'));
try {
  for (const name of ['home', 'config', 'tmp', 'work']) await fs.mkdir(path.join(sandbox, name), { mode: 0o700 });
  const plugin = path.join(sandbox, 'plugin');
  await fs.cp(fileURLToPath(new URL('../plugins/mobile-claude', import.meta.url)), plugin, { recursive: true });
  await fs.cp(fileURLToPath(new URL('./fixtures/claude-official-runtime', import.meta.url)), path.join(plugin, 'tests'), { recursive: true });
  const env = {
    PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8',
    HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home'),
    CLAUDE_CONFIG_DIR: path.join(sandbox, 'config'), TMPDIR: path.join(sandbox, 'tmp'),
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  const results = [];
  function run(args) {
    const result = spawnSync(binary, args, { cwd: path.join(sandbox, 'work'), env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(result.error);
    const stdout = result.stdout.replaceAll(sandbox, '<isolated-profile>'), stderr = result.stderr.replaceAll(sandbox, '<isolated-profile>');
    results.push({ args: args.map(arg => arg.replaceAll(sandbox, '<isolated-profile>')), exitCode: result.status, stdout, stderr });
    assert.equal(result.status, 0, stdout + stderr);
    return stdout;
  }
  assert.equal(run(['--version']).trim(), `${version} (Claude Code)`);
  const validation = run(['plugin', 'validate', '--strict', plugin]);
  assert.match(validation, /Validation passed/u);
  for (const hook of ['session.start', 'turn.start', 'turn.step', 'tool.call', 'classic.PreToolUse', 'classic.PermissionRequest', 'turn.complete', 'session.end']) assert.ok(validation.includes(hook), `Missing host hook: ${hook}`);
  for (const api of ['$.clock.after', '$.env.get', '$.http.fetch', '$.prompt.submit', '$.session.cwd', '$.session.id', '$.session.messages', '$.session.version', '$.turn.abort']) assert.ok(validation.includes(api), `Missing host API: ${api}`);
  const tests = run(['plugin', 'test', plugin]);
  assert.match(tests, /\b7 pass\b/u);
  assert.match(tests, /\b0 fail\b/u);
  console.log(JSON.stringify({ version, checks: { officialVersionGate: true, officialStrictValidation: true, officialHostTests: true }, officialTestCount: 7, fixtureHttpCallsMocked: true, externalModelRequests: 0, userProfilesChanged: false, originalSessionControlVerified: false, results }, null, 2));
} finally {
  await fs.rm(sandbox, { recursive: true, force: true });
}
