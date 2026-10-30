import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function verificationSteps() {
  // Only the repo's isolated test directory. Never run probe/check-*-runtime here.
  const relayTests = (await readdir(path.join(projectRoot, 'apps/relay/tests')))
    .filter(name => name.endsWith('.test.mjs')).sort().map(name => `apps/relay/tests/${name}`);
  const pnpm = script => ({ name: script, command: 'corepack', args: ['pnpm', 'run', script] });
  const node = (name, args) => ({ name, command: process.execPath, args });
  return [
    pnpm('lint'), pnpm('typecheck'), pnpm('build'), pnpm('build:plugin'),
    pnpm('test:verification'), pnpm('test:mobile'),
    node('test:relay', ['--test', '--test-concurrency=2', '--test-timeout=30000', ...relayTests]),
    pnpm('test:messages'), pnpm('test:codex-executable'), pnpm('test:hot-update'), pnpm('test:apk-update'),
    node('test:release-publication', ['--test', 'scripts/test-release-publication.mjs']),
  ];
}

export function executeStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, { cwd: projectRoot, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${step.name} failed (${signal ?? code})`)));
  });
}

export async function runSteps(steps, execute = executeStep, log = console.log) {
  for (const step of steps) {
    log(`\n[verify] ${step.name}`);
    await execute(step); // build cleans dist; consumers must always run later.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--list' && arg !== '--android')) throw new Error('Usage: pnpm verify [--list] [--android]');
    const steps = await verificationSteps();
    if (args.includes('--android')) steps.push({ name: 'verify:android', command: process.execPath, args: ['scripts/verify-android.mjs'] });
    if (args.includes('--list')) console.log(steps.map(step => `${step.name}: ${step.command} ${step.args.join(' ')}`).join('\n'));
    else { await runSteps(steps); console.log('\n[verify] All selected checks passed.'); }
  } catch (error) {
    console.error(`[verify] ${error.message}`);
    process.exitCode = 1;
  }
}
