const path = require('node:path');

const browser = require('./lib/browser');
const { loadConfig, resolveConfigPath } = require('./lib/config');
const { createRunContext, writeJson } = require('./lib/run-context');
const { writeCsv } = require('./lib/table');
const { normalizeRowsToRecords } = require('./normalize-records');
const sourceExport = require('./export-source');

function buildSummary(runContext, config) {
  return {
    downloads: [],
    error: null,
    errors: [],
    finishedAt: null,
    networkSamples: [],
    ok: false,
    permissionSnapshots: [],
    rowCount: 0,
    sourceUrl: config.sourceUrl,
    startedAt: runContext.startedAt,
  };
}

function recordsToRows(headers, records) {
  return [headers, ...records.map((record) => headers.map((header) => record[header] || ''))];
}

async function persistCollision(runContext, error) {
  if (!error?.collisionSample) {
    return;
  }

  const collisionPath = path.join(runContext.outputDir, 'record-id-collision.json');
  await writeJson(collisionPath, error.collisionSample);
}

async function runExtract({
  rootDir,
  config,
  openContext = browser.openContext,
  exportSource = sourceExport.exportSource,
}) {
  const runContext = await createRunContext(rootDir, config);
  const summary = buildSummary(runContext, config);
  const context = await openContext(runContext, summary);

  try {
    try {
      const exported = await exportSource(runContext, context, config, summary);
      if (!exported.ok) {
        throw new Error(exported.error || 'Source export failed');
      }

      const normalized = normalizeRowsToRecords(exported.rows, {
        extractedAt: runContext.startedAt,
        snapshotDate: runContext.snapshotDate,
        sourceUrl: config.sourceUrl,
      });
      await writeCsv(runContext.csvPath, recordsToRows(normalized.headers, normalized.records));

      summary.finishedAt = new Date().toISOString();
      summary.ok = true;
      summary.rowCount = normalized.records.length;

      await writeJson(runContext.summaryPath, summary);
      return { runContext, summary };
    } catch (error) {
      summary.error = error.message;
      summary.errors.push(error.message);
      summary.finishedAt = new Date().toISOString();
      await persistCollision(runContext, error);
      await writeJson(runContext.summaryPath, summary);
      error.runContext = runContext;
      throw error;
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const configPath = resolveConfigPath(argv, cwd);
  const config = await loadConfig(configPath);
  let result;

  try {
    result = await runExtract({ rootDir: cwd, config: { ...config, configPath } });
  } catch (error) {
    if (error.runContext?.summaryPath) {
      console.log(`SUMMARY_PATH=${error.runContext.summaryPath}`);
    }
    throw error;
  }

  const { runContext, summary } = result;

  console.log(`CSV_PATH=${runContext.csvPath}`);
  console.log(`SUMMARY_PATH=${runContext.summaryPath}`);

  if (!summary.ok) {
    throw new Error(summary.error || 'Extraction failed');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main, runExtract };
