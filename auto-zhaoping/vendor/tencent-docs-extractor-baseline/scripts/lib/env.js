const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'sync-config.json');
const OUTPUT_ROOT = path.join(ROOT_DIR, 'output');
const STATE_DIR = path.join(ROOT_DIR, 'state');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const USER_DATA_DIR = path.join(ROOT_DIR, '.browser-profile');
const RUNTIME_STATE_PATH = path.join(STATE_DIR, 'runtime-state.json');
const RUN_LOCK_PATH = path.join(STATE_DIR, 'run.lock');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensureBaseDirs() {
  await Promise.all([ensureDir(OUTPUT_ROOT), ensureDir(STATE_DIR), ensureDir(LOGS_DIR), ensureDir(USER_DATA_DIR)]);
}

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function loadConfig() {
  const config = await readJson(CONFIG_PATH);
  if (!config) {
    throw new Error(`Missing config file: ${CONFIG_PATH}`);
  }
  return config;
}

async function createRunContext(runType) {
  await ensureBaseDirs();
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(OUTPUT_ROOT, runId);
  const networkDir = path.join(outputDir, 'network');
  await ensureDir(outputDir);
  await ensureDir(networkDir);

  return {
    rootDir: ROOT_DIR,
    configPath: CONFIG_PATH,
    outputDir,
    networkDir,
    reportPath: path.join(outputDir, 'report.json'),
    runId,
    runType,
    startedAt: startedAt.toISOString(),
    userDataDir: USER_DATA_DIR,
    runtimeStatePath: RUNTIME_STATE_PATH,
    runLockPath: RUN_LOCK_PATH,
    logsDir: LOGS_DIR,
  };
}

module.exports = {
  CONFIG_PATH,
  LOGS_DIR,
  OUTPUT_ROOT,
  ROOT_DIR,
  RUN_LOCK_PATH,
  RUNTIME_STATE_PATH,
  USER_DATA_DIR,
  createRunContext,
  ensureBaseDirs,
  ensureDir,
  loadConfig,
  readJson,
  writeJson,
};
