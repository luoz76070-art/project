const fs = require('node:fs');
const path = require('node:path');

const { rowsToCsv } = require('./csv');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function directoryExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch (error) {
    return false;
  }
}

function replaceDirectory(targetDir, stagingDir, backupDir) {
  fs.rmSync(backupDir, { recursive: true, force: true });

  const hadTarget = directoryExists(targetDir);
  if (hadTarget) {
    fs.renameSync(targetDir, backupDir);
  }

  try {
    fs.renameSync(stagingDir, targetDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });

    if (hadTarget && directoryExists(backupDir) && !directoryExists(targetDir)) {
      fs.renameSync(backupDir, targetDir);
    }

    throw error;
  }

  fs.rmSync(backupDir, { recursive: true, force: true });
}

function writeResultCsv(filePath, headers, records) {
  ensureDir(path.dirname(filePath));
  const rows = [headers, ...records.map((record) => headers.map((header) => record[header] ?? ''))];
  fs.writeFileSync(filePath, rowsToCsv(rows), 'utf8');
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildSnapshotFiles(headers, records) {
  return [headers, ...records.map((record) => headers.map((header) => record[header] ?? ''))];
}

function writeSnapshotDir(dirPath, { main, today, recent, summary }) {
  ensureDir(dirPath);
  fs.writeFileSync(path.join(dirPath, 'main-current.csv'), rowsToCsv(buildSnapshotFiles(main.headers, main.records)), 'utf8');
  fs.writeFileSync(path.join(dirPath, 'today-new.csv'), rowsToCsv(buildSnapshotFiles(today.headers, today.records)), 'utf8');
  fs.writeFileSync(
    path.join(dirPath, 'recent-7d-new.csv'),
    rowsToCsv(buildSnapshotFiles(recent.headers, recent.records)),
    'utf8'
  );
  writeJsonFile(path.join(dirPath, 'summary.json'), summary);
}

function publishSuccess(projectPaths, snapshotDate, files, summary) {
  const tmpRoot = path.join(projectPaths.resultsRoot, '.tmp');
  ensureDir(tmpRoot);

  const archiveDir = path.join(projectPaths.archiveRoot, snapshotDate);
  const archiveStagingDir = fs.mkdtempSync(path.join(tmpRoot, `${summary.run_id}-archive-`));
  const archiveBackupDir = path.join(tmpRoot, `${summary.run_id}-archive-backup`);
  const latestStagingDir = fs.mkdtempSync(path.join(tmpRoot, `${summary.run_id}-latest-`));
  const latestBackupDir = path.join(tmpRoot, `${summary.run_id}-latest-backup`);

  try {
    writeSnapshotDir(archiveStagingDir, { ...files, summary });
    writeSnapshotDir(latestStagingDir, { ...files, summary });

    replaceDirectory(archiveDir, archiveStagingDir, archiveBackupDir);
    replaceDirectory(projectPaths.latestRoot, latestStagingDir, latestBackupDir);

    return { archiveDir, latestDir: projectPaths.latestRoot };
  } catch (error) {
    fs.rmSync(archiveStagingDir, { recursive: true, force: true });
    fs.rmSync(latestStagingDir, { recursive: true, force: true });
    throw error;
  }
}

function publishFailure(projectPaths, runId, summary) {
  const failedDir = path.join(projectPaths.failedRoot, runId);
  ensureDir(failedDir);
  writeJsonFile(path.join(failedDir, 'summary.json'), summary);
  return failedDir;
}

module.exports = {
  publishFailure,
  publishSuccess,
  writeJsonFile,
  writeResultCsv,
};
