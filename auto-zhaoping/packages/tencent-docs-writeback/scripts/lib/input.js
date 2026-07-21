const fs = require('node:fs/promises');
const path = require('node:path');

const { parseCsv } = require('./csv');

async function loadLatestResults(repoRoot) {
  const latestInputRoot = path.join(repoRoot, 'results', 'local-recruiting', 'latest');
  const csvPath = path.join(latestInputRoot, 'main-current.csv');
  const summaryPath = path.join(latestInputRoot, 'summary.json');

  const [csvText, summaryText] = await Promise.all([
    fs.readFile(csvPath, 'utf8'),
    fs.readFile(summaryPath, 'utf8'),
  ]);

  const summary = JSON.parse(summaryText);

  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error(`Invalid summary at ${summaryPath}`);
  }

  if (summary.status !== 'success') {
    throw new Error(`Expected summary status success at ${summaryPath}`);
  }

  if (!summary.snapshot_date) {
    throw new Error(`Missing snapshot_date in ${summaryPath}`);
  }

  return {
    repoRoot,
    latestInputRoot,
    csvPath,
    summaryPath,
    summary,
    snapshotDate: summary.snapshot_date,
    rows: parseCsv(csvText),
  };
}

module.exports = { loadLatestResults };
