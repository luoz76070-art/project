import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const candidates = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin'), '/opt/homebrew/opt/openjdk@17/bin', '/opt/homebrew/opt/openjdk/bin', ''];
let javaBin;
for (const candidate of candidates) {
  if (candidate === undefined) continue;
  try { execFileSync(path.join(candidate, 'javac'), ['-version'], { stdio: 'pipe' }); javaBin = candidate; break; } catch { /* try the next installed JDK */ }
}
if (javaBin === undefined) throw new Error('A JDK is required to verify native hot update paths');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'hot-update-path-classes-'));
try {
  execFileSync(path.join(javaBin, 'javac'), ['-d', output,
    'apps/mobile/android/app/src/main/java/com/mobilecodex/app/HotUpdatePaths.java',
    'apps/mobile/tests/HotUpdatePathsTest.java'], { stdio: 'inherit' });
  execFileSync(path.join(javaBin, 'java'), ['-cp', output, 'com.mobilecodex.app.HotUpdatePathsTest'], { stdio: 'inherit' });
} finally { await fs.rm(output, { recursive: true, force: true }); }
