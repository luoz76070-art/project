const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { loadLatestResults } = require('../scripts/lib/input');

const fixtureRoot = path.join(__dirname, 'fixtures', 'repo-root');

test('loadLatestResults reads the latest recruiting results fixture', async () => {
  const tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-input-'));
  const targetDir = path.join(tempRepoRoot, 'results', 'local-recruiting', 'latest');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(
    path.join(fixtureRoot, 'results', 'local-recruiting', 'latest', 'main-current.csv'),
    path.join(targetDir, 'main-current.csv'),
  );
  await fs.copyFile(
    path.join(fixtureRoot, 'results', 'local-recruiting', 'latest', 'summary.json'),
    path.join(targetDir, 'summary.json'),
  );

  const input = await loadLatestResults(tempRepoRoot);

  assert.equal(input.repoRoot, tempRepoRoot);
  assert.equal(input.latestInputRoot, targetDir);
  assert.equal(input.csvPath, path.join(targetDir, 'main-current.csv'));
  assert.equal(input.summaryPath, path.join(targetDir, 'summary.json'));
  assert.equal(input.summary.status, 'success');
  assert.equal(input.summary.snapshot_date, '2026-03-30');
  assert.deepEqual(input.rows, [
    { company: 'Acme', title: 'Engineer', location: 'Remote' },
  ]);
});

test('loadLatestResults rejects failed summaries', async () => {
  const tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-input-'));
  const targetDir = path.join(tempRepoRoot, 'results', 'local-recruiting', 'latest');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'main-current.csv'), 'company,title,location\nAcme,Engineer,Remote\n');
  await fs.writeFile(
    path.join(targetDir, 'summary.json'),
    JSON.stringify({ status: 'failed', snapshot_date: '2026-03-30' }),
  );

  await assert.rejects(loadLatestResults(tempRepoRoot), /status/i);
});

test('loadLatestResults rejects missing latest files', async () => {
  const tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-input-'));

  await assert.rejects(loadLatestResults(tempRepoRoot), /ENOENT/);
});

test('loadLatestResults rejects null summaries', async () => {
  const tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tencent-docs-writeback-input-'));
  const targetDir = path.join(tempRepoRoot, 'results', 'local-recruiting', 'latest');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'main-current.csv'), 'company,title,location\nAcme,Engineer,Remote\n');
  await fs.writeFile(path.join(targetDir, 'summary.json'), 'null');

  await assert.rejects(loadLatestResults(tempRepoRoot), /Invalid summary/);
});
