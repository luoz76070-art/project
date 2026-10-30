import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist-plugin');
const plugin = path.join(output, 'mobile-codex');
await fs.rm(plugin, { recursive: true, force: true });
await fs.mkdir(plugin, { recursive: true });
await fs.cp(path.join(root, 'plugins/mobile-codex'), plugin, { recursive: true });
await fs.copyFile(path.join(root, 'LICENSE'), path.join(plugin, 'LICENSE'));
await build({
  entryPoints: [path.join(root, 'apps/relay/src/gateway/main.ts')], outfile: path.join(plugin, 'lib/gateway.mjs'),
  bundle: true, platform: 'node', target: 'node20', format: 'esm', minify: true,
  define: { __GATEWAY_BUILD_ID__: JSON.stringify(`gateway-${randomUUID()}`) },
  banner: { js: "import { createRequire as _createRequire } from 'node:module'; const require = _createRequire(import.meta.url);" },
});
const marketplace = { name: 'mobile-codex-local', interface: { displayName: 'Mobile Codex 本地预览' }, plugins: [{ name: 'mobile-codex', source: { source: 'local', path: './mobile-codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] };
await fs.mkdir(path.join(output, '.agents/plugins'), { recursive: true });
await fs.writeFile(path.join(output, '.agents/plugins/marketplace.json'), JSON.stringify(marketplace, null, 2) + '\n');
console.log(`Plugin built: ${plugin}`);
const claudePlugin = path.join(output, 'mobile-claude');
await fs.rm(claudePlugin, { recursive: true, force: true });
await fs.cp(path.join(root, 'plugins/mobile-claude'), claudePlugin, { recursive: true });
await fs.copyFile(path.join(root, 'LICENSE'), path.join(claudePlugin, 'LICENSE'));
console.log(`Claude mod built: ${claudePlugin}`);
const deepSeekPlugin = path.join(output, 'mobile-deepseek');
await fs.rm(deepSeekPlugin, { recursive: true, force: true });
await fs.cp(path.join(root, 'plugins/mobile-deepseek'), deepSeekPlugin, { recursive: true });
await fs.copyFile(path.join(root, 'LICENSE'), path.join(deepSeekPlugin, 'LICENSE'));
console.log(`DeepSeek bundle built: ${deepSeekPlugin}`);
