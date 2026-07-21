const { authCheck } = require('./auth-check');
const { cleanupTemp } = require('./cleanup-temp');
const { exportSource } = require('./export-source');
const { createRunContext, loadConfig, writeJson } = require('./lib/env');
const { acquireLock, releaseLock, updateRuntimeState } = require('./lib/state');
const { normalizeData } = require('./normalize-data');
const { updateTarget } = require('./update-target');
const { verifySync } = require('./verify-sync');

function getRunType() {
  const index = process.argv.indexOf('--run-type');
  return index >= 0 ? process.argv[index + 1] : 'manual';
}

function createReport(runContext, config) {
  return {
    runId: runContext.runId,
    runType: runContext.runType,
    startedAt: runContext.startedAt,
    sourceUrl: config.sourceUrl,
    targetUrl: config.targetUrl,
    steps: [],
    permissionSnapshots: [],
    networkSamples: [],
    downloads: [],
    cleanup: null,
    verify: null,
    errors: [],
    finalStatus: 'running',
  };
}

function logStep(report, message, extra = {}) {
  const step = { at: new Date().toISOString(), message, ...extra };
  report.steps.push(step);
  console.log(`[sync] ${message}`);
}

async function finalize(runContext, report, finalStatus, extra = {}) {
  report.finalStatus = finalStatus;
  report.finishedAt = new Date().toISOString();
  Object.assign(report, extra);
  await writeJson(runContext.reportPath, report);
  await updateRuntimeState(runContext, {
    startedAt: runContext.startedAt,
    finishedAt: report.finishedAt,
    finalStatus,
    reportPath: runContext.reportPath,
    sourceUrl: report.sourceUrl,
    targetUrl: report.targetUrl,
    verify: report.verify,
    errors: report.errors,
  });
}

async function main() {
  const runType = getRunType();
  const runContext = await createRunContext(runType);
  const config = await loadConfig();

  if (!config.sourceUrl || !config.targetUrl) {
    throw new Error('Please set both sourceUrl and targetUrl in config/sync-config.json');
  }

  const report = createReport(runContext, config);
  await acquireLock(runContext);

  let context = null;
  let tempFiles = [];
  try {
    logStep(report, 'Checking Tencent Docs session and permissions');
    const auth = await authCheck(runContext, config, report);
    context = auth.context;

    report.auth = {
      accountId: auth.accountId,
      sourceCanRead: Boolean(auth.source?.canRead),
      sourceCanExport: Boolean(auth.source?.canExport),
      targetCanEdit: Boolean(auth.target?.canEditTarget),
    };

    if (!auth.source?.canRead) {
      throw new Error('Source document is not readable with the current account');
    }
    if (!auth.target?.canEditTarget) {
      throw new Error('Target document is not editable with the current account');
    }

    logStep(report, 'Exporting or copying the source table');
    const source = await exportSource(runContext, context, config, report);
    if (!source.ok) throw new Error(source.error || 'Failed to export source rows');
    tempFiles.push(...source.tempFiles);
    report.source = {
      method: source.method,
      preferredFile: source.preferredFile,
      summary: source.summary,
      artifacts: source.artifacts,
    };

    logStep(report, `Normalizing ${source.summary.rowCount} source rows`);
    const normalized = await normalizeData(runContext, source.rows);
    if (!normalized.ok) {
      throw new Error('Normalized source rows are empty');
    }
    report.normalized = {
      summary: normalized.summary,
      artifacts: normalized.artifacts,
    };

    logStep(report, 'Updating target document from A1 while preserving formatting');
    const updated = await updateTarget(runContext, context, normalized.rows, config, report);
    if (!updated.ok) throw new Error(updated.error || 'Target update failed');
    report.target = {
      beforeArtifacts: updated.beforeArtifacts,
      afterArtifacts: updated.afterArtifacts,
      beforeRowCount: updated.beforeRows.length,
      afterRowCount: updated.afterRows.length,
    };

    logStep(report, 'Verifying target data matches the source');
    const verified = await verifySync(
      runContext,
      updated.beforeRows,
      normalized.rows,
      updated.afterRows,
      config.verification?.keepDiffSamples || 50
    );
    report.verify = verified;
    if (!verified.ok) {
      throw new Error('Verification failed after writing target data');
    }

    logStep(report, 'Cleaning up temporary export artifacts');
    report.cleanup = await cleanupTemp(
      tempFiles,
      Boolean(config.cleanup?.deleteTempExportsOnSuccess)
    );

    await finalize(runContext, report, 'success');
    console.log(`REPORT_JSON=${runContext.reportPath}`);
  } catch (error) {
    report.errors.push(error.stack || error.message);
    if (tempFiles.length) {
      report.cleanup = await cleanupTemp(tempFiles, false);
    }
    await finalize(runContext, report, 'failed');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    await releaseLock();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
