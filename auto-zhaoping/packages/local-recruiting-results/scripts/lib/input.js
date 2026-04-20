const fs = require('node:fs');
const path = require('node:path');

const { readCsvFile } = require('./csv');

const REQUIRED_COLUMNS = [
  'record_id',
  'snapshot_date',
  'company_name',
  'job_title_raw',
  'location_raw',
  'deadline_raw',
  'updated_at_raw',
  'official_notice_text',
  'apply_text',
  'remark_raw',
  'official_notice_url',
  'apply_url',
  'job_keywords',
  'major_keywords',
  'location_tokens',
  'degree_level',
  'is_closed',
  'is_expired',
  'deadline_date',
  'updated_date',
  'source_url',
  'extracted_at',
];

function getMissingColumns(headers, requiredColumns) {
  const headerSet = new Set(headers);
  return requiredColumns.filter((column) => !headerSet.has(column));
}

function readRunSummary(runSummaryPath) {
  const text = fs.readFileSync(runSummaryPath, 'utf8');
  return JSON.parse(text);
}

function getSnapshotDate(records) {
  const snapshotDates = new Set();

  for (const record of records) {
    const snapshotDate = String(record.snapshot_date || '').trim();
    if (!snapshotDate) {
      throw new Error('invalid snapshot_date');
    }
    snapshotDates.add(snapshotDate);
  }

  if (snapshotDates.size !== 1) {
    throw new Error('invalid snapshot_date');
  }

  return [...snapshotDates][0];
}

function loadInputDirectory(inputDir, { requiredColumns = REQUIRED_COLUMNS } = {}) {
  const csvPath = path.join(inputDir, 'recruiting.csv');
  const runSummaryPath = path.join(inputDir, 'run-summary.json');

  if (!fs.existsSync(csvPath) || !fs.existsSync(runSummaryPath)) {
    throw new Error('input directory must contain recruiting.csv and run-summary.json');
  }

  const { headers, records } = readCsvFile(csvPath);
  const missingColumns = getMissingColumns(headers, requiredColumns);

  if (missingColumns.length > 0) {
    throw new Error(`missing required columns: ${missingColumns.join(', ')}`);
  }

  const snapshotDate = getSnapshotDate(records);

  return {
    inputDir,
    csvPath,
    runSummaryPath,
    headers,
    records,
    runSummary: readRunSummary(runSummaryPath),
    snapshotDate,
  };
}

function discoverLatestInputDir(projectPaths) {
  const candidates = [];

  for (const entry of fs.readdirSync(projectPaths.extractorOutputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const inputDir = path.join(projectPaths.extractorOutputRoot, entry.name);
    if (!fs.existsSync(path.join(inputDir, 'recruiting.csv')) || !fs.existsSync(path.join(inputDir, 'run-summary.json'))) {
      continue;
    }

    try {
      const loaded = loadInputDirectory(inputDir);
      candidates.push({
        inputDir,
        dirName: entry.name,
        snapshotDate: loaded.snapshotDate,
      });
    } catch (error) {
      continue;
    }
  }

  if (candidates.length === 0) {
    throw new Error(`no valid input directories found under ${projectPaths.extractorOutputRoot}`);
  }

  candidates.sort((left, right) => {
    if (left.snapshotDate !== right.snapshotDate) {
      return left.snapshotDate < right.snapshotDate ? -1 : 1;
    }

    return left.dirName.localeCompare(right.dirName);
  });

  return candidates[candidates.length - 1].inputDir;
}

module.exports = {
  REQUIRED_COLUMNS,
  discoverLatestInputDir,
  loadInputDirectory,
};
