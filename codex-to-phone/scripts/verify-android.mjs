import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';

export function javaMajor(output) {
  const value = /(?:openjdk|java) version "(\d+)/.exec(output)?.[1];
  return value ? Number(value) : null;
}

// java -version writes to stderr even on success.
function javaVersion(home) {
  if (!home || !existsSync(path.join(home, 'bin', javaExe))) return null;
  const result = spawnSync(path.join(home, 'bin', javaExe), ['-version'], { encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? javaMajor(result.stdout + result.stderr) : null;
}

export function validateJavaVersions(runner, compiler) {
  if (runner !== 17) throw new Error('Android lint requires JDK17; set MOBILE_CODEX_LINT_JAVA_HOME.');
  if (!Number.isInteger(compiler) || compiler < 21) throw new Error('Android compilation requires JDK21+; set MOBILE_CODEX_COMPILE_JAVA_HOME.');
}

export function lintCounts(xml) {
  const counts = { Error: 0, Fatal: 0, Warning: 0 };
  if (!/<issues(?:\s|>)/.test(xml)) throw new Error('Android lint XML report is missing or invalid.');
  for (const match of xml.matchAll(/<issue\b[^>]*\bseverity="(Error|Fatal|Warning)"/g)) counts[match[1]]++;
  return counts;
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: pnpm verify:android');
  const candidates = [process.env.JAVA_HOME];
  // Homebrew paths contain no user identity; explicit overrides work elsewhere.
  for (const prefix of ['/opt/homebrew', '/usr/local']) for (const name of ['openjdk@17', 'openjdk@21', 'openjdk']) {
    candidates.push(`${prefix}/opt/${name}/libexec/openjdk.jdk/Contents/Home`);
  }
  const runner = process.env.MOBILE_CODEX_LINT_JAVA_HOME ?? candidates.find(home => javaVersion(home) === 17);
  const compiler = process.env.MOBILE_CODEX_COMPILE_JAVA_HOME ?? candidates.find(home => (javaVersion(home) ?? 0) >= 21);
  validateJavaVersions(javaVersion(runner), javaVersion(compiler));
  if (!existsSync(path.join(compiler, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'))) throw new Error('Compiler JDK has no javac; set MOBILE_CODEX_COMPILE_JAVA_HOME.');
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Android/sdk') : undefined);
  if (!sdk || !existsSync(path.join(sdk, 'platforms'))) throw new Error('Android SDK not found; set ANDROID_HOME.');
  const report = path.join(root, 'apps/mobile/android/app/build/reports/lint-results-debug.xml');
  const args = ['-I', path.join(root, 'scripts/android/lint-jdk.gradle'), ':app:compileDebugJavaWithJavac', ':app:lintDebug', '--no-daemon'];
  console.log('[verify:android] JDK17 lint runner; JDK21+ Java compiler; compileDebugJavaWithJavac + lintDebug');
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.MOBILE_CODEX_GRADLE ?? 'gradle', args, {
      cwd: path.join(root, 'apps/mobile/android'), stdio: 'inherit', shell: false,
      env: { ...process.env, JAVA_HOME: runner, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, MOBILE_CODEX_COMPILE_JAVA_HOME: compiler, PATH: `${path.join(runner, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Android checks failed (${signal ?? code})`)));
  });
  const counts = lintCounts(await readFile(report, 'utf8'));
  console.log(`[verify:android] lint: ${JSON.stringify(counts)}`);
  if (counts.Error || counts.Fatal) throw new Error('Android lint reported Error/Fatal issues.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[verify:android] ${error.message}`); process.exitCode = 1; });
}
