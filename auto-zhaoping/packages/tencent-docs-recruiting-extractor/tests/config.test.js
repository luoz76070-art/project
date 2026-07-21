const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../scripts/lib/config');
const { createRunContext } = require('../scripts/lib/run-context');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'extractor-config-test-'));
}

test('loadConfig requires sourceUrl but not targetUrl', async () => {
  const rootDir = await makeTempDir();
  const configPath = path.join(rootDir, 'config.json');

  await fs.writeFile(configPath, JSON.stringify({ outputDir: './output' }), 'utf8');
  await assert.rejects(() => loadConfig(configPath), /sourceUrl/i);

  await fs.writeFile(
    configPath,
    JSON.stringify({ sourceUrl: 'https://docs.qq.com/sheet/demo', outputDir: './output' }),
    'utf8'
  );

  const config = await loadConfig(configPath);
  assert.equal(config.sourceUrl, 'https://docs.qq.com/sheet/demo');
  assert.equal(config.targetUrl, undefined);
});

test('createRunContext uses Asia/Shanghai snapshot date and exposes output paths', async () => {
  const rootDir = await makeTempDir();
  const config = {
    sourceUrl: 'https://docs.qq.com/sheet/demo',
    outputDir: './output',
    userDataDir: './.browser-profile',
  };
  const now = new Date('2026-03-24T16:30:00.000Z');

  const runContext = await createRunContext(rootDir, config, now);

  assert.equal(runContext.startedAt, '2026-03-24T16:30:00.000Z');
  assert.match(runContext.runId, /^2026-03-24T16-30-00-000Z$/);
  assert.equal(runContext.snapshotDate, '2026-03-25');
  assert.equal(runContext.userDataDir, path.join(rootDir, '.browser-profile'));
  assert.equal(runContext.csvPath, path.join(runContext.outputDir, 'recruiting.csv'));
  assert.equal(runContext.summaryPath, path.join(runContext.outputDir, 'run-summary.json'));

  const outputStat = await fs.stat(runContext.outputDir);
  const networkStat = await fs.stat(runContext.networkDir);
  assert.equal(outputStat.isDirectory(), true);
  assert.equal(networkStat.isDirectory(), true);
});
