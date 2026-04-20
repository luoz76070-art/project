const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runGenerate } = require('../scripts/generate-results');

const fixtureRoot = path.join(__dirname, 'fixtures', 'repo-root');

async function createTempRepoRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function copyFixtureTree(source, target) {
  await fs.cp(source, target, { recursive: true });
}

async function prepareSuccessRepoRoot() {
  const repoRoot = await createTempRepoRoot('local-results-success-');
  const inputDir = path.join(
    repoRoot,
    'packages/tencent-docs-recruiting-extractor/output/2026-03-24'
  );
  const archiveRoot = path.join(repoRoot, 'results/local-recruiting/archive');

  await copyFixtureTree(
    path.join(fixtureRoot, 'packages/tencent-docs-recruiting-extractor/output/2026-03-24'),
    inputDir
  );
  await copyFixtureTree(path.join(fixtureRoot, 'results/local-recruiting/archive'), archiveRoot);

  return { inputDir, repoRoot };
}

test('runGenerate writes archive and latest outputs on success', async () => {
  const { inputDir, repoRoot } = await prepareSuccessRepoRoot();
  const result = await runGenerate({ repoRoot, inputDir, runId: 'test-success' });

  assert.match(result.archiveDir, /results\/local-recruiting\/archive\/2026-03-24$/);
  assert.match(result.latestDir, /results\/local-recruiting\/latest$/);

  const archiveSummary = JSON.parse(await fs.readFile(path.join(result.archiveDir, 'summary.json'), 'utf8'));
  const latestSummary = JSON.parse(await fs.readFile(path.join(result.latestDir, 'summary.json'), 'utf8'));

  assert.equal(archiveSummary.status, 'success');
  assert.equal(archiveSummary.snapshot_date, '2026-03-24');
  assert.equal(archiveSummary.run_id, 'test-success');
  assert.equal(archiveSummary.diff_status, 'insufficient_history');
  assert.equal(archiveSummary.history_window_available, 2);
  assert.equal(archiveSummary.today_new_count, 1);
  assert.equal(archiveSummary.recent_7d_new_count, 0);
  assert.equal(archiveSummary.latest_updated, true);
  assert.equal(archiveSummary.history_candidates_skipped.length, 1);
  assert.deepEqual(archiveSummary, latestSummary);

  assert.equal(
    await fs.readFile(path.join(result.archiveDir, 'main-current.csv'), 'utf8'),
    await fs.readFile(path.join(fixtureRoot, 'packages/tencent-docs-recruiting-extractor/output/2026-03-24/recruiting.csv'), 'utf8')
  );
  assert.equal(
    await fs.readFile(path.join(result.archiveDir, 'today-new.csv'), 'utf8'),
    [
      'record_id,snapshot_date,company_name,job_title_raw,location_raw,deadline_raw,updated_at_raw,official_notice_text,apply_text,remark_raw,official_notice_url,apply_url,job_keywords,major_keywords,location_tokens,degree_level,is_closed,is_expired,deadline_date,updated_date,source_url,extracted_at,new_date',
      'gamma,2026-03-24,Gamma Co,ML Engineer,Beijing,2026-04-05,2026-03-24 10:00,Gamma notice,Apply Gamma,,https://docs.qq.com/sheet/demo,https://docs.qq.com/apply/gamma,ml,ai,Beijing,硕士,false,false,2026-04-05,2026-03-24,https://docs.qq.com/sheet/demo,2026-03-24T10:00:00.000Z,2026-03-24',
    ].join('\n') + '\n'
  );
  assert.equal(
    await fs.readFile(path.join(result.archiveDir, 'recent-7d-new.csv'), 'utf8'),
    'record_id,snapshot_date,company_name,job_title_raw,location_raw,deadline_raw,updated_at_raw,official_notice_text,apply_text,remark_raw,official_notice_url,apply_url,job_keywords,major_keywords,location_tokens,degree_level,is_closed,is_expired,deadline_date,updated_date,source_url,extracted_at,new_date\n'
  );
});

test('runGenerate writes failed/<run-id>/summary.json and leaves latest untouched on hard failure', async () => {
  const repoRoot = await createTempRepoRoot('local-results-fail-');
  const latestDir = path.join(repoRoot, 'results/local-recruiting/latest');

  await fs.mkdir(latestDir, { recursive: true });
  await fs.writeFile(
    path.join(latestDir, 'summary.json'),
    JSON.stringify({ status: 'success', snapshot_date: '2026-03-23' }),
    'utf8'
  );

  await assert.rejects(
    () =>
      runGenerate({
        repoRoot,
        inputDir: path.join(repoRoot, 'packages/tencent-docs-recruiting-extractor/output/missing'),
        runId: 'test-failure',
      }),
    /input directory must contain recruiting\.csv and run-summary\.json/
  );

  const latestSummary = JSON.parse(await fs.readFile(path.join(latestDir, 'summary.json'), 'utf8'));
  const failedSummary = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'results/local-recruiting/failed/test-failure/summary.json'), 'utf8')
  );

  assert.equal(latestSummary.snapshot_date, '2026-03-23');
  assert.equal(failedSummary.status, 'failed');
  assert.equal(failedSummary.run_id, 'test-failure');
  assert.equal(failedSummary.snapshot_date, null);
  assert.equal(failedSummary.failure_stage, 'input');
  assert.match(failedSummary.failure_reason, /input directory must contain recruiting\.csv and run-summary\.json/);
});
