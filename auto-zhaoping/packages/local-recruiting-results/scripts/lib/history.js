const fs = require('node:fs');
const path = require('node:path');

const { readCsvFile } = require('./csv');

const ARCHIVE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadSuccessfulArchives(projectPaths) {
  const archives = [];
  const skipped = [];

  if (!fs.existsSync(projectPaths.archiveRoot)) {
    return { archives, skipped };
  }

  const entries = fs.readdirSync(projectPaths.archiveRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const archiveDir = path.join(projectPaths.archiveRoot, entry.name);

    if (!ARCHIVE_DIR_RE.test(entry.name)) {
      skipped.push({ archiveDir, reason: 'invalid_archive_name' });
      continue;
    }

    const summaryPath = path.join(archiveDir, 'summary.json');
    const mainCurrentCsvPath = path.join(archiveDir, 'main-current.csv');

    if (!fs.existsSync(summaryPath)) {
      skipped.push({ archiveDir, reason: 'missing_summary' });
      continue;
    }

    if (!fs.existsSync(mainCurrentCsvPath)) {
      skipped.push({ archiveDir, reason: 'missing_main_current' });
      continue;
    }

    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

      if (summary.status !== 'success') {
        skipped.push({ archiveDir, reason: 'non_success_summary' });
        continue;
      }

      const { headers, records } = readCsvFile(mainCurrentCsvPath);
      const snapshotDate = String(summary.snapshot_date || '').trim();

      if (!snapshotDate) {
        skipped.push({ archiveDir, reason: 'missing_snapshot_date' });
        continue;
      }

      archives.push({
        archiveDir,
        snapshotDate,
        summaryPath,
        mainCurrentCsvPath,
        summary,
        headers,
        records,
      });
    } catch (error) {
      skipped.push({ archiveDir, reason: 'unreadable_archive' });
    }
  }

  archives.sort((left, right) => {
    if (left.snapshotDate !== right.snapshotDate) {
      return left.snapshotDate < right.snapshotDate ? -1 : 1;
    }

    return left.archiveDir.localeCompare(right.archiveDir);
  });

  return { archives, skipped };
}

module.exports = {
  loadSuccessfulArchives,
};
