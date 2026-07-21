const path = require('path');

const { loadConfig } = require('./lib/env');
const { exportSourceRows, openPage, waitForReady } = require('./lib/browser');
const { contentHash, detectEncodingIssues, writeRowsArtifacts } = require('./lib/table');

async function exportSource(runContext, context, config = null, report = null) {
  const activeConfig = config || (await loadConfig());
  const page = await openPage(context, activeConfig.sourceUrl);
  await waitForReady(page, report, 'source-export');
  const result = await exportSourceRows(page, runContext.outputDir, report);
  await page.close().catch(() => {});
  if (!result.ok) return result;

  const artifacts = await writeRowsArtifacts(runContext.outputDir, result.rows, 'source-rows');
  return {
    ok: true,
    method: result.method,
    rows: result.rows,
    tempFiles: [...result.files, artifacts.jsonPath, artifacts.csvPath].filter(Boolean),
    preferredFile: result.preferredFile,
    sheetName: result.sheetName,
    summary: {
      rowCount: result.rows.length,
      columnCount: Math.max(0, ...result.rows.map((row) => row.length)),
      contentHash: contentHash(result.rows),
      encodingIssues: detectEncodingIssues(result.rows),
    },
    artifacts,
  };
}

if (require.main === module) {
  const { createRunContext, loadConfig, writeJson } = require('./lib/env');
  const { openContext } = require('./lib/browser');

  (async () => {
    const config = await loadConfig();
    const runContext = await createRunContext('manual');
    const report = {
      runId: runContext.runId,
      startedAt: runContext.startedAt,
      downloads: [],
      errors: [],
      permissionSnapshots: [],
      networkSamples: [],
    };
    const context = await openContext(runContext, report);
    try {
      const result = await exportSource(runContext, context, config, report);
      await writeJson(path.join(runContext.outputDir, 'export-source-report.json'), { report, result });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await context.close();
    }
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { exportSource };
