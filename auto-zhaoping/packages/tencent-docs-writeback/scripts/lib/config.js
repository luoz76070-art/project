const fs = require('node:fs/promises');

async function loadWritebackConfig(configPath) {
  let config;

  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read writeback config at ${configPath}: ${error.message}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid writeback config at ${configPath}`);
  }

  const targetUrl = String(config.targetUrl || '').trim();
  if (!targetUrl) {
    throw new Error(`Missing targetUrl in ${configPath}`);
  }

  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('targetUrl must use http or https');
    }
  } catch (error) {
    throw new Error(`Invalid targetUrl in ${configPath}: ${targetUrl}`);
  }

  config.targetUrl = targetUrl;

  return config;
}

module.exports = { loadWritebackConfig };
