const fs = require('node:fs/promises');
const path = require('node:path');

function buildSuccessReport({ runId, inputDir, snapshotDate, targetUrl, backupSheetName, mainRowCount }) {
  return {
    status: 'success',
    run_id: runId,
    input_dir: inputDir,
    snapshot_date: snapshotDate,
    target_url: targetUrl,
    backup_sheet_name: backupSheetName,
    main_row_count: mainRowCount,
  };
}

function buildFailureReport({
  runId,
  inputDir,
  snapshotDate,
  targetUrl,
  backupSheetName,
  mainRowCount,
  failureStage,
  failureReason,
  suggestedAction,
}) {
  return {
    status: 'failed',
    run_id: runId,
    input_dir: inputDir,
    snapshot_date: snapshotDate,
    target_url: targetUrl,
    backup_sheet_name: backupSheetName,
    main_row_count: mainRowCount,
    failure_stage: failureStage,
    failure_reason: failureReason,
    suggested_action: suggestedAction,
  };
}

async function writeReportArtifacts(runDir, report, beforeRows, afterRows) {
  const reportPath = path.join(runDir, 'report.json');
  const beforeTargetCsvPath = path.join(runDir, 'before-target.csv');
  const afterTargetCsvPath = path.join(runDir, 'after-target.csv');

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(beforeTargetCsvPath, `${stringifyRows(beforeRows)}\n`);
  await fs.writeFile(afterTargetCsvPath, `${stringifyRows(afterRows)}\n`);

  return { reportPath, beforeTargetCsvPath, afterTargetCsvPath };
}

function stringifyRows(rows) {
  return rows
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n');
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

module.exports = { buildFailureReport, buildSuccessReport, writeReportArtifacts };
