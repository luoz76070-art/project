const { contentHash, detectEncodingIssues, writeRowsArtifacts } = require('./lib/table');
const { exportSourceRows, openPage, waitForReady } = require('./lib/browser');

async function exportSource(runContext, context, config, report = null) {
  const page = await openPage(context, config.sourceUrl);

  try {
    await waitForReady(page, report, 'source-export');
    const result = await exportSourceRows(page, runContext.outputDir, report);
    if (!result.ok) {
      return result;
    }

    const artifacts = await writeRowsArtifacts(runContext.outputDir, result.rows, 'source-rows');

    return {
      artifacts,
      method: result.method,
      ok: true,
      preferredFile: result.preferredFile,
      rows: result.rows,
      sheetName: result.sheetName,
      summary: {
        columnCount: Math.max(0, ...result.rows.map((row) => row.length)),
        contentHash: contentHash(result.rows),
        encodingIssues: detectEncodingIssues(result.rows),
        rowCount: result.rows.length,
      },
      tempFiles: [...result.files, artifacts.jsonPath, artifacts.csvPath].filter(Boolean),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { exportSource };
