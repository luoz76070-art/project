const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFailureReport, buildSuccessReport } = require('../scripts/lib/report');

test('buildSuccessReport includes required metadata fields', () => {
  const report = buildSuccessReport({
    runId: 'run-1',
    inputDir: '/repo/results/local-recruiting/latest',
    snapshotDate: '2026-03-31',
    targetUrl: 'https://docs.qq.com/sheet/demo',
    backupSheetName: '__local_recruiting_backup__',
    mainRowCount: 2,
  });

  assert.equal(report.status, 'success');
  assert.equal(report.run_id, 'run-1');
  assert.equal(report.input_dir, '/repo/results/local-recruiting/latest');
  assert.equal(report.snapshot_date, '2026-03-31');
  assert.equal(report.target_url, 'https://docs.qq.com/sheet/demo');
  assert.equal(report.backup_sheet_name, '__local_recruiting_backup__');
  assert.equal(report.main_row_count, 2);
});

test('buildFailureReport includes required failure metadata', () => {
  const report = buildFailureReport({
    runId: 'run-2',
    inputDir: '/repo/results/local-recruiting/latest',
    snapshotDate: null,
    targetUrl: 'https://docs.qq.com/sheet/demo',
    backupSheetName: '__local_recruiting_backup__',
    mainRowCount: 2,
    failureStage: 'writeback',
    failureReason: 'target sheet is not editable',
    suggestedAction: 'Fix target permissions and retry',
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.run_id, 'run-2');
  assert.equal(report.failure_stage, 'writeback');
  assert.equal(report.failure_reason, 'target sheet is not editable');
  assert.equal(report.suggested_action, 'Fix target permissions and retry');
});
