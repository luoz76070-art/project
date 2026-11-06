import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'output/kelivo/remote-web');
const channel = JSON.parse(await readFile(path.join(root, 'integrations/kelivo/update-channel.json'), 'utf8'));
if (channel.applicationId !== 'com.mobilecodex.kelivo.preview'
  || channel.manifestUrl !== 'https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/latest.json') throw new Error('Unexpected Kelivo update channel.');
if (process.argv.length > 2) throw new Error('Usage: node scripts/build-kelivo-remote.mjs');

await mkdir(destination, { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn('corepack', ['pnpm', '--filter', '@mobile-codex/mobile', 'exec', 'vite', 'build', '--outDir', destination, '--emptyOutDir'], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    // Explicit values override the standalone app's .env.production.local.
    env: { ...process.env, VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL: channel.manifestUrl, VITE_MOBILE_CODEX_HOT_MANIFEST_URL: '', VITE_KELIVO_HOST: 'android' },
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Kelivo remote build failed (${signal ?? code})`)));
});
await writeFile(path.join(destination, 'remote-host.json'), JSON.stringify({
  revision: 1,
  applicationId: channel.applicationId,
  apkUpdateUrl: channel.manifestUrl,
  hotUpdateUrl: '',
}, null, 2) + '\n');
console.log(`[kelivo] Isolated remote Web resources: ${destination}`);
