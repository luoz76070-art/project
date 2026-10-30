import fs from 'node:fs/promises';
import path from 'node:path';
import { createDeepSeekBridge } from './bridge.mjs';

export const name = 'mobile-codex';
export const inject = ['agents', 'sessionQuery'];

export async function apply(ctx, config) {
  const file = config?.configFile ?? process.env.MOBILE_CODEX_DEEPSEEK_CONFIG;
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('DEEPSEEK_CONFIG_INVALID');
  let settings;
  try {
    const stat = await fs.stat(file);
    if (stat.size > 65536 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('DEEPSEEK_CONFIG_PERMISSIONS');
    settings = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) { throw new Error(error.message === 'DEEPSEEK_CONFIG_PERMISSIONS' ? error.message : 'DEEPSEEK_CONFIG_INVALID'); }
  const [{ createUserMessage }, { default: llmManifest }] = await Promise.all([
    import('@deepseek-ai/dsh-llm'),
    import('@deepseek-ai/dsh-llm/package.json', { with: { type: 'json' } }),
  ]);
  // The official loader enforces engines.dsh before this plugin enters the original process.
  if (!Number.isInteger(settings?.port) || settings.port < 1) throw new Error('DEEPSEEK_CONFIG_INVALID');
  const bridge = createDeepSeekBridge(ctx, settings, createUserMessage, llmManifest.version);
  ctx.effect(() => async () => { await bridge.stop(); });
  try { await bridge.ready; } catch { await bridge.stop(); throw new Error('DEEPSEEK_BIND_FAILED'); }
}
