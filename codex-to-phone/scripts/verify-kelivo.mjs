import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdir, copyFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { javaMajor, validateJavaVersions, lintCounts } from './verify-android.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const host = path.join(root, 'apps/kelivo');
const upstream = JSON.parse(await readFile(path.join(root, 'integrations/kelivo/upstream.json'), 'utf8'));
export async function verifyKelivoLock() {
  const manifest = JSON.parse(await readFile(path.join(root, 'integrations/kelivo/source-files.json'), 'utf8'));
  for (const name of ['pubspec.lock', 'dependencies/markstream/pubspec.lock']) {
    const lock = (await readFile(path.join(host, name), 'utf8')).replaceAll('https://pub.flutter-io.cn', 'https://pub.dev');
    if (createHash('sha256').update(lock).digest('hex') !== manifest.files[name]) throw new Error(`Kelivo dependency versions or package hashes changed from the fixed upstream lock: ${name}`);
  }
}
function javaVersion(home) {
  if (!home || !existsSync(path.join(home, 'bin/java'))) return null;
  const result = spawnSync(path.join(home, 'bin/java'), ['-version'], { encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? javaMajor(result.stdout + result.stderr) : null;
}
async function run(command, args, cwd, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${signal ?? code})`)));
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--preview', '--repeat-tests'].includes(arg))) throw new Error('Usage: node scripts/verify-kelivo.mjs [--preview] [--repeat-tests]');
  const candidates = [process.env.JAVA_HOME];
  for (const prefix of ['/opt/homebrew', '/usr/local']) for (const name of ['openjdk@17', 'openjdk@21', 'openjdk']) candidates.push(`${prefix}/opt/${name}/libexec/openjdk.jdk/Contents/Home`);
  const runner = process.env.MOBILE_CODEX_LINT_JAVA_HOME ?? candidates.find(home => javaVersion(home) === 17);
  const compiler = process.env.MOBILE_CODEX_COMPILE_JAVA_HOME ?? candidates.find(home => javaVersion(home) >= 21);
  const testJava = process.env.MOBILE_CODEX_TEST_JAVA_HOME ?? compiler;
  validateJavaVersions(javaVersion(runner), javaVersion(compiler));
  if (javaVersion(testJava) < 21) throw new Error('Robolectric needs a JDK21+ test JVM.');
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), 'Library/Android/sdk');
  const flutter = process.env.KELIVO_FLUTTER ?? path.join(root, '.tools/flutter', upstream.flutter.version, 'bin/flutter');
  const env = { ...process.env, JAVA_HOME: runner, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk,
    MOBILE_CODEX_COMPILE_JAVA_HOME: compiler, MOBILE_CODEX_TEST_JAVA_HOME: testJava,
    FLUTTER_SUPPRESS_ANALYTICS: 'true', PATH: `${path.dirname(flutter)}${path.delimiter}${path.join(runner, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` };
  const version = spawnSync(flutter, ['--version', '--machine'], { env, encoding: 'utf8', timeout: 30000 });
  if (version.status !== 0 || JSON.parse(version.stdout).frameworkRevision !== upstream.flutter.commit) throw new Error('Use the fixed Flutter SDK from integrations/kelivo/upstream.json.');
  await verifyKelivoLock();
  await run(process.execPath, ['scripts/build-kelivo-remote.mjs'], root, env);
  await run(flutter, ['pub', 'get', '--enforce-lockfile'], host, env);
  await verifyKelivoLock();
  await run(flutter, ['build', 'apk', '--release', '--config-only', '--target-platform', 'android-arm64'], host, env);
  await verifyKelivoLock();
  const gradleArgs = ['-I', path.join(root, 'scripts/android/lint-jdk.gradle'), '-I', path.join(root, 'integrations/kelivo/android-test-jdk.gradle')];
  if (process.env.KELIVO_GRADLE_INIT) gradleArgs.push('-I', path.resolve(process.env.KELIVO_GRADLE_INIT));
  // Only JVM system properties; no hidden tasks or shell evaluation from the environment.
  const properties = JSON.parse(process.env.KELIVO_GRADLE_PROPERTIES ?? '[]');
  if (!Array.isArray(properties) || properties.some(value => typeof value !== 'string' || !value.startsWith('-D'))) throw new Error('KELIVO_GRADLE_PROPERTIES must be a JSON array of -D properties.');
  gradleArgs.push(...properties, '-Ptarget-platform=android-arm64', '-Ptarget=lib/main.dart', '-Pbase-application-name=android.app.Application',
    '-Pdart-obfuscation=false', '-Ptrack-widget-creation=true', '-Ptree-shake-icons=true', '--max-workers=2', '--console=plain', '--continue',
    ':app:lintRelease', ':mobile-codex-remote:lintRelease', ':app:testReleaseUnitTest');
  if (args.includes('--repeat-tests')) gradleArgs.push('-PkelivoRerunTests=true');
  if (args.includes('--preview')) gradleArgs.push('-PkelivoPreviewSigning=true', ':app:assembleRelease');
  await run(path.join(host, 'android/gradlew'), gradleArgs, path.join(host, 'android'), env);
  for (const module of ['app', 'mobile-codex-remote']) {
    const counts = lintCounts(await readFile(path.join(host, 'build', module, 'reports/lint-results-release.xml'), 'utf8'));
    console.log(`[kelivo] ${module} lint: ${JSON.stringify(counts)}`);
    if (counts.Error || counts.Fatal) throw new Error('Full Android lint did not pass.');
  }
  if (args.includes('--preview')) {
    const release = path.join(host, 'build/app/outputs/apk/release');
    const metadata = JSON.parse(await readFile(path.join(release, 'output-metadata.json'), 'utf8'));
    if (metadata.applicationId !== 'com.mobilecodex.kelivo.preview' || metadata.elements.length !== 1) throw new Error('Unexpected preview identity or APK count.');
    const item = metadata.elements[0];
    if (item.versionName !== '0.1.8-native-preview' || item.versionCode !== 10 || path.basename(item.outputFile) !== item.outputFile) throw new Error('Unexpected preview version.');
    const identity = await readFile(path.join(root, 'apps/mobile/src/features/product/identity.ts'), 'utf8');
    if (!identity.includes(`productVersionCode = ${item.versionCode};`) || !identity.includes(`productVersionLabel = "v${item.versionName}";`)) throw new Error('Web and native preview versions differ.');
    const apk = path.join(release, item.outputFile);
    const buildTools = process.env.KELIVO_BUILD_TOOLS ?? (await readdir(path.join(sdk, 'build-tools'))).filter(value => existsSync(path.join(sdk, 'build-tools', value, 'apksigner'))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
    if (!buildTools) throw new Error('Android build-tools/apksigner is missing.');
    const signature = spawnSync(path.join(sdk, 'build-tools', buildTools, 'apksigner'), ['verify', '--print-certs', apk], { env, encoding: 'utf8' });
    if (signature.status !== 0) throw new Error('Preview APK signature could not be verified.');
    const output = path.join(root, 'output/kelivo'); await mkdir(output, { recursive: true });
    const destination = path.join(output, 'mobile-codex-kelivo-0.1.8-preview-arm64.apk');
    await copyFile(apk, destination);
    const bytes = await readFile(destination);
    await writeFile(`${destination}.json`, JSON.stringify({ applicationId: metadata.applicationId, versionCode: item.versionCode, versionName: item.versionName,
      abi: 'arm64-v8a', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      signing: 'Local preview signing; not a production release', signature: signature.stdout.trim(), upstreamCommit: upstream.commit }, null, 2) + '\n');
    console.log(`[kelivo] Verified signed preview: ${destination}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`[kelivo] ${error.message}`); process.exitCode = 1; });
