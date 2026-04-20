function buildSuccessSummary({
  runId,
  inputDir,
  snapshotDate,
  sourceRunSummaryPath,
  archiveDir,
  mainRowCount,
  todayNewCount,
  recent7dNewCount,
  historyWindowRequested,
  historyWindowAvailable,
  diffStatus,
  historyCandidatesChecked,
  historyCandidatesSkipped,
}) {
  return {
    status: 'success',
    run_id: runId,
    input_dir: inputDir,
    snapshot_date: snapshotDate,
    source_run_summary_path: sourceRunSummaryPath,
    main_row_count: mainRowCount,
    today_new_count: todayNewCount,
    recent_7d_new_count: recent7dNewCount,
    history_window_requested: historyWindowRequested,
    history_window_available: historyWindowAvailable,
    diff_status: diffStatus,
    archive_dir: archiveDir,
    latest_updated: true,
    history_candidates_checked: historyCandidatesChecked,
    history_candidates_skipped: historyCandidatesSkipped,
  };
}

function buildFailureSummary({
  runId,
  inputDir,
  snapshotDate = null,
  failureStage,
  failureReason,
  suggestedAction,
}) {
  return {
    status: 'failed',
    run_id: runId,
    input_dir: inputDir,
    snapshot_date: snapshotDate,
    failure_stage: failureStage,
    failure_reason: failureReason,
    suggested_action: suggestedAction,
  };
}

module.exports = {
  buildFailureSummary,
  buildSuccessSummary,
};
