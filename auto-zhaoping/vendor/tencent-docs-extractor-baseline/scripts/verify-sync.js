const { compareRows, detectEncodingIssues, writeRowsArtifacts } = require('./lib/table');

async function verifySync(runContext, beforeRows, sourceRows, afterRows, keepSamples = 50) {
  const sourceVsTarget = compareRows(sourceRows, afterRows, keepSamples);
  const beforeVsAfter = compareRows(beforeRows, afterRows, keepSamples);
  const encodingIssues = detectEncodingIssues(afterRows);
  const missingItems = sourceRows.length !== afterRows.length ? [{ expectedRows: sourceRows.length, actualRows: afterRows.length }] : [];
  const artifacts = await writeRowsArtifacts(runContext.outputDir, afterRows, 'verified-target');

  return {
    ok: sourceVsTarget.isEqual && encodingIssues.length === 0 && missingItems.length === 0,
    addedCount: beforeVsAfter.addedCount,
    updatedCount: beforeVsAfter.updatedCount,
    deletedCount: beforeVsAfter.deletedCount,
    diffItems: sourceVsTarget.diffItems,
    missingItems,
    encodingIssues,
    artifacts,
    validationSummary: {
      sourceRowCount: sourceRows.length,
      targetRowCount: afterRows.length,
      sourceColumnCount: Math.max(0, ...sourceRows.map((row) => row.length)),
      targetColumnCount: Math.max(0, ...afterRows.map((row) => row.length)),
    },
  };
}

module.exports = { verifySync };
