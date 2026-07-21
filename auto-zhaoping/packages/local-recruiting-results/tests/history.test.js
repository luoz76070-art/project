const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildProjectPaths } = require('../scripts/lib/paths');
const { loadSuccessfulArchives } = require('../scripts/lib/history');

const repoRoot = path.join(__dirname, 'fixtures', 'repo-root');

test('loadSuccessfulArchives keeps only successful dated archives', () => {
  const projectPaths = buildProjectPaths(repoRoot);
  const { archives, skipped } = loadSuccessfulArchives(projectPaths);

  assert.deepEqual(
    archives.map((archive) => archive.snapshotDate),
    ['2026-03-22', '2026-03-23']
  );
  assert.deepEqual(
    archives.map((archive) => archive.records.map((record) => record.record_id)),
    [['alpha'], ['alpha', 'beta']]
  );
  assert.match(skipped.find((entry) => entry.archiveDir.endsWith('not-a-date')).reason, /invalid_archive_name/);
});
