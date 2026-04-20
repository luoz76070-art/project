const { loadConfig } = require('./lib/env');
const { clearUsedRangeValues, openPage, pasteRowsAtA1, readUsedRangeRows, waitForReady } = require('./lib/browser');
const { writeRowsArtifacts } = require('./lib/table');

async function readTargetSnapshot(runContext, context, config = null, report = null) {
  const activeConfig = config || (await loadConfig());
  const page = await openPage(context, activeConfig.targetUrl);
  const snapshot = await waitForReady(page, report, 'target-before-write');
  if (!snapshot.canEditTarget) {
    await page.close().catch(() => {});
    return { ok: false, error: 'Target document is not editable', snapshot };
  }

  const rows = await readUsedRangeRows(page);
  const artifacts = await writeRowsArtifacts(runContext.outputDir, rows, 'target-before');
  return {
    ok: true,
    page,
    permission: snapshot,
    rows,
    artifacts,
  };
}

async function updateTarget(runContext, context, rows, config = null, report = null) {
  const activeConfig = config || (await loadConfig());
  const snapshot = await readTargetSnapshot(runContext, context, activeConfig, report);
  if (!snapshot.ok) return snapshot;

  await clearUsedRangeValues(snapshot.page);
  await pasteRowsAtA1(snapshot.page, rows);

  const afterRows = await readUsedRangeRows(snapshot.page);
  const artifacts = await writeRowsArtifacts(runContext.outputDir, afterRows, 'target-after');
  await snapshot.page.close().catch(() => {});
  return {
    ok: true,
    beforeRows: snapshot.rows,
    afterRows,
    beforeArtifacts: snapshot.artifacts,
    afterArtifacts: artifacts,
    permission: snapshot.permission,
    targetUrl: activeConfig.targetUrl,
  };
}

module.exports = { readTargetSnapshot, updateTarget };
