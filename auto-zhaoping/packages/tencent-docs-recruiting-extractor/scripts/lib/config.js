const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.join('config', 'extractor.config.local.json');

function resolvePackagePath(rootDir, relativePath) {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return path.resolve(rootDir, relativePath);
}

function resolveConfigPath(argv, cwd = process.cwd()) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config' && argv[index + 1]) {
      return path.resolve(cwd, argv[index + 1]);
    }
    if (arg.startsWith('--config=')) {
      return path.resolve(cwd, arg.slice('--config='.length));
    }
  }

  return path.resolve(cwd, DEFAULT_CONFIG_PATH);
}

async function loadConfig(configPath) {
  let text;
  try {
    text = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Missing config file: ${configPath}`);
    }
    throw error;
  }

  const loaded = JSON.parse(text);
  if (!loaded.sourceUrl) {
    throw new Error('Config must include sourceUrl');
  }

  return {
    timezone: 'Asia/Shanghai',
    outputDir: './output',
    userDataDir: './.browser-profile',
    ...loaded,
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadConfig,
  resolveConfigPath,
  resolvePackagePath,
};
