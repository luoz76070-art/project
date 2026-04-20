const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const rows = require('./fixtures/raw-source-rows.json');

const scriptPath = require.resolve('../scripts/extract-once');
const browserPath = require.resolve('../scripts/lib/browser');
const configPath = require.resolve('../scripts/lib/config');
const exportSourcePath = require.resolve('../scripts/export-source');
const runContextPath = require.resolve('../scripts/lib/run-context');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'extractor-cli-test-'));
}

function loadExtractOnce() {
  delete require.cache[scriptPath];
  try {
    return require(scriptPath);
  } finally {
    delete require.cache[scriptPath];
  }
}

function loadExtractOnceWithStubs(stubs) {
  const original = new Map();
  const entries = Object.entries(stubs);

  for (const [modulePath, exports] of entries) {
    original.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { exports, id: modulePath, filename: modulePath, loaded: true };
  }

  delete require.cache[scriptPath];

  try {
    return require(scriptPath);
  } finally {
    delete require.cache[scriptPath];
    for (const [modulePath] of entries) {
      const cached = original.get(modulePath);
      if (cached) {
        require.cache[modulePath] = cached;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
}

test('runExtract writes recruiting.csv and run-summary.json', async () => {
  const tempDir = await makeTempDir();
  const closed = [];

  const { runExtract } = loadExtractOnce();
  const result = await runExtract({
    rootDir: tempDir,
    config: { outputDir: './output', sourceUrl: 'https://docs.qq.com/sheet/demo' },
    openContext: async () => ({ close: async () => closed.push('closed') }),
    exportSource: async () => ({
      ok: true,
      rows,
    }),
  });

  const { runContext } = result;

  const csvText = await fs.readFile(runContext.csvPath, 'utf8');
  const summary = JSON.parse(await fs.readFile(runContext.summaryPath, 'utf8'));

  assert.match(csvText, /^record_id,snapshot_date,company_name,/);
  assert.match(csvText, /南方电网/);
  assert.equal(summary.ok, true);
  assert.equal(summary.sourceUrl, 'https://docs.qq.com/sheet/demo');
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.error, null);
  assert.deepEqual(summary.errors, []);
  assert.equal(result.runContext.csvPath, runContext.csvPath);
  assert.deepEqual(closed, ['closed']);
});

test('runExtract persists a failure summary when extraction fails', async () => {
  const tempDir = await makeTempDir();
  const closed = [];
  const { runExtract } = loadExtractOnce();
  let summaryPath = null;

  await assert.rejects(
    () =>
      runExtract({
        rootDir: tempDir,
        config: { outputDir: './output', sourceUrl: 'https://docs.qq.com/sheet/demo' },
        openContext: async () => ({ close: async () => closed.push('closed') }),
        exportSource: async (runContext) => {
          summaryPath = runContext.summaryPath;
          throw new Error('boom');
        },
      }),
    /boom/
  );

  const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));

  assert.equal(summary.ok, false);
  assert.equal(summary.sourceUrl, 'https://docs.qq.com/sheet/demo');
  assert.equal(summary.rowCount, 0);
  assert.match(summary.error, /boom/);
  assert.deepEqual(summary.errors, ['boom']);
  assert.deepEqual(closed, ['closed']);
});

test('runExtract persists record-id-collision.json when normalization detects a collision', async () => {
  const tempDir = await makeTempDir();
  const closed = [];
  const { runExtract } = loadExtractOnce();
  const collisionRows = [rows[0], rows[1], rows[1]];

  await assert.rejects(
    () =>
      runExtract({
        rootDir: tempDir,
        config: { outputDir: './output', sourceUrl: 'https://docs.qq.com/sheet/demo' },
        openContext: async () => ({ close: async () => closed.push('closed') }),
        exportSource: async () => ({
          ok: true,
          rows: collisionRows,
        }),
      }),
    /record_id collision/
  );

  const outputRoot = path.join(tempDir, 'output');
  const [runId] = await fs.readdir(outputRoot);
  const collision = JSON.parse(await fs.readFile(path.join(outputRoot, runId, 'record-id-collision.json'), 'utf8'));
  const summary = JSON.parse(await fs.readFile(path.join(outputRoot, runId, 'run-summary.json'), 'utf8'));

  assert.equal(collision.recordId.length, 64);
  assert.equal(collision.conflictingRows.length, 2);
  assert.match(summary.error, /record_id collision/);
  assert.deepEqual(closed, ['closed']);
});

test('main prints summary path before exiting on extraction failure', async () => {
  const tempDir = await makeTempDir();
  const runContext = {
    csvPath: path.join(tempDir, 'output', 'run-3', 'recruiting.csv'),
    outputDir: path.join(tempDir, 'output', 'run-3'),
    runId: 'run-3',
    snapshotDate: '2026-03-24',
    startedAt: '2026-03-24T12:00:00.000Z',
    summaryPath: path.join(tempDir, 'output', 'run-3', 'run-summary.json'),
  };

  await fs.mkdir(runContext.outputDir, { recursive: true });

  const { main } = loadExtractOnceWithStubs({
    [browserPath]: {
      openContext: async () => ({ close: async () => {} }),
    },
    [configPath]: {
      loadConfig: async () => ({ sourceUrl: 'https://docs.qq.com/sheet/demo' }),
      resolveConfigPath: () => path.join(tempDir, 'config.json'),
    },
    [exportSourcePath]: {
      exportSource: async () => {
        throw new Error('boom');
      },
    },
    [runContextPath]: {
      createRunContext: async () => runContext,
      writeJson: async (filePath, data) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      },
    },
  });

  let stdout = '';
  const originalLog = console.log;
  console.log = (value) => {
    stdout += `${value}\n`;
  };

  try {
    await assert.rejects(() => main([], tempDir), /boom/);
  } finally {
    console.log = originalLog;
  }

  assert.match(stdout, new RegExp(`SUMMARY_PATH=${runContext.summaryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});
