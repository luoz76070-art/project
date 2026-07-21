const { cleanRows, contentHash, detectEncodingIssues, writeRowsArtifacts } = require('./lib/table');

async function normalizeData(runContext, rows) {
  const cleaned = cleanRows(rows);
  const summary = {
    rowCount: cleaned.length,
    columnCount: Math.max(0, ...cleaned.map((row) => row.length)),
    headerRow: cleaned[0] || [],
    contentHash: contentHash(cleaned),
    encodingIssues: detectEncodingIssues(cleaned),
  };
  const artifacts = await writeRowsArtifacts(runContext.outputDir, cleaned, 'normalized-rows');
  return {
    ok: cleaned.length > 0,
    rows: cleaned,
    summary,
    artifacts,
  };
}

module.exports = { normalizeData };
