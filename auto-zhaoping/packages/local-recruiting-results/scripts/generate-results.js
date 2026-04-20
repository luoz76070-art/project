const path = require('node:path');

const { computeRecent7d, computeTodayNew } = require('./lib/diff');
const { discoverLatestInputDir, loadInputDirectory } = require('./lib/input');
const { loadSuccessfulArchives } = require('./lib/history');
const { buildProjectPaths, resolveRepoRoot } = require('./lib/paths');
const { publishFailure, publishSuccess } = require('./lib/publish');
const { buildFailureSummary, buildSuccessSummary } = require('./lib/summary');

function parseSnapshotDate(snapshotDate) {
  const [year, month, day] = String(snapshotDate).split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatSnapshotDate(date) {
  return date.toISOString().slice(0, 10);
}

function subtractDays(snapshotDate, days) {
  const date = parseSnapshotDate(snapshotDate);
  date.setUTCDate(date.getUTCDate() - days);
  return formatSnapshotDate(date);
}

function toSnapshotRows(headers, records) {
  return {
    headers,
    records,
  };
}

async function runGenerate({
  repoRoot = resolveRepoRoot(process.cwd()),
  inputDir = null,
  runId = `phase2-${Date.now()}`,
  failAfterLoad = false,
} = {}) {
  const projectPaths = buildProjectPaths(repoRoot);
  let currentInputDir = inputDir;
  let current = null;

  try {
    if (!currentInputDir) {
      currentInputDir = discoverLatestInputDir(projectPaths);
    }

    current = loadInputDirectory(currentInputDir);
    const historyResult = loadSuccessfulArchives(projectPaths);
    const archivesBeforeCurrent = historyResult.archives.filter((archive) => archive.snapshotDate < current.snapshotDate);
    const previousArchive = archivesBeforeCurrent[archivesBeforeCurrent.length - 1] || null;
    const windowStart = subtractDays(current.snapshotDate, 6);
    const windowArchives = archivesBeforeCurrent.filter((archive) => archive.snapshotDate >= windowStart);
    const baselineArchive = archivesBeforeCurrent.filter((archive) => archive.snapshotDate < windowStart).at(-1) || null;
    const windowSnapshots = [
      ...archivesBeforeCurrent.map((archive) => ({ snapshotDate: archive.snapshotDate, records: archive.records })),
      { snapshotDate: current.snapshotDate, records: current.records },
    ];

    const today = computeTodayNew({
      currentRecords: current.records,
      previousRecords: previousArchive ? previousArchive.records : [],
      headers: current.headers,
      snapshotDate: current.snapshotDate,
    });

    const recent = computeRecent7d({
      currentRecords: current.records,
      windowSnapshots,
      headers: current.headers,
    });

    if (failAfterLoad) {
      throw new Error('forced failure after load');
    }

    const historyWindowAvailable = windowArchives.length + (baselineArchive ? 1 : 0);
    const diffStatus =
      today.diffStatus === 'complete' &&
      recent.diffStatus === 'complete' &&
      historyWindowAvailable >= 7 &&
      historyResult.skipped.length === 0
        ? 'complete'
        : 'insufficient_history';

    const summary = buildSuccessSummary({
      runId,
      inputDir: current.inputDir,
      snapshotDate: current.snapshotDate,
      sourceRunSummaryPath: current.runSummaryPath,
      archiveDir: path.join(projectPaths.archiveRoot, current.snapshotDate),
      mainRowCount: current.records.length,
      todayNewCount: today.records.length,
      recent7dNewCount: recent.records.length,
      historyWindowRequested: 7,
      historyWindowAvailable,
      diffStatus,
      historyCandidatesChecked: historyResult.archives.length + historyResult.skipped.length,
      historyCandidatesSkipped: historyResult.skipped,
    });

    const published = publishSuccess(
      projectPaths,
      current.snapshotDate,
      {
        main: toSnapshotRows(current.headers, current.records),
        today: toSnapshotRows(today.headers, today.records),
        recent: toSnapshotRows(recent.headers, recent.records),
      },
      summary
    );

    return { ...published, runId, summary };
  } catch (error) {
    const failureStage = current ? 'generate' : 'input';
    const failedSummary = buildFailureSummary({
      runId,
      inputDir: current?.inputDir || currentInputDir || null,
      snapshotDate: current?.snapshotDate || null,
      failureStage,
      failureReason: error.message,
      suggestedAction:
        failureStage === 'input'
          ? 'Rerun phase one or repair the extractor output directory'
          : 'Inspect the extractor output and rerun phase one extraction',
    });

    const failedDir = publishFailure(projectPaths, runId, failedSummary);
    error.failedDir = failedDir;
    error.runId = runId;
    error.summary = failedSummary;
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const inputFlagIndex = argv.indexOf('--input-dir');
  const inputDir = inputFlagIndex >= 0 ? argv[inputFlagIndex + 1] : null;

  const result = await runGenerate({
    repoRoot: resolveRepoRoot(process.cwd()),
    inputDir,
  });

  console.log(`ARCHIVE_DIR=${result.archiveDir}`);
  console.log(`LATEST_DIR=${result.latestDir}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runGenerate,
};
