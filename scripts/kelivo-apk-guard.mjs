// Release-build guard: Capacitor resolves plugin metadata reflectively. In
// 0.1.9, R8 removed PluginHandle.pluginAnnotation and compiled every Capacitor
// permission check to `throw null`, so starting a voice recording crashed the
// app. A kept bridge leaves these names in the dex string pool.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['Lcom/getcapacitor/PluginHandle;', 'pluginAnnotation', 'getPermissionStates', 'Lcom/getcapacitor/annotation/Permission;'];

export function assertCapacitorReflectionKept(apk) {
  const list = spawnSync('unzip', ['-Z1', apk], { encoding: 'utf8' });
  if (list.status !== 0) throw new Error(`Cannot list ${apk}`);
  const dexes = list.stdout.split('\n').filter(name => /^classes\d*\.dex$/u.test(name));
  if (!dexes.length) throw new Error('APK has no classes.dex');
  const found = new Set();
  for (const dex of dexes) {
    const bytes = spawnSync('unzip', ['-p', apk, dex], { maxBuffer: 1 << 30 });
    if (bytes.status !== 0) throw new Error(`Cannot read ${dex} from ${apk}`);
    for (const marker of required) if (bytes.stdout.includes(Buffer.from(marker))) found.add(marker);
  }
  const missing = required.filter(marker => !found.has(marker));
  if (missing.length) throw new Error(`R8 stripped Capacitor reflection metadata (${missing.join(', ')}); voice permission checks would crash. Check integrations/kelivo/remote-android/consumer-rules.pro.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertCapacitorReflectionKept(process.argv[2]); console.log('[kelivo] Capacitor reflection metadata kept'); }
  catch (error) { console.error(`[kelivo] ${error.message}`); process.exitCode = 1; }
}
