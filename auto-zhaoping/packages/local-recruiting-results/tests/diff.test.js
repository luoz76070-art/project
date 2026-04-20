const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readCsvFile } = require('../scripts/lib/csv');
const { computeRecent7d, computeTodayNew } = require('../scripts/lib/diff');

const repoRoot = path.join(__dirname, 'fixtures', 'repo-root');

function readFixtureRecords(relativePath) {
  return readCsvFile(path.join(repoRoot, relativePath));
}

test('computeTodayNew returns header-only output when no previous snapshot exists', () => {
  const { headers, records } = readFixtureRecords(
    'results/local-recruiting/archive/2026-03-22/main-current.csv'
  );

  const result = computeTodayNew({
    currentRecords: records,
    previousRecords: [],
    headers,
    snapshotDate: '2026-03-22',
  });

  assert.deepEqual(result.headers, [...headers, 'new_date']);
  assert.deepEqual(result.records, []);
  assert.equal(result.diffStatus, 'insufficient_history');
});

test('computeRecent7d uses the pre-window baseline and keeps only current records', () => {
  const headers = ['record_id', 'snapshot_date', 'company_name'];
  const baseline = {
    snapshotDate: '2026-03-16',
    records: [
      { record_id: 'alpha', snapshot_date: '2026-03-16', company_name: 'Alpha Co' },
    ],
  };
  const day1 = {
    snapshotDate: '2026-03-22',
    records: [
      { record_id: 'alpha', snapshot_date: '2026-03-22', company_name: 'Alpha Co' },
      { record_id: 'beta', snapshot_date: '2026-03-22', company_name: 'Beta Co' },
      { record_id: 'gamma', snapshot_date: '2026-03-22', company_name: 'Gamma Co' },
    ],
  };
  const day2 = {
    snapshotDate: '2026-03-23',
    records: [
      { record_id: 'alpha', snapshot_date: '2026-03-23', company_name: 'Alpha Co' },
      { record_id: 'beta', snapshot_date: '2026-03-23', company_name: 'Beta Co' },
    ],
  };

  const result = computeRecent7d({
    currentRecords: day2.records,
    windowSnapshots: [baseline, day1, day2],
    headers,
  });

  assert.deepEqual(result.headers, [...headers, 'new_date']);
  assert.deepEqual(result.records, [
    {
      record_id: 'beta',
      snapshot_date: '2026-03-23',
      company_name: 'Beta Co',
      new_date: '2026-03-22',
    },
  ]);
  assert.equal(result.diffStatus, 'complete');
});

test('computeRecent7d returns insufficient history when the left-edge baseline is unavailable', () => {
  const headers = ['record_id', 'snapshot_date', 'company_name'];

  const result = computeRecent7d({
    currentRecords: [
      { record_id: 'alpha', snapshot_date: '2026-03-23', company_name: 'Alpha Co' },
    ],
    windowSnapshots: [
      {
        snapshotDate: '2026-03-23',
        records: [
          { record_id: 'alpha', snapshot_date: '2026-03-23', company_name: 'Alpha Co' },
        ],
      },
    ],
    headers,
  });

  assert.deepEqual(result.headers, [...headers, 'new_date']);
  assert.deepEqual(result.records, []);
  assert.equal(result.diffStatus, 'insufficient_history');
});
