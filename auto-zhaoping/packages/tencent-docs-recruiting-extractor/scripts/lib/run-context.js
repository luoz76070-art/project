const fs = require('node:fs/promises');
const path = require('node:path');

const { resolvePackagePath } = require('./config');

function formatSnapshotDate(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function createRunContext(rootDir, config, now = new Date()) {
  const startedAt = now.toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');
  const outputRoot = resolvePackagePath(rootDir, config.outputDir || './output');
  const outputDir = path.join(outputRoot, runId);
  const networkDir = path.join(outputDir, 'network');
  const userDataDir = resolvePackagePath(rootDir, config.userDataDir || './.browser-profile');
  const timezone = config.timezone || 'Asia/Shanghai';

  await Promise.all([ensureDir(outputDir), ensureDir(networkDir), ensureDir(userDataDir)]);

  return {
    configPath: config.configPath,
    csvPath: path.join(outputDir, 'recruiting.csv'),
    networkDir,
    outputDir,
    rootDir,
    runId,
    snapshotDate: formatSnapshotDate(now, timezone),
    startedAt,
    summaryPath: path.join(outputDir, 'run-summary.json'),
    userDataDir,
  };
}

module.exports = {
  createRunContext,
  ensureDir,
  writeJson,
};
