import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { verificationSteps, runSteps, executeStep, projectRoot } from './verify.mjs';
import { javaMajor, validateJavaVersions, lintCounts } from './verify-android.mjs';

test('verification runs sequentially and stops at the first failed check', async () => {
  const seen = [], stages = [{ name: 'build' }, { name: 'test' }, { name: 'later' }];
  await assert.rejects(runSteps(stages, async step => {
    seen.push(step.name);
    if (step.name === 'test') throw new Error('synthetic test failure');
    await Promise.resolve();
  }, () => {}), /synthetic test failure/);
  assert.deepEqual(seen, ['build', 'test']);
});

test('verification propagates the real child exit status', async () => {
  await assert.rejects(executeStep({ name: 'synthetic', command: process.execPath, args: ['-e', 'process.exit(7)'] }), /synthetic failed \(7\)/);
});

test('verification builds artifacts before isolated relay consumers and excludes runtime probes', async () => {
  const steps = await verificationSteps(), names = steps.map(step => step.name);
  assert.ok(names.indexOf('build') < names.indexOf('test:relay'));
  assert.ok(names.indexOf('build:plugin') < names.indexOf('test:relay'));
  assert.ok(steps.find(step => step.name === 'test:relay').args.includes('apps/relay/tests/diagnostics.test.mjs'));
  assert.ok(names.includes('test:mobile') && names.includes('test:verification'));
  assert.equal(JSON.stringify(steps).includes('probe:'), false);
  assert.equal(JSON.stringify(steps).includes('upload-release'), false);
});

test('configured lint actually rejects JS correctness and scoped TS unused variables', async () => {
  const lint = new ESLint({ cwd: projectRoot });
  const [badJs] = await lint.lintText('debugger; new Promise(async resolve => resolve());', { filePath: 'scripts/synthetic.mjs' });
  assert.ok(badJs.messages.some(item => item.ruleId === 'no-debugger'));
  assert.ok(badJs.messages.some(item => item.ruleId === 'no-async-promise-executor'));
  const [badTs] = await lint.lintText('const unused: number = 1;', { filePath: 'apps/mobile/src/features/chat/runtimeSync.ts' });
  assert.ok(badTs.messages.some(item => item.ruleId === '@typescript-eslint/no-unused-vars'));
  const [valid] = await lint.lintText('export const sample: number = 1;', { filePath: 'apps/mobile/src/features/chat/runtimeSync.ts' });
  assert.equal(valid.errorCount, 0);
});

test('Android validation distinguishes runner/compiler and counts fatal lint issues', () => {
  assert.equal(javaMajor('openjdk version "17.0.18" 2026-01-20'), 17);
  assert.equal(javaMajor('java version "25.0.2"'), 25);
  assert.equal(javaMajor('not java'), null);
  assert.doesNotThrow(() => validateJavaVersions(17, 21));
  assert.doesNotThrow(() => validateJavaVersions(17, 25));
  assert.throws(() => validateJavaVersions(25, 25), /JDK17/);
  assert.throws(() => validateJavaVersions(17, 17), /JDK21/);
  assert.deepEqual(lintCounts('<issues><issue id="a" severity="Warning"/><issue id="b"\n severity="Fatal"/></issues>'), { Error: 0, Fatal: 1, Warning: 1 });
  assert.throws(() => lintCounts('broken report'), /invalid/);
});

test('Android entry fails explicitly for an unavailable override without launching Gradle', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-android.mjs'], {
    cwd: projectRoot, encoding: 'utf8',
    env: { ...process.env, MOBILE_CODEX_LINT_JAVA_HOME: '/synthetic-missing-jdk', MOBILE_CODEX_COMPILE_JAVA_HOME: '/synthetic-missing-jdk', MOBILE_CODEX_GRADLE: '/must-not-launch-gradle' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MOBILE_CODEX_LINT_JAVA_HOME/);
  assert.equal(result.stderr.includes('must-not-launch'), false);
});
