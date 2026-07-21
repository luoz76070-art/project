const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildProjectPaths } = require('../scripts/lib/paths');
const { discoverLatestInputDir, loadInputDirectory } = require('../scripts/lib/input');

const repoRoot = path.join(__dirname, 'fixtures', 'repo-root');

test('discoverLatestInputDir picks highest snapshot_date, not mtime', () => {
  const projectPaths = buildProjectPaths(repoRoot);
  const newerMtime = new Date('2030-01-01T00:00:00.000Z');
  const olderMtime = new Date('2020-01-01T00:00:00.000Z');

  fs.utimesSync(path.join(projectPaths.extractorOutputRoot, '2026-03-22'), newerMtime, newerMtime);
  fs.utimesSync(path.join(projectPaths.extractorOutputRoot, '2026-03-24'), olderMtime, olderMtime);

  assert.equal(
    discoverLatestInputDir(projectPaths),
    path.join(projectPaths.extractorOutputRoot, '2026-03-24')
  );
});

test('loadInputDirectory rejects missing required contract columns', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-results-input-'));
  const inputDir = path.join(tempRoot, '2026-03-24');

  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(
    path.join(inputDir, 'recruiting.csv'),
    [
      'record_id,snapshot_date,company_name,deadline_raw,updated_at_raw,official_notice_text,apply_text,remark_raw,official_notice_url,apply_url,job_keywords,major_keywords,location_tokens,degree_level,is_closed,is_expired,deadline_date,updated_date,source_url,extracted_at',
      'alpha,2026-03-24,Alpha Co,2026-04-01,2026-03-24 09:00,Notice Alpha,Apply Alpha,,https://docs.qq.com/sheet/demo,https://docs.qq.com/apply/demo,engineering,computer science,Shenzhen,本科,false,false,2026-04-01,2026-03-24,https://docs.qq.com/sheet/demo,2026-03-24T10:00:00.000Z'
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(inputDir, 'run-summary.json'),
    JSON.stringify({ status: 'success', ok: true, rowCount: 1, sourceUrl: 'https://docs.qq.com/sheet/demo' }),
    'utf8'
  );

  assert.throws(
    () => loadInputDirectory(inputDir),
    /missing required columns: job_title_raw, location_raw/
  );
});
